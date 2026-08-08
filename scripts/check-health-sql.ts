import "dotenv/config";
import { Pool } from "pg";

/**
 * Diagnostic: runs the raw SQL behind the superadmin command centre against
 * the live database and reports whether each query executes, plus how many
 * churches the old attendance/giving-only definition of "last activity"
 * wrongly reported as never active.
 *
 * Usage: pnpm exec tsx scripts/check-health-sql.ts
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ACTIVITY_UNION = `
  select church_id, created_at from analytics_event where church_id is not null
  union all select church_id, created_at from attendance_session
  union all select church_id, created_at from giving
  union all select church_id, created_at from member
  union all select church_id, created_at from communication_log
  union all select church_id, created_at from media
  union all select church_id, created_at from form
  union all select church_id, created_at from devotional
`;

async function step(name: string, run: () => Promise<number>) {
  try {
    const n = await run();
    console.log(`  OK   ${name} (${n} rows)`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log("Checking command-centre SQL:\n");

  await step("signals (last seen + active weeks)", async () => {
    const r = await pool.query(`
      select church_id, max(created_at) as last_seen,
             count(distinct date_trunc('week', created_at)) as active_weeks
      from (${ACTIVITY_UNION}) as activity group by church_id`);
    return r.rowCount ?? 0;
  });

  await step("onboarding funnel", async () => {
    const r = await pool.query(`
      select c.id as church_id,
        exists (select 1 from member m where m.church_id = c.id) as has_members,
        (select count(*) from staff s where s.organization_id = c.id) > 1 as has_staff,
        exists (select 1 from attendance_session a where a.church_id = c.id) as has_attendance,
        exists (select 1 from giving g where g.church_id = c.id) as has_giving,
        exists (select 1 from communication_log l where l.church_id = c.id) as has_message
      from church c`);
    return r.rowCount ?? 0;
  });

  await step("growth series (90 day)", async () => {
    const r = await pool.query(`
      with days as (
        select generate_series(
          date_trunc('day', now() - make_interval(days => 89)),
          date_trunc('day', now()), interval '1 day')::date as day
      ),
      signups as (
        select created_at::date as day, count(*) as n from church
        where created_at >= now() - make_interval(days => 90) group by 1
      ),
      active as (
        select created_at::date as day, count(distinct church_id) as n
        from analytics_event where church_id is not null
          and created_at >= now() - make_interval(days => 90) group by 1
      ),
      rev as (
        select created_at::date as day, coalesce(sum(amount), 0) as n from payment
        where status = 'success' and created_at >= now() - make_interval(days => 90)
        group by 1
      )
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(s.n, 0) as signups,
             coalesce(a.n, 0) as active_churches, coalesce(r.n, 0) as revenue
      from days d
      left join signups s on s.day = d.day
      left join active a on a.day = d.day
      left join rev r on r.day = d.day
      order by d.day`);
    return r.rowCount ?? 0;
  });

  await step("cohort retention", async () => {
    const r = await pool.query(`
      with cohort as (
        select id, date_trunc('month', created_at) as month, created_at
        from church where created_at >= now() - interval '12 months'
      ),
      activity as (${ACTIVITY_UNION})
      select to_char(c.month, 'YYYY-MM') as month, count(distinct c.id) as signups,
        count(distinct c.id) filter (where exists (
          select 1 from activity a where a.church_id = c.id
            and a.created_at >= c.created_at + interval '4 weeks'
            and a.created_at <  c.created_at + interval '5 weeks')) as w4,
        count(distinct c.id) filter (where exists (
          select 1 from activity a where a.church_id = c.id
            and a.created_at >= c.created_at + interval '8 weeks'
            and a.created_at <  c.created_at + interval '9 weeks')) as w8,
        count(distinct c.id) filter (where exists (
          select 1 from activity a where a.church_id = c.id
            and a.created_at >= c.created_at + interval '12 weeks'
            and a.created_at <  c.created_at + interval '13 weeks')) as w12,
        min(c.created_at) as first_signup
      from cohort c group by c.month order by c.month desc`);
    return r.rowCount ?? 0;
  });

  await step("per-church P&L", async () => {
    const r = await pool.query(`
      select c.id as church_id,
        coalesce((select sum(p.amount) from payment p
                  where p.church_id = c.id and p.status = 'success'), 0)
        + coalesce((select sum(t.amount) from wallet_topup t
                    where t.church_id = c.id and t.status = 'success'), 0) as revenue,
        coalesce((select sum(u.count) from usage_stat u
                  where u.church_id = c.id and u.metric = 'sms_pages'), 0) as sms_pages,
        c.storage_monthly_cost as storage_cost
      from church c`);
    return r.rowCount ?? 0;
  });

  // How much the old definition actually missed.
  const signals = await pool.query(
    `select church_id, max(created_at) as last_seen
     from (${ACTIVITY_UNION}) as a group by church_id`,
  );
  const seen = new Map(signals.rows.map((r) => [r.church_id, r.last_seen]));
  const old = await pool.query(`
    select c.id, c.name,
      greatest(
        (select max(a.date)::text from attendance_session a where a.church_id = c.id),
        (select max(g.date)::text from giving g where g.church_id = c.id)
      ) as old_last_activity
    from church c`);

  const wronglyBlank = old.rows.filter((r) => !r.old_last_activity && seen.get(r.id));
  console.log(
    `\nChurches the old rule called inactive but that are actually active: ${wronglyBlank.length}`,
  );
  for (const r of wronglyBlank.slice(0, 20)) {
    console.log(`  - ${r.name} → last seen ${seen.get(r.id)}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
