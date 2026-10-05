import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CronJob } from "@/lib/cron-schedule";
import { getCronLiveness } from "@/lib/cron-run";

/**
 * Run the scheduled jobs from inside the app, so there is no crontab to lose.
 *
 * Every scheduled job on this platform has, at some point, silently stopped
 * because of something outside the code: a crontab entry that was never saved,
 * a line with no trailing newline, a `%` cron turned into a newline, a secret
 * that did not match, a reboot that took the file with it. The jobs themselves
 * were fine every time. That is a bad place for the reliability of billing
 * reminders and devotional delivery to live.
 *
 * So the app schedules itself. The HTTP endpoints stay exactly as they are —
 * they are useful for running a job by hand and for an external monitor — but
 * nothing has to call them on time any more.
 *
 * TWO WORKERS, ONE RUN. PM2 runs this in cluster mode, so every tick happens
 * twice. A Postgres advisory lock settles it: whichever worker takes the lock
 * runs the job and the other moves on. The lock is session-scoped and released
 * in a `finally`, and even if a worker dies holding one, the connection closing
 * drops it. Double-sending a broadcast to a congregation is not an acceptable
 * failure, so this is belt and braces rather than a nicety.
 *
 * WHAT DECIDES A JOB IS DUE is `cron_run` — the same table the health page
 * reads — not a timer in memory. A worker that restarts does not re-run
 * everything, and two workers cannot disagree about when a job last ran.
 *
 * Opt-in via `IN_APP_CRON=true`, because running both this and a crontab would
 * double every job. Turn it on, then remove the crontab lines.
 */

/** How often to look for work. Jobs are due on their own intervals. */
const TICK_MS = 60_000;

/**
 * A stable lock id per job.
 *
 * Postgres advisory locks are keyed by number, so the job name is hashed. FNV-1a
 * for stability across processes and releases — `String.hashCode` does not
 * exist in JS and anything involving `Math.random` or object identity would
 * give the two workers different numbers, which defeats the entire purpose.
 */
function lockIdFor(job: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < job.length; i++) {
    hash ^= job.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Positive and well inside int4, which is what the one-argument form takes.
  return Math.abs(hash | 0);
}

/**
 * Run `body` if this worker can take the job's lock, otherwise do nothing.
 *
 * Returns whether it ran, which is only used for logging — a skipped run is
 * the normal case on one of the two workers and is not worth a line.
 */
async function withJobLock(job: string, body: () => Promise<void>): Promise<boolean> {
  const id = lockIdFor(job);

  // node-postgres returns a QueryResult, not an array of rows.
  const result = await db.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${id}) as locked`,
  );
  if (!result.rows[0]?.locked) return false;

  try {
    await body();
    return true;
  } finally {
    // Always, including when the job threw. A held lock would stop this job
    // for ever on every worker, which is worse than the failure that caused it.
    await db.execute(sql`select pg_advisory_unlock(${id})`);
  }
}

/**
 * Ask the job's own route to run, over loopback.
 *
 * Calling the route rather than importing each job's body keeps exactly one
 * definition of what a job does, and keeps `withCronRun` — the heartbeat the
 * health page reads — on the single path. The alternative is a second way to
 * run every job, which is a second way for them to drift apart.
 *
 * Loopback, so it never leaves the machine and no proxy, TLS or firewall is
 * involved. The port comes from the environment PM2 was started with.
 */
async function runJob(job: CronJob): Promise<void> {
  const port = process.env.PORT || "3000";
  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  const res = await fetch(`http://127.0.0.1:${port}/api/cron/${job}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
    // Generous: a broadcast run can legitimately take minutes. Still bounded,
    // because a hung job must not block the next tick for ever.
    signal: AbortSignal.timeout(10 * 60_000),
  });

  if (!res.ok) {
    console.error(`[scheduler] ${job} answered ${res.status}`);
  }
}

let started = false;

/**
 * Start the loop. Safe to call more than once; only the first call does
 * anything, because Next can evaluate a module more than once per process.
 */
export function startScheduler(): void {
  if (started) return;
  if (process.env.IN_APP_CRON !== "true") return;
  if (!process.env.CRON_SECRET) {
    console.warn("[scheduler] IN_APP_CRON is on but CRON_SECRET is not set — not starting");
    return;
  }
  started = true;

  console.log("[scheduler] in-app cron is on; the crontab entries can be removed");

  const tick = async () => {
    let status;
    try {
      status = await getCronLiveness();
    } catch (e) {
      // A database blip must not kill the loop. Next tick will try again.
      console.error("[scheduler] could not read cron status", e);
      return;
    }

    for (const row of status) {
      /*
       * `due`, not `overdue`.
       *
       * This used to read `overdue`, which is the interval PLUS a grace period
       * — the rule for deciding whether to complain, not whether to run. Every
       * job therefore ran at up to half its declared rate: the 5-minute SMS
       * queue flush went every 10, and the 15-minute broadcast job every 30.
       * Nothing looked broken, because the health page uses the same lenient
       * rule and so never reported a job it had itself delayed.
       */
      if (!row.due) continue;

      try {
        await withJobLock(row.job, () => runJob(row.job));
      } catch (e) {
        console.error(`[scheduler] ${row.job} failed`, e);
      }
    }
  };

  // A first pass shortly after boot rather than immediately: the server needs
  // to be answering on its own port before it calls itself.
  setTimeout(() => void tick(), 20_000);
  setInterval(() => void tick(), TICK_MS);
}
