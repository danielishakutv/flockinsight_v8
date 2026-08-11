import "dotenv/config";
import { Pool } from "pg";
import { CRON_JOBS, isCronOverdue, type CronJob } from "../src/lib/cron-schedule";

/**
 * Prints every scheduled job's real state from the database, using the same
 * rule the health page uses. Run it on the server to see exactly which crons
 * are genuinely missing versus merely running on a slower schedule.
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

function every(mins: number): string {
  if (mins >= 1440) return `every ${mins / 1440}d`;
  if (mins >= 60) return `every ${mins / 60}h`;
  return `every ${mins}m`;
}

async function main() {
  const { rows } = await pool.query(`
    select distinct on (job) job, started_at, ok, error
      from cron_run
     order by job, started_at desc
  `);
  const latest = new Map(rows.map((r) => [r.job, r]));
  const now = new Date();

  console.log("Scheduled jobs:\n");
  let problems = 0;

  for (const job of Object.keys(CRON_JOBS) as CronJob[]) {
    const meta = CRON_JOBS[job];
    const row = latest.get(job);
    const lastRunAt = row ? new Date(row.started_at) : null;
    const overdue = isCronOverdue(lastRunAt, meta.intervalMinutes, now);
    const failing = row?.ok === false;

    if (overdue || failing) problems++;

    const mark = overdue ? "OVERDUE" : failing ? "FAILING" : "ok     ";
    const when = lastRunAt ? ago(lastRunAt) : "never run";
    console.log(
      `  ${mark}  ${meta.label.padEnd(28)} ${when.padEnd(12)} ${every(meta.intervalMinutes)}`,
    );
    if (failing && row.error) console.log(`           last error: ${row.error}`);
  }

  console.log(
    problems === 0
      ? "\nEverything is running on schedule."
      : `\n${problems} job(s) need attention. "never run" means it is missing from the crontab.`,
  );

  await pool.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
