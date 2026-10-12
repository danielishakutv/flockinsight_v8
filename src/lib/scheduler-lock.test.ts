import { describe, expect, it } from "vitest";
import { lockIdFor, withJobLock, type LockClient, type LockPool } from "@/lib/scheduler-lock";

/**
 * The scheduler's lock, against a fake Postgres that keeps session locks the
 * way the real one does.
 *
 * What matters about an advisory lock is WHICH SESSION holds it: unlocking
 * from any other session returns false and changes nothing, and a lock dies
 * only with its own session. The scheduler used to take the lock and drop it
 * as two separate pool queries, so the two usually ran on different sessions
 * and the lock leaked onto a pooled connection. A unit test that does not
 * model sessions cannot see that, so this one does.
 */

/** One Postgres server: advisory locks keyed by id, owned by a session. */
class FakeServer {
  locks = new Map<number, { session: number; count: number }>();
  private nextSession = 1;
  open(): number {
    return this.nextSession++;
  }
  terminate(session: number) {
    for (const [id, l] of this.locks) if (l.session === session) this.locks.delete(id);
  }
  tryLock(session: number, id: number): boolean {
    const held = this.locks.get(id);
    if (!held) {
      this.locks.set(id, { session, count: 1 });
      return true;
    }
    if (held.session !== session) return false;
    held.count++; // session locks are re-entrant
    return true;
  }
  unlock(session: number, id: number): boolean {
    const held = this.locks.get(id);
    if (!held || held.session !== session) return false; // a WARNING, not an error
    if (--held.count === 0) this.locks.delete(id);
    return true;
  }
}

/** A node-postgres-shaped pool over it: LIFO idle list, like pg-pool. */
class FakePool implements LockPool {
  idle: FakeClient[] = [];
  destroyed = 0;
  constructor(public server: FakeServer) {}
  async connect(): Promise<FakeClient> {
    return this.idle.pop() ?? new FakeClient(this);
  }
  /** pool.query: borrow a client for one statement, then give it back. */
  async query(text: string, values: unknown[]) {
    const c = await this.connect();
    try {
      return await c.query(text, values);
    } finally {
      c.release();
    }
  }
}

class FakeClient implements LockClient {
  session: number;
  released: (Error | boolean | undefined)[] = [];
  private errorListeners = new Set<(e: Error) => void>();
  constructor(private pool: FakePool) {
    this.session = pool.server.open();
  }
  on(_event: "error", fn: (e: Error) => void) {
    this.errorListeners.add(fn);
  }
  off(_event: "error", fn: (e: Error) => void) {
    this.errorListeners.delete(fn);
  }
  get listenerCount() {
    return this.errorListeners.size;
  }
  /**
   * What node-postgres does when the backend goes away: emit 'error'. On a
   * real EventEmitter an 'error' with no listener is thrown — uncaught, and the
   * worker dies — so the fake throws too.
   */
  die(err: Error) {
    this.pool.server.terminate(this.session);
    if (this.errorListeners.size === 0) throw err;
    for (const fn of this.errorListeners) fn(err);
  }
  async query<R extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    const id = values[0] as number;
    if (text.includes("pg_try_advisory_lock"))
      return { rows: [{ locked: this.pool.server.tryLock(this.session, id) }] as unknown as R[] };
    if (text.includes("pg_advisory_unlock"))
      return { rows: [{ unlocked: this.pool.server.unlock(this.session, id) }] as unknown as R[] };
    return { rows: [] as R[] };
  }
  release(err?: Error | boolean) {
    this.released.push(err);
    if (err) {
      // pg-pool closes the connection; Postgres drops its session locks.
      this.pool.server.terminate(this.session);
      this.pool.destroyed++;
      return;
    }
    this.pool.idle.push(this);
  }
}

/** A promise you resolve from outside, to hold a job open mid-run. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

const due = async () => true;

describe("scheduler lock", () => {
  it("takes, holds and releases the lock on ONE session", async () => {
    const server = new FakeServer();
    const pool = new FakePool(server);
    const id = lockIdFor("broadcasts");
    let heldDuringRun: { session: number } | undefined;

    const out = await withJobLock(pool, "broadcasts", due, async () => {
      heldDuringRun = server.locks.get(id);
      // Ordinary traffic on the same pool while the job runs — what used to
      // shuffle the idle list so the unlock landed on another client.
      await Promise.all([pool.query("select 1", []), pool.query("select 2", [])]);
    });

    expect(out).toBe("ran");
    expect(heldDuringRun).toBeDefined();
    // Nothing is left holding it, on any session.
    expect(server.locks.size).toBe(0);
    expect(pool.destroyed).toBe(0);
  });

  it("would leak the lock the old way, which is why the test above exists", async () => {
    // The previous implementation: lock and unlock as two separate pool queries.
    const server = new FakeServer();
    const pool = new FakePool(server);
    const id = lockIdFor("sms-queue");
    // Two clients in the pool, as there are after any traffic.
    const a = await pool.connect();
    const b = await pool.connect();
    a.release();
    b.release();

    await pool.query("select pg_try_advisory_lock($1) as locked", [id]);
    // The job ran its own queries; LIFO order is now different.
    const c = await pool.connect();
    const d = await pool.connect();
    c.release();
    d.release();
    const u = await pool.query("select pg_advisory_unlock($1) as unlocked", [id]);

    expect(u.rows[0]).toEqual({ unlocked: false });
    expect(server.locks.has(id)).toBe(true); // still held, by a pooled connection
  });

  it("lets exactly one of two workers run a job", async () => {
    const server = new FakeServer();
    const workerA = new FakePool(server);
    const workerB = new FakePool(server);
    const hold = gate();
    let runs = 0;

    const a = withJobLock(workerA, "reminders", due, async () => {
      runs++;
      await hold.p;
    });
    // Let A take the lock before B tries.
    await new Promise((r) => setTimeout(r, 0));
    const b = await withJobLock(workerB, "reminders", due, async () => {
      runs++;
    });

    expect(b).toBe("locked");
    hold.open();
    expect(await a).toBe("ran");
    expect(runs).toBe(1);
    expect(server.locks.size).toBe(0);
  });

  it("does not re-run a job the other worker has just finished", async () => {
    // Worker B read "due" at the start of its tick, spent minutes elsewhere,
    // and reaches the job after worker A has run it. The lock is free; the
    // fresh check is what stops the second run.
    const server = new FakeServer();
    let lastRunAt: number | null = null;
    const stillDue = async () => lastRunAt === null;
    let runs = 0;
    const body = async () => {
      runs++;
      lastRunAt = Date.now();
    };

    expect(await withJobLock(new FakePool(server), "storage", stillDue, body)).toBe("ran");
    expect(await withJobLock(new FakePool(server), "storage", stillDue, body)).toBe("not-due");
    expect(runs).toBe(1);
    expect(server.locks.size).toBe(0);
  });

  it("releases the lock when the job throws, and passes the error on", async () => {
    const server = new FakeServer();
    const pool = new FakePool(server);
    await expect(
      withJobLock(pool, "devotionals", due, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(server.locks.size).toBe(0);

    // And the job can be taken again straight away, from either worker.
    expect(await withJobLock(new FakePool(server), "devotionals", due, async () => {})).toBe("ran");
  });

  it("drops the connection when the unlock does not take, so the lock dies with it", async () => {
    const server = new FakeServer();
    const pool = new FakePool(server);
    const id = lockIdFor("meetings");
    const realUnlock = server.unlock.bind(server);
    server.unlock = () => false; // as if the unlock had landed on the wrong session

    await withJobLock(pool, "meetings", due, async () => {});
    server.unlock = realUnlock;

    expect(pool.destroyed).toBe(1);
    expect(server.locks.has(id)).toBe(false);
    expect(pool.idle).toHaveLength(0); // never handed back to the pool
  });
});

describe("a connection that dies while the job runs", () => {
  it("is caught, not thrown, and the dead client is destroyed rather than pooled", async () => {
    const server = new FakeServer();
    const pool = new FakePool(server);
    // Hand out a known client so the test can kill it mid-job.
    const held = new FakeClient(pool);
    pool.idle.push(held);
    const dropped = new Error("terminating connection due to administrator command");

    const out = await withJobLock(pool, "media-transcode", due, async () => {
      // A Postgres restart while the job is between queries. Without a
      // listener this throws out of the emitter — in production, an uncaught
      // exception that takes the PM2 worker down.
      expect(() => held.die(dropped)).not.toThrow();
    });

    expect(out).toBe("ran");
    expect(held.released).toEqual([dropped]);
    expect(pool.idle).not.toContain(held);
    expect(server.locks.size).toBe(0); // died with its session
    expect(held.listenerCount).toBe(0); // ours came off before release
  });

  it("leaves no listener behind on a client that goes back to the pool", async () => {
    const pool = new FakePool(new FakeServer());
    await withJobLock(pool, "broadcasts", due, async () => {});
    expect(pool.idle).toHaveLength(1);
    expect((pool.idle[0] as FakeClient).listenerCount).toBe(0);
  });
});

describe("lock ids", () => {
  it("matches the FNV-1a restated in scheduler.test.ts", () => {
    // Two processes must compute the same number. Pinned values, so a change
    // to the hash cannot pass by agreeing with itself.
    let hash = 0x811c9dc5;
    for (const ch of "broadcasts") {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    expect(lockIdFor("broadcasts")).toBe(Math.abs(hash | 0));
  });
});
