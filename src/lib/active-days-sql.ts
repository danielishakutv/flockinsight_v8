import { sql, type SQL } from "drizzle-orm";

/**
 * The rollup behind the Master and Expert ranks: which people really used
 * FlockInsight on which UTC days, written into user_active_day.
 *
 * Pure (it imports only `sql`), so its text can be tested without a database.
 *
 * WHAT COUNTS as a day of use, and why each exclusion is there:
 *  - an app pageview by somebody who holds a NON-temp staff seat in that
 *    church. A temp seat is the one acting-as creates, so an operator
 *    impersonating a church does not earn days there;
 *  - pageviews under /help do not count. Reading the guides is studying the
 *    product, and the ranks are about using it;
 *  - an action recorded in a church's activity log as themselves: church
 *    scope, not via impersonation;
 *  - never anything in a demo church, which is one shared login rebuilt every
 *    two hours;
 *  - never the certification's own audit rows, so earning a certificate is
 *    not itself a day of use.
 *
 * Known edge, accepted: /api/track records the session's active church, not
 * the acting-as one, so an operator acting as church X is logged against
 * their own church; the staff join then drops it unless they really are staff
 * there. It affects platform operators only.
 *
 * SHAPE: hand-written aliases with ONE bound parameter, `from`. No
 * `${table.col}` interpolation, so the qualifier trap in AGENTS.md cannot
 * happen, and no correlated subquery. Weeks are counted in JS
 * (activeStanding), never here.
 *
 * The window is whole days and the counts are REPLACED on conflict, so a
 * re-run is exact and idempotent and a missed night is caught up by the next.
 */
export function rollupSql(from: Date): SQL {
  return sql`
    insert into user_active_day (user_id, day, pageviews, actions)
    select user_id, day, sum(pv)::int, sum(ac)::int from (
      select e.user_id, (e.created_at at time zone 'UTC')::date as day, 1 as pv, 0 as ac
      from analytics_event e
      join church c on c.id = e.church_id and c.is_demo = false
      join (select distinct organization_id, user_id from staff where temp = false) s
        on s.organization_id = e.church_id and s.user_id = e.user_id
      where e.kind = 'pageview' and e.user_id is not null
        and coalesce(e.path, '') not like '/help%' and e.created_at >= ${from}
      union all
      select a.actor_user_id, (a.created_at at time zone 'UTC')::date, 0, 1
      from audit_log a
      join church c on c.id = a.church_id and c.is_demo = false
      where a.scope = 'church' and a.actor_user_id is not null and a.via_impersonation = false
        and a.action not like 'training.certification.%' and a.created_at >= ${from}
    ) x
    group by user_id, day
    on conflict (user_id, day) do update
      set pageviews = excluded.pageviews, actions = excluded.actions
    returning user_id
  `;
}
