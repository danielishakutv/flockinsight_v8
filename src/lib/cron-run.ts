import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cronRun } from "@/db/schema";
import { compactMeta, type CronMeta } from "@/lib/cron-meta";

/**
 * Cron heartbeats.
 *
 * Without a recorded run there is no way to distinguish "the job ran and had
 * nothing to do" from "the job has not run since the server rebooted" — and a
 * crontab silently lost to a reboot is a failure this platform has already
 * lived through. Every execution writes a row; liveness is then a query.
 *
 * And without the job's own summary on that row there is no way to
 * distinguish "ran and had nothing to do" from "ran and did nothing": a
 * six-millisecond run rendered as "took 0.0s" looks, to anyone reasonable,
 * like a job that is not doing its work. So the row also carries what the job
 * answered — see cron-meta.ts.
 */

// The registry and the lateness rule live in a pure module so they can be
// unit-tested without a database. Imported for use here, and re-exported so
// existing importers of CRON_JOBS / CronJob keep working.
import {
  CRON_JOBS,
  isCronDue,
  isCronOverdue,
  nextFireAfter,
  type CronJob,
} from "@/lib/cron-schedule";

export { CRON_JOBS, isCronOverdue };
export type { CronJob };

/**
 * Run a cron job's body, recording start, outcome, duration and — when the
 * body answers with JSON, which every route does — a compact copy of that
 * answer.
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

  const finish = async (ok: boolean, error?: string, meta?: CronMeta | null) => {
    if (!runId) return;
    try {
      await db
        .update(cronRun)
        .set({
          finishedAt: new Date(),
          ok,
          durationMs: Date.now() - startedAt.getTime(),
          error: error?.slice(0, 1000),
          meta: meta ?? null,
        })
        .where(sql`${cronRun.id} = ${runId}`);
    } catch (e) {
      console.error(`[cron:${job}] could not record run finish`, e);
    }
  };

  try {
    const result = await fn();
    await finish(true, undefined, await summaryOf(job, result));
    return result;
  } catch (e) {
    await finish(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** The slice of a web Response this needs; duck-typed so no realm matters. */
type ResponseLike = {
  headers: { get(name: string): string | null };
  clone(): { json(): Promise<unknown> };
};

function isResponseLike(v: unknown): v is ResponseLike {
  return (
    typeof v === "object" &&
    v !== null &&
    "headers" in v &&
    typeof (v as { clone?: unknown }).clone === "function" &&
    typeof (v as { headers?: { get?: unknown } }).headers?.get === "function"
  );
}

/**
 * The job's own account of the run, if it gave one.
 *
 * Read from a CLONE, so the body the route is about to send is untouched. A
 * body that is not JSON is simply a run with nothing to say; a JSON body that
 * will not parse is logged, because that is a route answering with a
 * content-type it does not honour, and swallowed, because the run itself was
 * fine.
 */
async function summaryOf(job: CronJob, result: unknown): Promise<CronMeta | null> {
  if (!isResponseLike(result)) return null;
  const type = result.headers.get("content-type") ?? "";
  if (!/\bjson\b/i.test(type)) return null;
  try {
    return compactMeta(await result.clone().json());
  } catch (e) {
    console.warn(`[cron:${job}] answered with a JSON content-type but no JSON body`, e);
    return null;
  }
}

export type CronLiveness = {
  job: CronJob;
  label: string;
  intervalMinutes: number;
  /** The UTC cron expression the scheduler fires on. */
  cron: string;
  lastRunAt: Date | null;
  lastOk: boolean | null;
  lastDurationMs: number | null;
  lastError: string | null;
  /** What the last run reported doing. See cron-meta.ts. */
  lastMeta: CronMeta | null;
  /** The next minute the expression names after now. */
  nextRunAt: Date;
  /** A named minute has passed since the last start. What the scheduler acts on. */
  due: boolean;
  /** Its interval plus a grace period has elapsed. What alerts act on. */
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
      meta: cronRun.meta,
    })
    .from(cronRun)
    .orderBy(cronRun.job, desc(cronRun.startedAt));

  const latest = new Map(rows.map((r) => [r.job, r]));
  const now = new Date();

  return (Object.keys(CRON_JOBS) as CronJob[]).map((job) => {
    const meta = CRON_JOBS[job];
    const row = latest.get(job);
    const lastRunAt = row?.startedAt ?? null;

    return {
      job,
      label: meta.label,
      intervalMinutes: meta.intervalMinutes,
      cron: meta.cron,
      lastRunAt,
      lastOk: row?.ok ?? null,
      lastDurationMs: row?.durationMs ?? null,
      lastError: row?.error ?? null,
      lastMeta: row?.meta ?? null,
      nextRunAt: nextFireAfter(meta.cron, now),
      /** A named minute has gone by since the last start: run it now. */
      due: isCronDue(lastRunAt, meta.cron, now),
      /** Its interval AND the grace period have elapsed: say something. */
      overdue: isCronOverdue(lastRunAt, meta.intervalMinutes, now),
    };
  });
}

/**
 * Is this one job due right now, read fresh from `cron_run`?
 *
 * The scheduler asks this AFTER taking a job's lock. `getCronLiveness` is read
 * once at the start of a tick, and a tick can spend minutes on earlier jobs; by
 * the time it reaches a later one, the other worker may have run it and
 * finished. With the lock held nobody else can be starting it, so this answer
 * is the one that counts — the snapshot only decides whether to try.
 */
export async function isJobStillDue(job: CronJob, now: Date = new Date()): Promise<boolean> {
  const [last] = await db
    .select({ startedAt: cronRun.startedAt })
    .from(cronRun)
    .where(eq(cronRun.job, job))
    .orderBy(desc(cronRun.startedAt))
    .limit(1);
  return isCronDue(last?.startedAt ?? null, CRON_JOBS[job].cron, now);
}

/**
 * Drop heartbeats older than `days`.
 *
 * Nothing reads past the latest row per job, and at five-minute cadences the
 * table grows by about 1,700 rows a day — it had reached 44,000 rows with no
 * ceiling. Two months is enough to see a job's history on the health page and
 * to answer "when did this stop" after a holiday.
 */
export async function pruneCronRuns(days = 60): Promise<number> {
  const res = await db
    .delete(cronRun)
    .where(sql`${cronRun.startedAt} < now() - make_interval(days => ${days})`)
    .returning({ id: cronRun.id });
  return res.length;
}
