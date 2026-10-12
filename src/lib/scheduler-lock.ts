/**
 * The in-app scheduler's lock — one job, one worker, one run.
 *
 * Pure (no `@/db`) so it can be tested against a fake pool that behaves the way
 * Postgres session locks do. `scheduler.ts` hands it the real pool.
 *
 * WHAT WAS WRONG. `pg_try_advisory_lock` and `pg_advisory_unlock` were two
 * separate `db.execute` calls on a pool of ten. Each borrowed whichever client
 * was idle and gave it straight back, so the lock was taken on one session and
 * the unlock usually ran on another. An unlock from the wrong session is a
 * no-op with a WARNING, not an error: the lock stayed on a pooled connection
 * nobody knew held it. The other PM2 worker could then never take that job,
 * this one only when its try-lock happened to land on the same client again,
 * and when that client finally idled out the lock vanished — possibly halfway
 * through a run. Nothing logged any of it; the health page eventually showed
 * jobs as late.
 *
 * And the decision to run was a snapshot taken at the start of a tick. A worker
 * that spent minutes on one job could reach the next with a stale "due", find
 * the lock free because the OTHER worker had just finished it, and run it a
 * second time. Most jobs survive that through their own claims; the owner
 * reminder emails do not.
 *
 * THE RULE NOW. One client is checked out for the whole job, so the lock, the
 * job and the unlock all happen on the same session and the connection cannot
 * idle out underneath it. Having taken the lock, the job is asked again whether
 * it is still due — the only answer that cannot be stale, because nobody else
 * can be running it at that moment. If the unlock fails, the client is
 * destroyed rather than returned, so a lock it might still hold dies with the
 * connection instead of living on in the pool.
 *
 * Not `pg_try_advisory_xact_lock`: that would hold a transaction open for as
 * long as a job runs, up to ten minutes, which is its own kind of trouble.
 */

/** The slice of a node-postgres PoolClient this needs. */
export type LockClient = {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
  /** Passing an error destroys the connection instead of pooling it. */
  release(err?: Error | boolean): void;
  on(event: "error", fn: (e: Error) => void): void;
  off(event: "error", fn: (e: Error) => void): void;
};

/** The slice of a node-postgres Pool this needs. */
export type LockPool = { connect(): Promise<LockClient> };

/**
 * A stable lock id per job.
 *
 * Postgres advisory locks are keyed by number, so the job name is hashed. FNV-1a
 * for stability across processes and releases — `String.hashCode` does not
 * exist in JS and anything involving `Math.random` or object identity would
 * give the two workers different numbers, which defeats the entire purpose.
 */
export function lockIdFor(job: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < job.length; i++) {
    hash ^= job.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Positive and well inside int4, which is what the one-argument form takes.
  return Math.abs(hash | 0);
}

export type LockOutcome = "ran" | "locked" | "not-due";

/**
 * Run `body` if this worker can take the job's lock AND the job is still due
 * once it has it. Otherwise do nothing.
 *
 * "locked" is the normal case on one of the two workers. "not-due" is the case
 * that used to double-run: the other worker got there first and has finished.
 */
export async function withJobLock(
  pool: LockPool,
  job: string,
  isStillDue: () => Promise<boolean>,
  body: () => Promise<void>,
): Promise<LockOutcome> {
  const id = lockIdFor(job);
  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;

  // pg-pool takes its own 'error' listener off a client while it is checked
  // out, and this one sits idle for the whole job — ten minutes for a cron,
  // several forty-minute encodes for a transcode. If Postgres restarts or the
  // backend is terminated meanwhile, the client emits 'error' with nobody
  // listening, Node throws it as uncaught, and PM2 restarts the worker with
  // every in-flight request on it. Listen, record it, and let the release
  // below destroy the dead connection (which also drops the lock it held).
  const onError = (e: Error) => {
    console.error(`[scheduler] connection holding the ${job} lock died`, e);
    releaseError ??= e;
  };
  client.on("error", onError);

  try {
    const r = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [id],
    );
    locked = r.rows[0]?.locked === true;
    if (!locked) return "locked";

    if (!(await isStillDue())) return "not-due";

    await body();
    return "ran";
  } catch (e) {
    // The connection may be in an unknown state; do not hand it back to the
    // pool for somebody else's query.
    releaseError = e instanceof Error ? e : new Error(String(e));
    throw e;
  } finally {
    if (locked) {
      // Always, including when the job threw. A held lock would stop this job
      // for ever on every worker, which is worse than the failure that caused it.
      try {
        const u = await client.query<{ unlocked: boolean }>(
          "select pg_advisory_unlock($1) as unlocked",
          [id],
        );
        if (u.rows[0]?.unlocked !== true) {
          console.error(`[scheduler] unlock of ${job} returned false; dropping the connection`);
          releaseError ??= new Error(`advisory unlock of ${job} returned false`);
        }
      } catch (e) {
        console.error(`[scheduler] unlock of ${job} failed; dropping the connection`, e);
        releaseError ??= e instanceof Error ? e : new Error(String(e));
      }
    }
    // With an error, node-postgres closes the connection, and Postgres releases
    // every session lock it held. Without one, the client goes back clean.
    // Our listener comes off first: pg-pool puts its own back on release.
    client.off("error", onError);
    client.release(releaseError);
  }
}
