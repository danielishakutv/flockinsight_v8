import "server-only";
import { db } from "@/db";
import { msUntilNextMinute, type CronJob } from "@/lib/cron-schedule";
import { getCronLiveness, isJobStillDue } from "@/lib/cron-run";
import { withJobLock, type LockPool } from "@/lib/scheduler-lock";

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
 * runs the job and the other moves on. The lock is session-scoped, so it is
 * taken, held and released on ONE checked-out connection (see
 * scheduler-lock.ts for what happened when it was not); even if a worker dies
 * holding one, the connection closing drops it. Double-sending a broadcast to a
 * congregation is not an acceptable failure, so this is belt and braces rather
 * than a nicety.
 *
 * WHAT DECIDES A JOB IS DUE is `cron_run` — the same table the health page
 * reads — not a timer in memory. A worker that restarts does not re-run
 * everything, and two workers cannot disagree about when a job last ran.
 *
 * WHEN A JOB IS DUE is its cron expression, in UTC, and the ticks land just
 * after the top of each minute so a job named for :20 runs at :20:00, not
 * somewhere in the minute after. This used to be a stopwatch — "an hour since
 * the last start" checked once a minute — and a stopwatch drifts: the birthday
 * sweep slid from :00 to :33 in nine days and would have gone on round the
 * clock. See `isCronDue` in cron-schedule.ts.
 *
 * Opt-in via `IN_APP_CRON=true`, because running both this and a crontab would
 * double every job. Turn it on, then remove the crontab lines.
 */

/**
 * The first tick waits for the server to be answering on its own port before
 * it calls itself; after that, ticks follow the clock.
 */
const BOOT_DELAY_MS = 20_000;

/**
 * How far past :00 seconds a tick lands. A timer that fires a hair early would
 * read the previous minute and run nothing; a quarter of a second is well
 * clear of that and still inside the minute a job is named for.
 */
const SETTLE_MS = 250;

/*
 * The lock itself — one pooled connection held for the whole job, and a fresh
 * "is it still due?" once the lock is taken — lives in scheduler-lock.ts, where
 * it is tested against a fake pool that behaves like Postgres session locks.
 *
 * `db.$client` is the node-postgres Pool drizzle was built on: the same pool,
 * so the scheduler holds one of its ten connections while a job runs and never
 * more than one per job.
 */
const pool: LockPool = db.$client as unknown as LockPool;

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

  const runDueJobs = async () => {
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

      /*
       * `row.due` is only a reason to TRY: it was read at the start of the tick.
       * Inside the lock the job is asked again, fresh, because the other worker
       * may have run it while this one was busy with an earlier job.
       */
      try {
        await withJobLock(
          pool,
          row.job,
          () => isJobStillDue(row.job),
          () => runJob(row.job),
        );
      } catch (e) {
        console.error(`[scheduler] ${row.job} failed`, e);
      }
    }
  };

  /*
   * One tick at a time per worker.
   *
   * The next tick is only armed once the current one has finished, and a tick
   * can run for many minutes. A second tick on the SAME worker starting while
   * the first was still inside a job would walk the list beside it; the guard
   * is belt and braces against that ever being reintroduced.
   */
  let ticking = false;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runDueJobs();
    } finally {
      ticking = false;
    }
  };

  /*
   * Follow the clock, not an interval.
   *
   * `setInterval(60_000)` keeps whatever phase it started with and slips a
   * little each round, so a job's minute is whichever one the ticks happened
   * to fall in. Arming a fresh timeout for the next :00 after every tick keeps
   * them on the minute for as long as the process lives — and a tick that
   * spends three minutes inside a slow job simply resumes on the minute after
   * it finishes, with every named minute it missed caught up in one run.
   */
  const armNextTick = () => {
    setTimeout(() => {
      void tick().finally(armNextTick);
    }, msUntilNextMinute(new Date()) + SETTLE_MS);
  };

  setTimeout(() => {
    void tick().finally(armNextTick);
  }, BOOT_DELAY_MS);
}
