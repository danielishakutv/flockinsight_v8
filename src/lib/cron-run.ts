import "server-only";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { cronRun } from "@/db/schema";

/**
 * Cron heartbeats.
 *
 * Without a recorded run there is no way to distinguish "the job ran and had
 * nothing to do" from "the job has not run since the server rebooted" — and a
 * crontab silently lost to a reboot is a failure this platform has already
 * lived through. Every execution writes a row; liveness is then a query.
 */

// The registry and the lateness rule live in a pure module so they can be
// unit-tested without a database. Imported for use here, and re-exported so
// existing importers of CRON_JOBS / CronJob keep working.
import { CRON_JOBS, isCronOverdue, type CronJob } from "@/lib/cron-schedule";

export { CRON_JOBS, isCronOverdue };
export type { CronJob };

/**
 * Run a cron job's body, recording start, outcome and duration.
 *
 * Call this *after* the CRON_SECRET check so unauthorised probes cannot forge
 * heartbeats. Heartbeat writes never mask the job's own result: a failure to
 * record is logged and swallowed, while an error from `fn` is recorded and
 * rethrown.
 */
export async function withCronRun<T>(
  job: CronJob,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  let runId: string | null = null;

  try {
    const [row] = await db
      .insert(cronRun)
      .values({ job, startedAt })
      .returning({ id: cronRun.id });
    runId = row?.id ?? null;
  } catch (e) {
    console.error(`[cron:${job}] could not record run start`, e);
  }

  const finish = async (ok: boolean, error?: string) => {
    if (!runId) return;
    try {
      await db
        .update(cronRun)
        .set({
          finishedAt: new Date(),
          ok,
          durationMs: Date.now() - startedAt.getTime(),
          error: error?.slice(0, 1000),
        })
        .where(sql`${cronRun.id} = ${runId}`);
    } catch (e) {
      console.error(`[cron:${job}] could not record run finish`, e);
    }
  };

  try {
    const result = await fn();
    await finish(true);
    return result;
  } catch (e) {
    await finish(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export type CronLiveness = {
  job: CronJob;
  label: string;
  intervalMinutes: number;
  lastRunAt: Date | null;
  lastOk: boolean | null;
  lastDurationMs: number | null;
  lastError: string | null;
  overdue: boolean;
};

/**
 * Latest run per job, joined against the expected schedule. A job that has
 * never run at all is overdue by definition — that is the whole point.
 */
export async function getCronLiveness(): Promise<CronLiveness[]> {
  const rows = await db
    .selectDistinctOn([cronRun.job], {
      job: cronRun.job,
      startedAt: cronRun.startedAt,
      ok: cronRun.ok,
      durationMs: cronRun.durationMs,
      error: cronRun.error,
    })
    .from(cronRun)
    .orderBy(cronRun.job, desc(cronRun.startedAt));

  const latest = new Map(rows.map((r) => [r.job, r]));
  const now = new Date();

  return (Object.keys(CRON_JOBS) as CronJob[]).map((job) => {
    const meta = CRON_JOBS[job];
    const row = latest.get(job);
    const lastRunAt = row?.startedAt ?? null;
    const overdue = isCronOverdue(lastRunAt, meta.intervalMinutes, now);

    return {
      job,
      label: meta.label,
      intervalMinutes: meta.intervalMinutes,
      lastRunAt,
      lastOk: row?.ok ?? null,
      lastDurationMs: row?.durationMs ?? null,
      lastError: row?.error ?? null,
      overdue,
    };
  });
}
