/**
 * Recordings held on this device until they are safely in the library.
 *
 * Before this, a finished recording lived in a React state variable. Closing
 * the tab destroyed it, a failed upload destroyed it, and a refresh destroyed
 * it — which is why the app had to resort to a `beforeunload` prompt to defend
 * an hour of somebody's service.
 *
 * IndexedDB holds Blobs properly (localStorage cannot) and survives a reload,
 * a crash and a closed laptop. The entry is deleted only once the server has
 * confirmed the media row exists, so the rule is simple: if it is still here,
 * it is not yet saved anywhere else.
 *
 * Browser only.
 */

const DB_NAME = "flockinsight-recordings";
const STORE = "pending";
const DB_VERSION = 1;

export type VaultEntry = {
  id: string;
  meetingCode: string;
  meetingTitle: string;
  /** The server-side recording row, so a retry can complete the right one. */
  recordingId: string | null;
  mode: "video" | "audio";
  filename: string;
  mime: string;
  durationSec: number;
  bytes: number;
  createdAt: number;
  /** Why the last attempt did not finish, for the person deciding what to do. */
  lastError: string | null;
  attempts: number;
  blob: Blob;

  /*
   * Resume state. Optional, so entries written by an older build are still
   * readable — a stored recording must never become unreadable because the app
   * was updated around it.
   */
  /** The server-side upload this is being appended to, across sessions. */
  uploadId?: string | null;
  /** How many bytes the server had last time we checked. Never trusted alone. */
  uploadedBytes?: number;
  /** When the uploader last managed to send something, for backoff. */
  lastAttemptAt?: number;
  /** Set once it is in the library, just before the entry is released. */
  done?: boolean;
};

export function vaultSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB refused to open."));
  });
}

/**
 * One IndexedDB request, settled when its TRANSACTION settles.
 *
 * Not when the request succeeds. Those are different moments, and the gap
 * between them is where recordings were lost: a large Blob write succeeds as a
 * request and is then refused at commit — QuotaExceededError on a nearly full
 * phone, Safari's per-origin limit, a private window — which shows up only as
 * the transaction aborting. Resolving on `req.onsuccess` told the meeting room
 * an hour of video was safe on the device when nothing had been written, and it
 * then let go of the only copy in memory.
 *
 * So: resolve on `complete`, reject on `abort` (with the transaction's own
 * error, which is where the quota failure is reported), and treat anything
 * thrown while setting up the transaction — DataCloneError, InvalidStateError —
 * as the same refusal rather than an exception that escapes the promise.
 */
function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result: T | undefined;
        let requestError: DOMException | null = null;
        let tx: IDBTransaction;
        try {
          tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => {
            result = req.result;
          };
          /*
           * Remember why, and nothing else. Do NOT call preventDefault here (or
           * on the transaction's error event): in IndexedDB, cancelling a
           * request's error event is precisely what stops the transaction from
           * aborting. The transaction then commits without the write, `oncomplete`
           * fires, and the caller is told a failed write succeeded. Left alone,
           * the error aborts the transaction and `onabort` below rejects.
           */
          req.onerror = () => {
            requestError = req.error;
          };
        } catch (e) {
          db.close();
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(result as T);
        };
        tx.onabort = () => {
          db.close();
          reject(
            tx.error ??
              requestError ??
              new Error("IndexedDB did not keep the change (the transaction was aborted)."),
          );
        };
      }),
  );
}

/** Why the device could not keep a recording, in words for the person. */
export class VaultUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VaultUnavailable";
  }
}

/**
 * Put a recording beyond the reach of a closed tab.
 *
 * Deliberately called before the first upload attempt, not after a failure:
 * the moment most likely to lose a recording is the one where the host stops
 * recording and immediately closes the laptop.
 */
export async function keepRecording(entry: Omit<VaultEntry, "attempts" | "lastError">): Promise<void> {
  /*
   * Throws rather than returning quietly. A caller that is told nothing assumes
   * the recording is safe and lets the in-memory Blob go; a webview with no
   * IndexedDB used to get exactly that, and a "recording queued" toast for a
   * file that existed nowhere. The caller must keep the Blob and offer a
   * download instead — see `VaultUnavailable`.
   */
  if (!vaultSupported())
    throw new VaultUnavailable("This browser cannot keep recordings on the device.");
  try {
    await run("readwrite", (s) => s.put({ ...entry, attempts: 0, lastError: null }));
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new VaultUnavailable(
      name === "QuotaExceededError"
        ? "This device is out of space for the recording."
        : "This browser would not store the recording on the device.",
      { cause: e },
    );
  }
  /*
   * Read back before claiming success. A committed transaction is the browser's
   * word; finding the entry is ours, and it costs one small read against an
   * hour of somebody's service.
   */
  const kept = await getPending(entry.id);
  if (!kept) throw new VaultUnavailable("The recording could not be found on the device after saving it.");
}

/** Whether a recording is really on this device right now. */
export async function isKept(id: string): Promise<boolean> {
  return (await getPending(id)) !== null;
}

export async function listPending(): Promise<VaultEntry[]> {
  if (!vaultSupported()) return [];
  try {
    const all = await run<VaultEntry[]>("readonly", (s) => s.getAll() as IDBRequest<VaultEntry[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) {
    // A private window, or storage the browser has decided to refuse. The
    // caller's own error path speaks to the person; this leaves a trace.
    console.error("[recording-vault] could not list recordings on this device", e);
    return [];
  }
}

export async function getPending(id: string): Promise<VaultEntry | null> {
  if (!vaultSupported()) return null;
  try {
    return (await run<VaultEntry | undefined>("readonly", (s) => s.get(id))) ?? null;
  } catch (e) {
    console.error("[recording-vault] could not read a recording on this device", e);
    return null;
  }
}

/** Called only once the server has confirmed the media row exists. */
export async function releaseRecording(id: string): Promise<void> {
  if (!vaultSupported()) return;
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch (e) {
    // Leaving a saved copy behind is harmless; losing an unsaved one is not.
    console.error("[recording-vault] could not release a saved recording", e);
  }
}

/**
 * Remember how far an upload got, so a later session resumes rather than
 * restarts.
 *
 * Written after every chunk. The cost is one small IndexedDB put per 8 MB,
 * which is nothing next to re-sending 200 MB because a laptop lid closed.
 */
export async function noteProgress(
  id: string,
  uploadId: string,
  uploadedBytes: number,
): Promise<void> {
  const entry = await getPending(id);
  if (!entry) return;
  await run("readwrite", (s) =>
    s.put({ ...entry, uploadId, uploadedBytes, lastAttemptAt: Date.now() }),
  );
}

export async function noteFailure(id: string, error: string): Promise<void> {
  const entry = await getPending(id);
  if (!entry) return;
  await run("readwrite", (s) =>
    /*
     * `lastAttemptAt` too, or the backoff never applies: it is the clock the
     * uploader measures from, and a refusal at START (before any progress was
     * noted) used to leave it unset — so a recording the server would never
     * accept was retried every twenty seconds for ever.
     */
    s.put({ ...entry, lastError: error, attempts: entry.attempts + 1, lastAttemptAt: Date.now() }),
  );
}

/** Total bytes parked on this device, for telling the person what is at stake. */
export async function pendingBytes(): Promise<number> {
  const all = await listPending();
  return all.reduce((n, e) => n + e.bytes, 0);
}

/** Hand one back to the person's downloads folder. */
export function downloadEntry(entry: VaultEntry): void {
  const url = URL.createObjectURL(entry.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = entry.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
