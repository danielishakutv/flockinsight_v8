import "dotenv/config";
import { Pool } from "pg";

/**
 * What is sitting in the SMS queue, and how old it is. READ-ONLY.
 *
 * Changes nothing, sends nothing, charges nothing. Safe on production.
 *
 * Exists because `psql` is not installed on the server and the question — "how
 * many messages have been stuck, and since when?" — had to be answerable
 * before deciding whether turning the flush on was safe. The app already holds
 * a database connection string; needing a package installed to read one's own
 * table is a reason not to look, and not looking is how the queue went unseen
 * for months in the first place.
 *
 * Usage, from the app directory (where .env is):
 *   pnpm exec tsx scripts/sms-queue-report.ts
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function rows(title: string, data: Record<string, unknown>[]) {
  console.log(`\n== ${title}`);
  if (data.length === 0) {
    console.log("   (nothing)");
    return;
  }
  console.table(data);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Run this from the app directory, where .env is.",
    );
    process.exit(1);
  }

  const byStatus = await pool.query(`
    select status,
           count(*)                            as batches,
           sum(jsonb_array_length(recipients)) as messages,
           min(send_after)                     as oldest,
           max(send_after)                     as newest
      from scheduled_sms
     group by status
     order by status
  `);
  rows("Queue by status", byStatus.rows);

  const byAge = await pool.query(`
    select case
             when send_after < now() - interval '24 hours' then '1. over 24h (will be expired, not sent)'
             when send_after < now()                       then '2. due now'
             else                                               '3. future'
           end                                 as age,
           count(*)                            as batches,
           sum(jsonb_array_length(recipients)) as messages
      from scheduled_sms
     where status = 'queued'
     group by 1
     order by 1
  `);
  rows("Queued, by age", byAge.rows);

  /*
   * The oldest few, named. A total says how big the problem is; these say what
   * it actually was — "service reminder, 61 recipients, 3 August" is the line
   * that tells you whether sending it now would be wrong.
   */
  const oldest = await pool.query(`
    select c.name                              as church,
           s.reason,
           s.audience,
           jsonb_array_length(s.recipients)    as messages,
           s.send_after,
           s.attempts
      from scheduled_sms s
      join church c on c.id = s.church_id
     where s.status = 'queued'
     order by s.send_after asc
     limit 10
  `);
  rows("Oldest queued batches", oldest.rows);

  const crons = await pool.query(`
    select job, max(started_at) as last_run
      from cron_run
     group by job
     order by last_run desc nulls last
  `);
  rows("Last run of each scheduled job (absent = never run)", crons.rows);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end().catch(() => {
    /* The report already failed; a failure to close is not the news. */
  });
  process.exit(1);
});
