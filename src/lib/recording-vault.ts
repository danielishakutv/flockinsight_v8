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

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB write failed."));
        tx.oncomplete = () => db.close();
      }),
  );
}

/**
 * Put a recording beyond the reach of a closed tab.
 *
 * Deliberately called before the first upload attempt, not after a failure:
 * the moment most likely to lose a recording is the one where the host stops
 * recording and immediately closes the laptop.
 */
export async function keepRecording(entry: Omit<VaultEntry, "attempts" | "lastError">): Promise<void> {
  if (!vaultSupported()) return;
  await run("readwrite", (s) => s.put({ ...entry, attempts: 0, lastError: null }));
}

export async function listPending(): Promise<VaultEntry[]> {
  if (!vaultSupported()) return [];
  try {
    const all = await run<VaultEntry[]>("readonly", (s) => s.getAll() as IDBRequest<VaultEntry[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    // A private window, or storage the browser has decided to refuse. The
    // recording still exists in memory for this session; say nothing here and
    // let the caller's own error path speak.
    return [];
  }
}

export async function getPending(id: string): Promise<VaultEntry | null> {
  if (!vaultSupported()) return null;
  try {
    return (await run<VaultEntry | undefined>("readonly", (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

/** Called only once the server has confirmed the media row exists. */
export async function releaseRecording(id: string): Promise<void> {
  if (!vaultSupported()) return;
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {
    /* Leaving a saved copy behind is harmless; losing an unsaved one is not. */
  }
}

export async function noteFailure(id: string, error: string): Promise<void> {
  const entry = await getPending(id);
  if (!entry) return;
  await run("readwrite", (s) =>
    s.put({ ...entry, lastError: error, attempts: entry.attempts + 1 }),
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
