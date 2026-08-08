# Superadmin Command Centre — Design

**Date:** 2026-08-08
**Status:** Approved for planning
**Scope:** `/superadmin` (Overview), `/superadmin/churches`, new `/superadmin/health`

---

## 1. Problem

The superadmin panel reports vanity counts but cannot answer the two questions
that matter: *is a church actually using FlockInsight?* and *is anything broken
right now?*

Three concrete defects:

1. **"Last activity" is computed from 2 of ~20 modules.** `churches/page.tsx`
   derives it from `attendance_session.date` and `giving.date` only. A church
   that logs in daily and adds members, sends SMS, builds forms, uploads media,
   posts devotionals or runs events shows **"No activity recorded yet."**
   Worse, both are *user-entered event dates*, not system-touch times — a church
   backfilling last year's attendance today reads as "last active a year ago."

2. **A real activity signal exists and is unused.** `analytics_event` is written
   by `/api/track` on every pageview by a signed-in user, carrying `church_id`,
   `user_id`, `plan` and `created_at`, indexed on `(church_id, created_at)`.
   Neither Overview nor Churches reads it.

3. **The Termii float is untracked.** Churches buy SMS units into
   `church.walletBalance`; `sendChurchSms` debits it; Termii is drawn down from
   the master account on send. Nothing reconciles money collected against credit
   remaining. No code path calls Termii's balance endpoint at all.

Additionally, "System status" reports `Configured ✓` purely because env vars are
present — it would report success while every send failed.

## 2. Goals

- One page that answers "is anything wrong?" above the fold, on a phone.
- Church activity that reflects real system use across all modules.
- Termii master-wallet visibility: balance, runway, coverage, margin — with
  alerts that arrive without the operator going to look.
- Detect silently-dead cron jobs.
- Perceived load under ~300ms via streaming.

## 3. Non-goals

- Redesigning Usage, SMS, Support, Pricing, Blog, Banners, Audit or Backups.
- Enabling Next.js Cache Components (`cacheComponents`) — a separate migration.
- Replacing PostHog/Matomo for behavioural analysis.

## 4. Architecture decisions

**Streamed live queries, not a snapshot table.** Each dashboard section is its
own `<Suspense>` boundary querying live data. Rationale: a cron-refreshed
snapshot is self-defeating for a monitoring tool — when a cron dies, the
dashboard built to detect that failure silently serves stale data instead. At
current scale every query here is indexed and sub-10ms; the page feels slow only
because it awaits ~22 queries before painting anything.

**Caching model.** `cacheComponents` is not enabled (Next 16.2.7). Per
`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
the supported mechanism is `unstable_cache` with `revalidate` + `tags`. Applied
to expensive rollups (60s) and the external Termii call (300s), tagged for
on-demand invalidation from the Refresh button. `unstable_instant` is **not**
usable — it requires Cache Components.

**Upgrade path.** If `analytics_event` passes ~5M rows, move only the heavy
rollups behind a snapshot table; the module boundary in §5 makes that a
one-file change.

## 5. Module boundaries

| Module | Responsibility | Depends on |
|---|---|---|
| `src/lib/platform-health.ts` | Per-church last-seen, health status, onboarding funnel, at-risk detection | db, schema |
| `src/lib/termii-balance.ts` | Termii API client + snapshot read/write | env, db |
| `src/lib/float.ts` | Runway, coverage, liability, margin, unit-cost derivation | termii-balance, platform-settings, db |
| `src/lib/cron-run.ts` | Heartbeat write + liveness read | db |
| `src/lib/platform-alerts.ts` | Rule evaluation, state transitions, dispatch | float, cron-run, notifications, push, mailer |
| `src/lib/platform-stats.ts` | Overview metrics with period-over-period deltas, cohort retention, per-church P&L | db |

Each is independently testable and consumed only through its exported surface.

## 6. Data model changes

### 6.1 New tables

```
cron_run
  id uuid pk
  job text notnull                 -- "reminders" | "storage" | ...
  started_at timestamptz notnull default now()
  finished_at timestamptz
  ok boolean
  duration_ms integer
  error text
  meta jsonb                       -- e.g. { processed: 12, skipped: 3 }
  index (job, started_at desc)

termii_snapshot
  id uuid pk
  balance numeric(14,2)            -- null when the fetch failed
  currency text
  ok boolean notnull
  error text
  fetched_at timestamptz notnull default now()
  index (fetched_at desc)

platform_alert
  id uuid pk
  key text notnull unique          -- "float.runway.critical", "cron.storage.overdue"
  severity text notnull            -- "info" | "warning" | "critical"
  state text notnull               -- "open" | "resolved"
  message text notnull
  opened_at timestamptz notnull default now()
  resolved_at timestamptz
  last_notified_at timestamptz
  index (state, severity)
```

`platform_alert.key` is unique and upserted, so a rule that stays true does not
create duplicate rows or re-notify. Notification fires only on the
`resolved → open` transition; recovery sets `state = "resolved"` so the next dip
alerts again.

### 6.2 New `platform_setting` keys

| Key | Default | Meaning |
|---|---|---|
| `termii_unit_cost` | `""` | NGN Termii charges per SMS page |
| `termii_unit_cost_mode` | `manual` | `manual` (use the value above) or `auto` (derive) |
| `float_runway_warn_days` | `14` | Amber threshold |
| `float_runway_critical_days` | `5` | Red threshold |

### 6.3 Required fix: SMS pages are not recorded

`recordUsage("sms", churchId, recipients.length)` (church-sms.ts:86, :223)
records **recipients**, while billing charges `price × pages × recipients`. For
any message over 160 characters `usage_stat.sms` understates pages, so deriving
unit cost or margin from it would be wrong.

**Fix:** record a second metric alongside the existing one —
`recordUsage("sms_pages", churchId, pages * recipients)`. This requires widening
the `metric` parameter union in `lib/usage.ts` from `"email" | "sms"` to include
`"sms_pages"`. It leaves existing `sms` rows and the Usage dashboard untouched,
and gives an honest page count from the change forward. Historical periods
without `sms_pages` data fall back to manual unit cost and are labelled as
estimated in the UI.

## 7. The signal layer

### 7.1 `lastSeenAt`

Greatest of, per church:

- `max(analytics_event.created_at)` — primary; someone opened the app
- `max(created_at)` from `attendance_session`, `giving`, `member`,
  `communication_log`, `media`, `form`, `devotional` — **`created_at`, never the
  user-entered `date` column**
- falls back to `church.created_at`

One `UNION ALL` + `GROUP BY church_id`. Every source column is indexed by church.
`analytics_event` is pruned at 180 days (`pruneOldEvents`), so the `created_at`
sources are the durable floor and must be retained in the union.

### 7.2 Health status (derived at read time, not stored)

| Status | Rule |
|---|---|
| Suspended | `church.status = 'suspended'` (takes precedence) |
| Never activated | created ≥7d ago, `<2` members, `0` attendance sessions |
| At risk | ≥3 distinct ISO weeks with activity historically, now silent ≥14d |
| Healthy | seen ≤7d |
| Idle | seen 8–30d |
| Dormant | seen ≥31d |

Evaluated in that order; first match wins. "At risk" is the actionable churn
signal — a formerly weekly-active church gone quiet is recoverable, which is a
different problem from one that never started.

### 7.3 Onboarding funnel

Five booleans per church: added members · invited staff · recorded attendance ·
recorded giving · sent a message. Rendered as dots on the church row; aggregated
platform-wide to show where churches stall.

## 8. Termii master wallet

### 8.1 Client

`GET {TERMII_BASE_URL}/api/get-balance?api_key=…` → `{ user, balance, currency }`.
5s timeout, never throws, returns a discriminated result. Every call — success or
failure — writes a `termii_snapshot` row.

Local `.env` has no Termii keys (production only), so this must degrade cleanly:
unconfigured renders a "not configured" state, never an error.

### 8.2 Derived metrics

**Unit cost** (`auto` mode): total balance *decrease* across snapshots in the
window ÷ pages sent in the same window (`usage_stat.sms_pages`). Guarded against
divide-by-zero, negative deltas (top-ups), and windows with no page data — any
guard failing falls back to the manual value, or marks the metric unavailable.
`manual` mode uses the configured number directly.

**Runway** = `balance ÷ 7-day average daily drawdown`, drawdown from snapshot
deltas (captures spend outside FlockInsight too). Falls back to
`sms_pages × unit cost` when snapshot history is under 48h. Displayed as
"~N days", never a false precision.

**Coverage** = `balance ÷ (SMS liability × unit cost)`.
SMS liability in pages = `Σ churches max(0, walletBalance − committed storage)
÷ sms_price`, where committed storage = `storageMonthlyCost` when
`storageRenewsAt` falls within the next 31 days, else 0. Wallets are unified
across SMS and storage, so storage obligations are subtracted before treating
the remainder as SMS credit.
**Coverage < 100% means SMS has been sold that cannot currently be delivered.**

**Margin** = revenue from SMS (`sms_price × pages`) − cost (`unit cost × pages`),
for the current month and all time.

### 8.3 Freshness

When the Termii API is unreachable the card shows the **last known balance with a
stale badge and the age**, never a zero and never a crash. Three consecutive
failed snapshots raise a `float.api.unreachable` warning alert.

## 9. Cron heartbeats

`src/lib/cron-run.ts` exports `withCronRun(job, fn)`, which inserts a `cron_run`
row on entry and updates it with outcome, duration and error on exit — including
on throw. All 8 existing cron routes (`reminders`, `service-reminders`,
`celebrations`, `storage`, `broadcasts`, `devotionals`, `first-timers`,
`trial-reminders`) wrap their body in it. The auth check stays *outside* the
wrapper so unauthorised probes do not create heartbeat rows.

A registry declares each job's expected interval. Liveness = red when
`now - last_started_at > interval × 2`. This is the only way to distinguish
"ran, nothing to do" from "never ran."

## 10. Alerts

New `/api/cron/platform-health`, every 30 minutes: snapshot Termii, evaluate all
rules, upsert `platform_alert`, dispatch on transition.

| Rule | Severity | Delivery |
|---|---|---|
| coverage < 100% | critical | email + push |
| runway < `float_runway_critical_days` | critical | email + push |
| runway < `float_runway_warn_days` | warning | dashboard |
| any cron overdue (> 2× interval) | critical | email + push |
| Termii unreachable ×3 | warning | dashboard |
| backup older than 48h | critical | email + push |
| support ticket open > 24h | warning | dashboard |

Delivery reuses `notifySuperAdminsByEmail` (lib/notifications.ts:155) and
`sendPushToUsers` (lib/push.ts:34). Push is env-gated and already no-ops when
VAPID is unset, so email is the guaranteed channel.

## 11. Pages

### 11.1 `/superadmin` — command centre

1. **Status line** — "All systems normal" / "N issues need you."
2. **Action queue** — severity-ranked list from `platform_alert` plus live
   queue counts (pending sender IDs, open tickets, never-activated churches, new
   signups to welcome). Each row: plain sentence, count, link to the fix. Empty
   state: "Nothing needs you right now."
3. **Six stat cards with deltas** — MRR (Δ vs last month), revenue this month,
   active churches 7d/total, **Termii runway**, SMS margin this month, at-risk
   count. `StatCard` already supports a `delta` prop; reuse it.
4. **90-day chart** — signups · active churches · revenue, toggleable series.
5. **Two columns** — *Needs a human* (at-risk + never-activated, last-seen, "Log
   in as" button) | *Recent money* (payments + wallet top-ups merged).

**Removed:** "Largest churches" (biggest ≠ healthiest), plan-distribution bars
and email/SMS top-5 lists (belong on Usage), quick-action tiles (duplicated by
the nav).

### 11.2 `/superadmin/churches`

Real last-seen + health badge per row; filter chips (All / Healthy / Idle / At
risk / Never activated / Suspended / Trial ending); sort by last-seen, members,
revenue, joined; search by name, slug or owner email; sticky per-bucket counts;
funnel dots. Existing card layout retained.

The seven full-table `GROUP BY`s collapse into one grouped query; pagination
added past 100 churches.

### 11.3 `/superadmin/health` (new)

1. **Float** — balance, runway, coverage gauge, 30-day burn chart, margin,
   per-church wallet liability table, Refresh + Fund now.
2. **Cron heartbeats** — 8 rows: last run, duration, outcome, next expected.
3. **Integrations** — Termii, Resend, Paystack, Cloudinary, VAPID: configured
   **and last actual success/failure**, not env presence alone.
4. **Data** — DB size, row counts, last backup age, storage used vs sold.
5. **Recent failures** — failed sends, payments, webhooks.

Added to `superadmin-nav.tsx` between Overview and Usage.

## 12. Phase 1 extras

- **Revenue at risk** — Σ MRR of at-risk + trial-ending-unpaid churches. Card on
  Overview, breakdown on Churches.
- **Cohort retention** — % of churches still active at weeks 4/8/12 by signup
  month, from `analytics_event` + the `created_at` union. Table on Health.
- **⌘K command palette** — fuzzy jump to any church or user, plus nav actions.
  Client component in the superadmin layout; `/` and `⌘K`/`Ctrl+K` open it.
- **Per-church P&L** — revenue (payments + wallet top-ups) vs cost (SMS pages ×
  unit cost, storage add-ons, email volume). Column on Churches, detail on the
  church page.

## 13. Performance

- `<Suspense>` per section with layout-matched skeletons (no CLS).
- `unstable_cache`: 60s on rollups, 300s on Termii, tagged for on-demand bust.
- One `UNION ALL` for last-seen instead of N per-church queries.
- Charts stay on recharts (already in `optimizePackageImports`), below-fold ones
  lazy-loaded.
- Mobile-first: the status line, action queue and float card are the phone view;
  charts degrade gracefully.

## 14. Error handling

Every section fails independently. A thrown query inside one `<Suspense>`
boundary renders that section's error state, not a blank page — each gets an
`error.tsx` sibling or a caught fallback. The Termii client never throws.
Alert dispatch failures are logged and retried next run; they never abort the
cron. Heartbeat writes never block the job's real work.

## 15. Testing

- Unit: health-status classification at each boundary (7/8/14/30/31 days),
  never-activated and at-risk rules, runway/coverage/margin maths including
  divide-by-zero and negative-delta guards, unit-cost auto-derivation fallbacks.
- Integration: cron heartbeat written on success, on throw, and not written on
  401; alert fires once on transition and not on repeat; recovery re-arms.
- Data: last-seen union returns the true maximum across all source tables, and
  ignores user-entered `date` columns (regression test for the original bug).

## 16. Rollout

1. Migration for the three tables + `usage.ts` metric union widening.
2. `sms_pages` recording deployed early so unit-cost derivation accumulates data.
3. Libraries, then pages, then cron heartbeats, then the alert cron.
4. Add `/api/cron/platform-health` to the VPS crontab (every 30 min, `?key=CRON_SECRET`).
5. Set `termii_unit_cost` manually on day one; switch to `auto` once ≥7 days of
   snapshots exist.

## 17. Out of scope

Redesign of the other nine superadmin tabs · Cache Components migration ·
replacing PostHog · automated Termii top-up (alerting only; funding stays manual).
