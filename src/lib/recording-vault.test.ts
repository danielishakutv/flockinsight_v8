import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A small stand-in for IndexedDB that behaves the way a real one does at the
 * moment that lost recordings: the PUT request succeeds, and the transaction
 * then aborts at commit (QuotaExceededError on a nearly full phone). Every
 * event is delivered asynchronously, in the order a browser delivers them —
 * request success first, transaction complete or abort after.
 */
type Mode = "commit" | "abort-at-commit" | "throw-on-put" | "request-error";

function installFakeIndexedDB(mode: () => Mode) {
  const data = new Map<string, unknown>();

  function transaction() {
    const pending: Array<() => void> = [];
    const tx: Record<string, unknown> & { error: unknown } = { error: null };
    const store = {
      put(value: { id: string }) {
        if (mode() === "throw-on-put") throw Object.assign(new Error("clone"), { name: "DataCloneError" });
        const req: Record<string, unknown> = {};
        pending.push(() => {
          if (mode() === "request-error") {
            /*
             * The real dispatch: the error event goes to the request, then
             * bubbles to the transaction. If anybody cancels it, the
             * transaction does NOT abort — it commits without the write. Only
             * an uncancelled error aborts it.
             */
            req.error = Object.assign(new Error("constraint"), { name: "ConstraintError" });
            let cancelled = false;
            const ev = { preventDefault: () => (cancelled = true), target: req };
            (req.onerror as ((e: unknown) => void) | undefined)?.(ev);
            (tx.onerror as ((e: unknown) => void) | undefined)?.(ev);
            if (cancelled) {
              (tx.oncomplete as (() => void) | undefined)?.();
            } else {
              tx.error = req.error;
              (tx.onabort as (() => void) | undefined)?.();
            }
            return;
          }
          req.result = value.id;
          (req.onsuccess as (() => void) | undefined)?.();
          if (mode() === "abort-at-commit") {
            tx.error = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
            (tx.onabort as (() => void) | undefined)?.();
          } else {
            data.set(value.id, structuredClone({ ...value, blob: undefined }));
            (tx.oncomplete as (() => void) | undefined)?.();
          }
        });
        return req;
      },
      get(id: string) {
        const req: Record<string, unknown> = {};
        pending.push(() => {
          req.result = data.get(id);
          (req.onsuccess as (() => void) | undefined)?.();
          (tx.oncomplete as (() => void) | undefined)?.();
        });
        return req;
      },
      getAll() {
        const req: Record<string, unknown> = {};
        pending.push(() => {
          req.result = [...data.values()];
          (req.onsuccess as (() => void) | undefined)?.();
          (tx.oncomplete as (() => void) | undefined)?.();
        });
        return req;
      },
      delete(id: string) {
        const req: Record<string, unknown> = {};
        pending.push(() => {
          data.delete(id);
          (req.onsuccess as (() => void) | undefined)?.();
          (tx.oncomplete as (() => void) | undefined)?.();
        });
        return req;
      },
    };
    tx.objectStore = () => store;
    setTimeout(() => pending.forEach((f) => f()), 0);
    return tx;
  }

  const db = {
    objectStoreNames: { contains: () => true },
    transaction,
    close: () => {},
  };

  vi.stubGlobal("indexedDB", {
    open() {
      const req: Record<string, unknown> = { result: db };
      setTimeout(() => (req.onsuccess as (() => void) | undefined)?.(), 0);
      return req;
    },
  });
  return data;
}

const entry = (id: string) => ({
  id,
  meetingCode: "abc",
  meetingTitle: "Sunday service",
  recordingId: null,
  mode: "video" as const,
  filename: "service.webm",
  mime: "video/webm",
  durationSec: 5400,
  bytes: 400_000_000,
  createdAt: Date.now(),
  blob: new Blob(["x"]),
});

let mode: Mode = "commit";

beforeEach(() => {
  mode = "commit";
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a recording is only called kept once the device has really kept it", () => {
  it("resolves when the write commits", async () => {
    const data = installFakeIndexedDB(() => mode);
    const vault = await import("@/lib/recording-vault");
    await expect(vault.keepRecording(entry("r1"))).resolves.toBeUndefined();
    expect(data.has("r1")).toBe(true);
  });

  it("throws when the transaction aborts at commit, though the request succeeded", async () => {
    // The old code resolved on the request's success and told the host their
    // service was safe; the meeting room then let go of the only copy.
    installFakeIndexedDB(() => mode);
    mode = "abort-at-commit";
    const vault = await import("@/lib/recording-vault");
    const err = await vault.keepRecording(entry("r2")).catch((e) => e);
    expect(err).toBeInstanceOf(vault.VaultUnavailable);
    expect(String(err.message)).toMatch(/out of space/i);
  });

  it("throws when the write cannot even be attempted", async () => {
    installFakeIndexedDB(() => mode);
    mode = "throw-on-put";
    const vault = await import("@/lib/recording-vault");
    await expect(vault.keepRecording(entry("r3"))).rejects.toBeInstanceOf(vault.VaultUnavailable);
  });

  it("throws, rather than returning quietly, where there is no IndexedDB at all", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const vault = await import("@/lib/recording-vault");
    await expect(vault.keepRecording(entry("r4"))).rejects.toBeInstanceOf(vault.VaultUnavailable);
  });

  it("rejects when a request fails, rather than letting the transaction commit without it", async () => {
    // Cancelling the request's error event (preventDefault) is what stops a
    // transaction aborting; a vault that did so reported failed writes as done.
    installFakeIndexedDB(() => mode);
    mode = "request-error";
    const vault = await import("@/lib/recording-vault");
    const err = await vault.keepRecording(entry("r6")).catch((e) => e);
    expect(err).toBeInstanceOf(vault.VaultUnavailable);
    expect((err.cause as { name?: string }).name).toBe("ConstraintError");
  });

  it("does not report a failed progress write as done", async () => {
    const data = installFakeIndexedDB(() => mode);
    const vault = await import("@/lib/recording-vault");
    await vault.keepRecording(entry("r7"));
    mode = "request-error";
    await expect(vault.noteFailure("r7", "network")).rejects.toMatchObject({ name: "ConstraintError" });
    expect((data.get("r7") as { attempts: number }).attempts).toBe(0);
  });

  it("starts the backoff clock on a refusal, so a refused upload is not retried every 20s", async () => {
    const data = installFakeIndexedDB(() => mode);
    const vault = await import("@/lib/recording-vault");
    await vault.keepRecording(entry("r5"));
    const before = Date.now();
    await vault.noteFailure("r5", "Your role can't save this recording.");
    const saved = data.get("r5") as { attempts: number; lastAttemptAt?: number; lastError: string };
    expect(saved.attempts).toBe(1);
    expect(saved.lastError).toMatch(/role/);
    expect(saved.lastAttemptAt).toBeGreaterThanOrEqual(before);
  });
});
