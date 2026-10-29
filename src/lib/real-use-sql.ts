import { sql, type SQL } from "drizzle-orm";

/**
 * What counts as a church really using FlockInsight, defined once.
 *
 * Every platform number that says "active", "last seen", "never activated" or
 * "used the app" reads this. It used to be a union of eight tables' created_at
 * with no idea who wrote the row, which was wrong in both directions:
 *
 *  - OVERSTATED. `communication_log` is written by the birthday cron, the
 *    reminder runs, the SMS queue and giving receipts; `member` by the public
 *    welcome and sign-up forms; `analytics_event` by an operator acting as the
 *    church and by everyone who tried the demo. A church nobody had opened in
 *    months read as healthy because a robot sent a birthday SMS.
 *  - UNDERSTATED. A church whose people opened the app every week but used
 *    meetings, finance, follow-up, training or facilities left no row in any
 *    of the eight, so it read as never seen.
 *
 * WHAT COUNTS, each row one moment a real person in that church did
 * something there:
 *  - an app pageview by somebody holding a NON-temp staff seat in that church
 *    (a temp seat is the one acting-as creates);
 *  - an action in the church's activity log taken as themselves: church
 *    scope, a real account, not via impersonation. Every module's server
 *    actions write one, and it is never pruned — the durable record;
 *  - a signed-in session pointed at that church, by a non-temp seat. Better
 *    Auth refreshes `updated_at` once a day of use, so this is "opened the app
 *    on this day" even if the pageview beacon was lost;
 *  - a service, a gift or a member that a person recorded (`recorded_by` /
 *    `created_by` set). An online payment, a public form or an import by a
 *    cron has none, so it does not count;
 *  - and never anything in the demo church, which is one shared login rebuilt
 *    every two hours.
 *
 * SHAPE: hand-written aliases and no `${table.col}` interpolation, so the
 * qualifier trap in AGENTS.md cannot happen; pure (imports only `sql`), so
 * the text is testable without a database. Columns: church_id, user_id, at.
 */
export const REAL_USE: SQL = sql`
  select e.church_id, e.user_id, e.created_at as at
  from analytics_event e
  join church c on c.id = e.church_id and c.is_demo = false
  join (select distinct organization_id, user_id from staff where temp = false) s
    on s.organization_id = e.church_id and s.user_id = e.user_id
  where e.user_id is not null
  union all
  select a.church_id, a.actor_user_id, a.created_at
  from audit_log a
  join church c on c.id = a.church_id and c.is_demo = false
  where a.scope = 'church' and a.actor_user_id is not null and a.via_impersonation = false
  union all
  select se.active_organization_id, se.user_id,
    least(se.updated_at at time zone 'UTC', now())
  from session se
  join church c on c.id = se.active_organization_id and c.is_demo = false
  join (select distinct organization_id, user_id from staff where temp = false) s
    on s.organization_id = se.active_organization_id and s.user_id = se.user_id
  union all
  select att.church_id, att.recorded_by, att.created_at
  from attendance_session att
  join church c on c.id = att.church_id and c.is_demo = false
  where att.recorded_by is not null
  union all
  select g.church_id, g.recorded_by, g.created_at
  from giving g
  join church c on c.id = g.church_id and c.is_demo = false
  where g.recorded_by is not null
  union all
  select m.church_id, m.created_by, m.created_at
  from member m
  join church c on c.id = m.church_id and c.is_demo = false
  where m.created_by is not null
`;

/**
 * analytics_event rows (pageviews and actions) by real people in real
 * churches, with every column, for the Usage dashboard. The same exclusions
 * as REAL_USE — no demo church, no acting-as, no signed-in user without a
 * church. (Its active-CHURCH counts read REAL_USE itself, so they agree with
 * the Command centre's.)
 */
export const REAL_APP_EVENTS: SQL = sql`
  select e.*
  from analytics_event e
  join church c on c.id = e.church_id and c.is_demo = false
  join (select distinct organization_id, user_id from staff where temp = false) s
    on s.organization_id = e.church_id and s.user_id = e.user_id
  where e.user_id is not null
`;
