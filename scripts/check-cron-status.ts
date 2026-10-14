import "dotenv/config";
import { Pool } from "pg";
import {
  CRON_JOBS,
  isCronDue,
  isCronOverdue,
  nextFireAfter,
  type CronJob,
} from "../src/lib/cron-schedule";
import { describeMeta } from "../src/lib/cron-meta";

/**
 * Prints every scheduled job's real state from the database, using the same
 * rules the health page uses: when it last ran, what it did, and when it is
 * next due. Run it on the server to see exactly which crons are genuinely
 * missing versus merely running on a slower schedule.
 *
 * Usage: pnpm exec tsx scripts/check-cron-status.ts
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function ago(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function inFuture(d: Date, now: Date): string {
  const mins = Math.max(0, Math.round((d.getTime() - now.getTime()) / 60_000));
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.round(mins / 60)}h`;
}

function every(mins: number): string {
  if (mins >= 1440) return `every ${mins / 1440}d`;
  if (mins >= 60) return `every ${mins / 60}h`;
  return `every ${mins}m`;
}

async function main() {
  const { rows } = await pool.query(`
    select distinct on (job) job, started_at, duration_ms, ok, error, meta
      from cron_run
     order by job, started_at desc
  `);
  const latest = new Map(rows.map((r) => [r.job, r]));
  const now = new Date();

  console.log(`Scheduled jobs (UTC now ${now.toISOString().slice(11, 16)}):\n`);
  let problems = 0;

  for (const job of Object.keys(CRON_JOBS) as CronJob[]) {
    const meta = CRON_JOBS[job];
    const row = latest.get(job);
    const lastRunAt = row ? new Date(row.started_at) : null;
    const overdue = isCronOverdue(lastRunAt, meta.intervalMinutes, now);
    const failing = row?.ok === false;
    const due = isCronDue(lastRunAt, meta.cron, now);

    if (overdue || failing) problems++;

    const mark = overdue ? "OVERDUE" : failing ? "FAILING" : "ok     ";
    const when = lastRunAt ? ago(lastRunAt) : "never run";
    const next = due ? "due now" : inFuture(nextFireAfter(meta.cron, now), now);
    console.log(
      `  ${mark}  ${meta.label.padEnd(28)} ${when.padEnd(10)} ${every(meta.intervalMinutes).padEnd(10)} ${meta.cron.padEnd(14)} next ${next}`,
    );
    if (row?.duration_ms != null || row?.meta) {
      const took = row.duration_ms != null ? `took ${row.duration_ms}ms` : "";
      const did = describeMeta(row.meta ?? null);
      const line = [took, did].filter(Boolean).join(" · ");
      if (line) console.log(`           ${line}`);
    }
    if (failing && row.error) console.log(`           last error: ${row.error}`);
  }

  console.log(
    problems === 0
      ? "\nEverything is running on schedule."
      : `\n${problems} job(s) need attention. "never run" means the scheduler is not running it: with IN_APP_CRON=true check CRON_SECRET and the [scheduler] lines in the server log; without it, the job is missing from the crontab.`,
  );

  await pool.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
