# Superadmin Command Centre Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the FlockInsight superadmin panel into a command centre with true per-church activity signals, Termii master-wallet float tracking, cron liveness detection, and transition-based alerts.

**Architecture:** Streamed live queries — every dashboard section is its own `<Suspense>` boundary hitting live indexed data, with `unstable_cache` on expensive rollups (60s) and the external Termii call (300s). No snapshot table for dashboard data: a cron-refreshed dashboard lies when a cron dies, and detecting dead crons is a core requirement. Pure business logic (float maths, health classification) lives in dependency-free modules so it can be unit-tested without a database.

**Tech Stack:** Next.js 16.2.7 (App Router, Turbopack) · TypeScript · Tailwind v4 · shadcn/ui · Drizzle ORM · PostgreSQL 17 · Vitest (new) · Recharts · Better Auth

## Global Constraints

- **Do NOT enable `cacheComponents`.** Not enabled in this project; `unstable_instant` is therefore unusable. Caching model is `unstable_cache` with `revalidate` + `tags`, per `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`.
- **Never remove** `serverExternalPackages` in `next.config.ts` or the `pnpm.overrides.kysely: 0.28.17` pin — both are load-bearing for `next build`.
- **Never delete files or data.** Rename or back up instead. (Global user rule.)
- **Do not commit `Personal_Note`** — it is the user's personal file.
- Money columns are `numeric(…, mode:"number")`; SQL `sum()` still returns a string → always wrap in `Number()`.
- Activity timestamps must read `created_at`, **never** the user-entered `date` columns on `attendance_session` / `giving`.
- All new cron routes authenticate via `?key=CRON_SECRET` or `Authorization: Bearer`, checked **before** any heartbeat row is written.
- pnpm is slow in this environment (antivirus). Run installs with `run_in_background`.
- Superadmin pages already sit behind `requireSuperAdmin()` in `src/app/superadmin/layout.tsx` — do not re-implement auth per page.

---

## File Structure

**Create — libraries (pure logic separated from DB access):**

| File | Responsibility |
|---|---|
| `src/lib/health-rules.ts` | Pure: classify health status, funnel completeness. No DB imports. |
| `src/lib/float-math.ts` | Pure: runway, coverage, margin, unit-cost derivation, all guards. No DB imports. |
| `src/lib/platform-health.ts` | DB: per-church last-seen union, status rollup, funnel query. |
| `src/lib/termii-balance.ts` | Termii API client + `termii_snapshot` read/write. |
| `src/lib/float.ts` | Composes `float-math` + `termii-balance` + settings + wallet liability. |
| `src/lib/cron-run.ts` | `withCronRun()` heartbeat wrapper + liveness registry/read. |
| `src/lib/platform-alerts.ts` | Rule evaluation, `platform_alert` upsert, transition dispatch. |
| `src/lib/platform-stats.ts` | Overview metrics with deltas, cohort retention, per-church P&L. |

**Create — routes/pages:**
- `src/app/api/cron/platform-health/route.ts`
- `src/app/superadmin/health/page.tsx`

**Create — components:**
- `src/components/superadmin/action-queue.tsx`
- `src/components/superadmin/health-badge.tsx`
- `src/components/superadmin/float-panel.tsx`
- `src/components/superadmin/cron-table.tsx`
- `src/components/superadmin/growth-chart.tsx`
- `src/components/superadmin/command-palette.tsx`
- `src/components/superadmin/skeletons.tsx`

**Create — tests:**
- `vitest.config.ts`, `src/lib/health-rules.test.ts`, `src/lib/float-math.test.ts`

**Modify:**
- `src/db/schema.ts` — add `cronRun`, `termiiSnapshot`, `platformAlert`
- `src/lib/usage.ts` — widen metric union to include `"sms_pages"`
- `src/lib/church-sms.ts:86,223` — record `sms_pages`
- `src/lib/platform-settings.ts` — float setting keys/getters
- 8 cron routes under `src/app/api/cron/*` — wrap in `withCronRun`
- `src/app/superadmin/page.tsx` — rebuild as command centre
- `src/app/superadmin/churches/page.tsx` + `src/components/superadmin/churches-table.tsx`
- `src/components/superadmin/superadmin-nav.tsx` — add Health
- `src/app/superadmin/layout.tsx` — mount command palette
- `package.json` — vitest devDeps + `test` script

---

## Task 1: Vitest harness + pure health rules

**Files:**
- Create: `vitest.config.ts`, `src/lib/health-rules.ts`, `src/lib/health-rules.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `type ChurchHealth = "suspended" | "never_activated" | "at_risk" | "healthy" | "idle" | "dormant"`; `classifyHealth(input: HealthInput): ChurchHealth`; `HealthInput = { status: string; createdAt: Date; lastSeenAt: Date | null; memberCount: number; sessionCount: number; activeWeeks: number; now?: Date }`; `FUNNEL_STEPS`, `funnelFor(f: FunnelFlags): number`

- [ ] **Step 1: Install Vitest** (background — pnpm is slow here)

```bash
pnpm add -D vitest @vitejs/plugin-react
```

- [ ] **Step 2: Add config and script**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```
Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 3: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { classifyHealth } from "@/lib/health-rules";

const NOW = new Date("2026-08-08T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const base = {
  status: "active", createdAt: ago(200), lastSeenAt: ago(1),
  memberCount: 50, sessionCount: 10, activeWeeks: 10, now: NOW,
};

describe("classifyHealth", () => {
  it("suspended wins over everything", () =>
    expect(classifyHealth({ ...base, status: "suspended", lastSeenAt: ago(1) })).toBe("suspended"));

  it("never_activated when old, few members, no sessions", () =>
    expect(classifyHealth({ ...base, createdAt: ago(10), memberCount: 1, sessionCount: 0, activeWeeks: 0 })).toBe("never_activated"));

  it("a brand-new church is not never_activated", () =>
    expect(classifyHealth({ ...base, createdAt: ago(2), memberCount: 0, sessionCount: 0, activeWeeks: 0, lastSeenAt: ago(1) })).toBe("healthy"));

  it("at_risk when previously regular but silent 14d+", () =>
    expect(classifyHealth({ ...base, activeWeeks: 5, lastSeenAt: ago(20) })).toBe("at_risk"));

  it("idle at 20d when never regular", () =>
    expect(classifyHealth({ ...base, activeWeeks: 1, lastSeenAt: ago(20) })).toBe("idle"));

  it("boundaries: 7d healthy, 8d idle, 30d idle, 31d dormant", () => {
    expect(classifyHealth({ ...base, activeWeeks: 1, lastSeenAt: ago(7) })).toBe("healthy");
    expect(classifyHealth({ ...base, activeWeeks: 1, lastSeenAt: ago(8) })).toBe("idle");
    expect(classifyHealth({ ...base, activeWeeks: 1, lastSeenAt: ago(30) })).toBe("idle");
    expect(classifyHealth({ ...base, activeWeeks: 1, lastSeenAt: ago(31) })).toBe("dormant");
  });

  it("null lastSeenAt falls back to createdAt", () =>
    expect(classifyHealth({ ...base, lastSeenAt: null, createdAt: ago(40), memberCount: 5, sessionCount: 2 })).toBe("dormant"));
});
```

- [ ] **Step 4: Run tests, verify they fail**

Run: `pnpm test` — Expected: FAIL, cannot resolve `@/lib/health-rules`.

- [ ] **Step 5: Implement `health-rules.ts`**

Order matters — first match wins: suspended → never_activated → at_risk → healthy → idle → dormant. `never_activated` = created ≥7d ago AND memberCount < 2 AND sessionCount === 0. `at_risk` = activeWeeks ≥ 3 AND daysSince ≥ 14. Thresholds as named consts (`HEALTHY_DAYS = 7`, `IDLE_DAYS = 30`, `AT_RISK_DAYS = 14`, `AT_RISK_MIN_WEEKS = 3`, `NEVER_ACTIVATED_DAYS = 7`). Export `FUNNEL_STEPS = ["members","staff","attendance","giving","message"] as const` and `funnelFor()` returning the count of true flags.

- [ ] **Step 6: Run tests, verify pass.** Run: `pnpm test`

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml src/lib/health-rules.ts src/lib/health-rules.test.ts
git commit -m "Add Vitest and pure church-health classification rules"
```

---

## Task 2: Pure float maths

**Files:**
- Create: `src/lib/float-math.ts`, `src/lib/float-math.test.ts`

**Interfaces:**
- Produces: `deriveUnitCost({ drawdown, pages }): number | null`; `runwayDays({ balance, dailyBurn }): number | null`; `coverageRatio({ balance, liabilityPages, unitCost }): number | null`; `smsLiabilityPages({ walletBalance, storageMonthlyCost, storageRenewsAt, smsPrice, now }): number`; `marginFor({ pages, smsPrice, unitCost }): number`; `dailyBurnFromSnapshots(snapshots: {balance:number|null; fetchedAt:Date}[], days: number): number | null`

- [ ] **Step 1: Write the failing tests** — cover every guard, because these numbers gate real money:

```ts
import { describe, expect, it } from "vitest";
import {
  coverageRatio, deriveUnitCost, runwayDays, smsLiabilityPages,
  marginFor, dailyBurnFromSnapshots,
} from "@/lib/float-math";

describe("deriveUnitCost", () => {
  it("divides drawdown by pages", () => expect(deriveUnitCost({ drawdown: 350, pages: 100 })).toBe(3.5));
  it("returns null on zero pages (no divide-by-zero)", () => expect(deriveUnitCost({ drawdown: 350, pages: 0 })).toBeNull());
  it("returns null on negative drawdown (a top-up, not spend)", () => expect(deriveUnitCost({ drawdown: -500, pages: 100 })).toBeNull());
  it("returns null on zero drawdown", () => expect(deriveUnitCost({ drawdown: 0, pages: 100 })).toBeNull());
});

describe("runwayDays", () => {
  it("balance over daily burn", () => expect(runwayDays({ balance: 10_000, dailyBurn: 500 })).toBe(20));
  it("null when burn is zero (infinite runway is not a number)", () => expect(runwayDays({ balance: 10_000, dailyBurn: 0 })).toBeNull());
  it("zero balance is zero days, not null", () => expect(runwayDays({ balance: 0, dailyBurn: 500 })).toBe(0));
});

describe("coverageRatio", () => {
  it("1.0 when balance exactly covers liability", () =>
    expect(coverageRatio({ balance: 350, liabilityPages: 100, unitCost: 3.5 })).toBe(1));
  it("under 1 when short", () =>
    expect(coverageRatio({ balance: 175, liabilityPages: 100, unitCost: 3.5 })).toBe(0.5));
  it("null when unit cost unknown", () =>
    expect(coverageRatio({ balance: 350, liabilityPages: 100, unitCost: 0 })).toBeNull());
  it("no liability means fully covered", () =>
    expect(coverageRatio({ balance: 350, liabilityPages: 0, unitCost: 3.5 })).toBe(Infinity));
});

describe("smsLiabilityPages", () => {
  const now = new Date("2026-08-08T00:00:00Z");
  const soon = new Date("2026-08-20T00:00:00Z");
  const later = new Date("2026-12-01T00:00:00Z");
  it("subtracts storage due within 31 days", () =>
    expect(smsLiabilityPages({ walletBalance: 1000, storageMonthlyCost: 200, storageRenewsAt: soon, smsPrice: 4, now })).toBe(200));
  it("ignores storage due beyond 31 days", () =>
    expect(smsLiabilityPages({ walletBalance: 1000, storageMonthlyCost: 200, storageRenewsAt: later, smsPrice: 4, now })).toBe(250));
  it("never negative when storage exceeds wallet", () =>
    expect(smsLiabilityPages({ walletBalance: 100, storageMonthlyCost: 500, storageRenewsAt: soon, smsPrice: 4, now })).toBe(0));
  it("returns 0 when smsPrice is 0 rather than dividing by zero", () =>
    expect(smsLiabilityPages({ walletBalance: 1000, storageMonthlyCost: 0, storageRenewsAt: null, smsPrice: 0, now })).toBe(0));
});

describe("marginFor", () => {
  it("sell minus cost times pages", () => expect(marginFor({ pages: 100, smsPrice: 4, unitCost: 3.5 })).toBe(50));
  it("can be negative when selling under cost", () => expect(marginFor({ pages: 100, smsPrice: 3, unitCost: 3.5 })).toBe(-50));
});

describe("dailyBurnFromSnapshots", () => {
  const d = (n: number) => new Date(2026, 7, n);
  it("sums only decreases, divided by window days", () => {
    const snaps = [
      { balance: 10_000, fetchedAt: d(1) },
      { balance: 9_000, fetchedAt: d(2) },
      { balance: 12_000, fetchedAt: d(3) }, // top-up: ignored
      { balance: 11_000, fetchedAt: d(4) },
    ];
    expect(dailyBurnFromSnapshots(snaps, 4)).toBe(500); // (1000 + 1000) / 4
  });
  it("null with fewer than 2 usable points", () =>
    expect(dailyBurnFromSnapshots([{ balance: 10_000, fetchedAt: d(1) }], 7)).toBeNull());
  it("skips failed snapshots with null balance", () =>
    expect(dailyBurnFromSnapshots([{ balance: null, fetchedAt: d(1) }, { balance: null, fetchedAt: d(2) }], 7)).toBeNull());
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm test`

- [ ] **Step 3: Implement `float-math.ts`** — no imports at all; every function returns `null` rather than a misleading number when inputs can't support an answer. Round money to 2dp, ratios to 4dp.

- [ ] **Step 4: Run, verify pass.** `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add src/lib/float-math.ts src/lib/float-math.test.ts
git commit -m "Add pure float maths for Termii runway, coverage and margin"
```

---

## Task 3: Schema + migration

**Files:**
- Modify: `src/db/schema.ts` (append before the type-helpers block at line ~1958)
- Create: migration via `pnpm db:generate`

**Interfaces:**
- Produces: `cronRun`, `termiiSnapshot`, `platformAlert` Drizzle tables + inferred types.

- [ ] **Step 1: Add the three tables** exactly as specified in spec §6.1 — `cron_run` (job, started_at, finished_at, ok, duration_ms, error, meta jsonb; index on `(job, started_at desc)`), `termii_snapshot` (balance nullable numeric, currency, ok, error, fetched_at; index on `fetched_at desc`), `platform_alert` (key unique, severity, state, message, opened_at, resolved_at, last_notified_at; index on `(state, severity)`). Follow the file's existing style: `uuid().primaryKey().defaultRandom()`, `timestamp({ withTimezone: true })`, `numeric({ precision: 14, scale: 2, mode: "number" })`.

- [ ] **Step 2: Export types** alongside the others: `export type CronRun = typeof cronRun.$inferSelect;` etc.

- [ ] **Step 3: Generate the migration.** Run `pnpm db:generate`, then **read the generated SQL** and confirm it only CREATEs — it must contain no `DROP` or destructive statement. Abort and investigate if it does.

- [ ] **Step 4: Apply and verify.** `pnpm db:migrate`, then confirm the tables exist.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "Add cron_run, termii_snapshot and platform_alert tables"
```

---

## Task 4: SMS page accounting fix

**Files:**
- Modify: `src/lib/usage.ts`, `src/lib/church-sms.ts`

**Interfaces:**
- Produces: `UsageMetric = "email" | "sms" | "sms_pages"`; all `lib/usage.ts` functions accept it.

**Why:** `recordUsage("sms", …, recipients.length)` records *recipients*, but billing charges `price × pages × recipients`. Any message over 160 characters understates usage, so unit-cost and margin derived from it would be wrong.

- [ ] **Step 1: Widen the metric type.** Introduce `export type UsageMetric = "email" | "sms" | "sms_pages";` in `src/lib/usage.ts` and replace the inline `"email" | "sms"` unions in `recordUsage`, `metricTotal`, and `topChurchesByMetric`. Leave `churchUsage`/`churchUsageSince` returning `{ email, sms }` so existing callers keep compiling.

- [ ] **Step 2: Record pages at both send sites.** In `church-sms.ts`, next to each existing `recordUsage("sms", …)` call (lines ~86 and ~223), add a `recordUsage("sms_pages", churchId, pages * <recipientsOrSent>)` call using the page count already computed for billing in that function. Do not change the existing `"sms"` call — the Usage dashboard depends on it.

- [ ] **Step 3: Verify it compiles.** Run `pnpm exec tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/usage.ts src/lib/church-sms.ts
git commit -m "Record SMS pages separately from recipients for accurate float maths"
```

---

## Task 5: Termii balance client + float composition

**Files:**
- Create: `src/lib/termii-balance.ts`, `src/lib/float.ts`
- Modify: `src/lib/platform-settings.ts`

**Interfaces:**
- Consumes: `float-math.ts` (Task 2), `termii_snapshot` (Task 3), `usage_stat.sms_pages` (Task 4).
- Produces: `fetchTermiiBalance(): Promise<TermiiBalanceResult>`; `snapshotTermiiBalance(): Promise<TermiiBalanceResult>`; `latestSnapshot()`; `recentSnapshots(days)`; `getFloatOverview(): Promise<FloatOverview>` where `FloatOverview = { configured: boolean; balance: number | null; currency: string; fetchedAt: Date | null; stale: boolean; runwayDays: number | null; dailyBurn: number | null; coverage: number | null; liabilityPages: number; unitCost: number | null; unitCostMode: "manual" | "auto"; smsPrice: number; marginMonth: number | null; marginAllTime: number | null; consecutiveFailures: number }`.

- [ ] **Step 1: Settings.** Add to `platform-settings.ts`: keys `termii_unit_cost` (default `""`), `termii_unit_cost_mode` (default `"manual"`), `float_runway_warn_days` (default `14`), `float_runway_critical_days` (default `5`), with typed getters/setters following the existing `getSmsPrice` pattern.

- [ ] **Step 2: Termii client.** `GET {termiiBase()}/api/get-balance?api_key=…`, reusing `termiiBase()` from `src/lib/sms.ts`. 5-second `AbortSignal.timeout`. Never throws. Returns `{ ok: true, balance, currency } | { ok: false, error }`. `snapshotTermiiBalance()` calls it and writes a `termii_snapshot` row on **both** success and failure — the failure rows are what drive the "unreachable ×3" alert.

- [ ] **Step 3: Compose `float.ts`.** Reads settings + latest/recent snapshots + wallet liability (sum over churches of `smsLiabilityPages(...)` from Task 2) + `usage_stat.sms_pages` totals, and feeds them through the pure functions. Wrap in `unstable_cache(fn, ["float-overview"], { revalidate: 300, tags: ["float"] })`. Mark `stale: true` when the newest successful snapshot is older than 60 minutes. When `TERMII_API_KEY` is unset, return `configured: false` and render a neutral state — never an error (local `.env` has no Termii keys).

- [ ] **Step 4: Verify compile.** `pnpm exec tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/lib/termii-balance.ts src/lib/float.ts src/lib/platform-settings.ts
git commit -m "Add Termii balance client and float overview (runway, coverage, margin)"
```

---

## Task 6: Cron heartbeats

**Files:**
- Create: `src/lib/cron-run.ts`
- Modify: all 8 routes under `src/app/api/cron/*/route.ts`

**Interfaces:**
- Produces: `CRON_JOBS: Record<CronJob, { label: string; intervalMinutes: number }>`; `withCronRun<T>(job: CronJob, fn: () => Promise<T>): Promise<T>`; `getCronLiveness(): Promise<CronLiveness[]>` where `CronLiveness = { job: CronJob; label: string; intervalMinutes: number; lastRunAt: Date | null; lastOk: boolean | null; lastDurationMs: number | null; lastError: string | null; overdue: boolean }`.

- [ ] **Step 1: Registry + wrapper.** `CRON_JOBS` declares all 8 (`reminders`, `service-reminders`, `celebrations`, `storage`, `broadcasts`, `devotionals`, `first-timers`, `trial-reminders`) with expected intervals. `withCronRun` inserts a row with `started_at`, runs `fn`, then updates `finished_at`/`ok`/`duration_ms`/`error` in a `finally` so a throw is still recorded — then rethrows. Heartbeat write failures are caught and logged; they must never break the job's real work.

- [ ] **Step 2: Wrap each route.** In every cron route, keep the `CRON_SECRET` check exactly where it is and wrap only the work *after* it:

```ts
if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });
return withCronRun("storage", async () => { /* existing body */ });
```

Unauthorised probes must not create heartbeat rows.

- [ ] **Step 3: Liveness read.** `getCronLiveness()` does one `DISTINCT ON (job)` query ordered by `started_at desc`, joins the registry, and sets `overdue = lastRunAt === null || now - lastRunAt > intervalMinutes * 2 * 60_000`.

- [ ] **Step 4: Verify.** `pnpm exec tsc --noEmit`, then hit one cron locally with the right key and confirm a `cron_run` row appears, and with a wrong key and confirm none does.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron-run.ts "src/app/api/cron"
git commit -m "Record cron heartbeats so a silently dead job is detectable"
```

---

## Task 7: Platform health signals + stats

**Files:**
- Create: `src/lib/platform-health.ts`, `src/lib/platform-stats.ts`

**Interfaces:**
- Consumes: `health-rules.ts` (Task 1).
- Produces: `getChurchSignals(): Promise<ChurchSignal[]>` where `ChurchSignal = { churchId: string; lastSeenAt: Date | null; activeWeeks: number; funnel: FunnelFlags }`; `getHealthCounts()`; `getAtRiskChurches(limit)`; `getNeverActivatedChurches(limit)`; `getOverviewStats()`; `getCohortRetention()`; `getChurchPnl(churchIds?)`.

- [ ] **Step 1: Last-seen union.** One query, `UNION ALL` across `analytics_event.created_at`, `attendance_session.created_at`, `giving.created_at`, `member.created_at`, `communication_log.created_at`, `media.created_at`, `form.created_at`, `devotional.created_at`, grouped by `church_id` taking `max()`. **Use `created_at` throughout — never the user-entered `date` columns.** `analytics_event` is pruned at 180 days, so the other sources are the durable floor and must stay in the union.

- [ ] **Step 2: Active weeks.** `count(distinct date_trunc('week', created_at))` over the same union per church — feeds the `at_risk` rule.

- [ ] **Step 3: Funnel flags.** Per church booleans: `memberCount >= 1`, `staffCount > 1`, any attendance session, any giving row, any `communication_log` row.

- [ ] **Step 4: Overview stats with deltas.** MRR, revenue this month vs last, active churches 7d, at-risk count, SMS margin this month, new signups — each returning `{ value, delta }` where delta is percent change vs the prior equivalent period, `null` when the prior period is zero (never divide by zero).

- [ ] **Step 5: Cohort retention.** Group churches by signup month; for each, the share still active in weeks 4/8/12, using the last-seen union.

- [ ] **Step 6: Per-church P&L.** Revenue = successful `payment` + `wallet_topup`; cost = `sms_pages × unitCost` + storage add-ons + email volume. Returns `{ churchId, revenue, cost, margin }`.

- [ ] **Step 7:** Wrap the expensive rollups in `unstable_cache(…, { revalidate: 60, tags: ["platform-stats"] })`. Verify with `pnpm exec tsc --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/platform-health.ts src/lib/platform-stats.ts
git commit -m "Derive real church activity signals from every module, not just attendance and giving"
```

---

## Task 8: Alerts + platform-health cron

**Files:**
- Create: `src/lib/platform-alerts.ts`, `src/app/api/cron/platform-health/route.ts`
- Modify: `src/lib/cron-run.ts` (register the new job)

**Interfaces:**
- Consumes: `float.ts` (5), `cron-run.ts` (6), `platform-health.ts` (7), `notifySuperAdminsByEmail` (`lib/notifications.ts:155`), `sendPushToUsers` (`lib/push.ts:34`), `listBackups` (`lib/backups.ts`).
- Produces: `evaluateAlerts(): Promise<AlertRule[]>`; `getOpenAlerts(): Promise<PlatformAlert[]>`.

- [ ] **Step 1: Rules table** exactly per spec §10 — coverage <100% (critical), runway < critical days (critical), runway < warn days (warning), any cron overdue (critical), Termii unreachable ×3 (warning), backup >48h (critical), ticket open >24h (warning). Each yields a stable `key`, `severity`, and human-readable `message`.

- [ ] **Step 2: Transition dispatch.** Upsert on `platform_alert.key`. Notify **only** on `resolved → open` (or first insert), then stamp `last_notified_at`. A rule that stays true must never re-notify. When a rule stops being true, set `state = "resolved"`, `resolved_at = now()` so it can fire again later. Never delete alert rows — the history is the audit trail.

- [ ] **Step 3: Route.** Auth check first, then `withCronRun("platform-health", …)`: snapshot Termii, evaluate rules, dispatch. Dispatch failures are logged and retried next run; they must never abort the cron.

- [ ] **Step 4: Verify.** Hit the route locally; confirm a snapshot row and, with a forced threshold, exactly one notification on the first run and none on the second.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform-alerts.ts src/app/api/cron/platform-health src/lib/cron-run.ts
git commit -m "Add platform health alerts that fire once per state transition"
```

---

## Task 9: Shared UI pieces

**Files:**
- Create: `src/components/superadmin/health-badge.tsx`, `action-queue.tsx`, `skeletons.tsx`, `growth-chart.tsx`

- [ ] **Step 1: `health-badge.tsx`** — maps `ChurchHealth` to label + `Badge` variant + colour. Suspended → destructive, At risk → amber, Never activated → outline/muted, Healthy → success, Idle → secondary, Dormant → muted. Server component, no client JS.

- [ ] **Step 2: `action-queue.tsx`** — severity-ranked list (critical → warning → info, then oldest first). Each row: icon, sentence, count, link. Empty state: "Nothing needs you right now." Mobile-first: full-width rows, no horizontal scroll.

- [ ] **Step 3: `skeletons.tsx`** — skeletons whose dimensions match the real content so nothing shifts when a `<Suspense>` boundary resolves (no CLS).

- [ ] **Step 4: `growth-chart.tsx`** — `"use client"`, Recharts, 90-day signups/active/revenue with toggleable series. Recharts is already in `optimizePackageImports`.

- [ ] **Step 5: Commit**

```bash
git add src/components/superadmin
git commit -m "Add shared superadmin UI: health badges, action queue, skeletons, growth chart"
```

---

## Task 10: Overview command centre

**Files:**
- Modify: `src/app/superadmin/page.tsx` (full rebuild)

- [ ] **Step 1: Rebuild in the spec §11.1 order** — status line → action queue → six stat cards with deltas (MRR, revenue this month, active 7d/total, **Termii runway**, SMS margin, at-risk) → 90-day chart → two columns (*Needs a human* | *Recent money*).

- [ ] **Step 2: Wrap each section in its own `<Suspense>`** with the matching skeleton, so the shell paints immediately and a slow section can't block a fast one. Reuse `StatCard`'s existing `delta` prop (`src/components/app/stat-card.tsx`) rather than adding a new card component.

- [ ] **Step 3: Remove the superseded blocks** — "Largest churches", plan-distribution bars, the email/SMS top-5 lists, and the quick-action tiles. (Deleting page sections here is fine; this is code, not user data.)

- [ ] **Step 4: Add `error.tsx`** for the segment so one failed query renders an error state, not a blank page.

- [ ] **Step 5: Verify.** `pnpm build`, then load `/superadmin` and confirm the shell paints before the data.

- [ ] **Step 6: Commit**

```bash
git add src/app/superadmin/page.tsx src/app/superadmin/error.tsx
git commit -m "Rebuild superadmin overview as a command centre"
```

---

## Task 11: Churches page

**Files:**
- Modify: `src/app/superadmin/churches/page.tsx`, `src/components/superadmin/churches-table.tsx`

- [ ] **Step 1: Feed real signals.** Replace the `attendance`+`giving` date guess (`churches/page.tsx:88-91`) with `getChurchSignals()`. Extend `ChurchRow` with `lastSeenAt`, `health`, `funnel`, `revenue`, `cost`.

- [ ] **Step 2: Replace the misleading line.** `"No activity recorded yet"` (`churches-table.tsx:271`) becomes the true last-seen, or "Never signed in" only when it genuinely is.

- [ ] **Step 3: Add filters/sort/search** — health chips, sort by last-seen/members/revenue/joined, search by name/slug/owner email, sticky per-bucket counts. Client-side over the fetched rows.

- [ ] **Step 4: Add health badge + funnel dots + P&L** to each card.

- [ ] **Step 5: Collapse the seven `GROUP BY`s** into one grouped query; paginate past 100 churches.

- [ ] **Step 6: Verify.** `pnpm build`; confirm a church with members but no attendance now shows real activity.

- [ ] **Step 7: Commit**

```bash
git add src/app/superadmin/churches src/components/superadmin/churches-table.tsx
git commit -m "Show true church activity and health on the churches list"
```

---

## Task 12: Health page + nav

**Files:**
- Create: `src/app/superadmin/health/page.tsx`, `src/components/superadmin/float-panel.tsx`, `src/components/superadmin/cron-table.tsx`
- Modify: `src/components/superadmin/superadmin-nav.tsx`

- [ ] **Step 1: Float panel** — balance (large), runway, coverage gauge, 30-day burn chart, margin, wallet-liability table, unit-cost control (manual/auto), Refresh (server action calling `revalidateTag("float")`). Stale badge with age when the snapshot is old; "not configured" state when keys are absent.

- [ ] **Step 2: Cron table** — all 9 jobs: last run, duration, outcome, next expected; red when overdue.

- [ ] **Step 3: Integrations** — Termii, Resend, Paystack, Cloudinary, VAPID showing configured **and last actual success/failure**. Env presence alone is not a status; today's card would report `Configured ✓` while every send failed.

- [ ] **Step 4: Data + failures** — DB size, row counts, last backup age (`listBackups`), storage used vs sold; recent failed sends/payments.

- [ ] **Step 5: Nav** — add Health between Overview and Usage with a `HeartPulse` icon.

- [ ] **Step 6: Verify.** `pnpm build`, load `/superadmin/health`.

- [ ] **Step 7: Commit**

```bash
git add src/app/superadmin/health src/components/superadmin/float-panel.tsx src/components/superadmin/cron-table.tsx src/components/superadmin/superadmin-nav.tsx
git commit -m "Add superadmin health page with Termii float and cron liveness"
```

---

## Task 13: Command palette + cohort retention

**Files:**
- Create: `src/components/superadmin/command-palette.tsx`
- Modify: `src/app/superadmin/layout.tsx`, `src/app/superadmin/health/page.tsx`

- [ ] **Step 1: Palette** — `"use client"`, opens on `⌘K`/`Ctrl+K`, fuzzy-filters churches, users and nav actions, navigates on select. Data fetched once from a small server action. Built on the existing Radix `Dialog` (already a dependency — do not add `cmdk`).

- [ ] **Step 2: Mount** in the superadmin layout so it's available on every tab.

- [ ] **Step 3: Cohort retention table** on the Health page from `getCohortRetention()` — signup month × weeks 4/8/12 retained.

- [ ] **Step 4: Verify.** `pnpm build`; confirm `⌘K` opens and jumps to a church.

- [ ] **Step 5: Commit**

```bash
git add src/components/superadmin/command-palette.tsx src/app/superadmin/layout.tsx src/app/superadmin/health/page.tsx
git commit -m "Add superadmin command palette and cohort retention"
```

---

## Task 14: Verify, deploy, document

- [ ] **Step 1: Full verification.** Run and confirm each passes, quoting real output: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`. Do not claim success on any step that did not run clean.

- [ ] **Step 2: Push.** `git push origin main` (excluding `Personal_Note`).

- [ ] **Step 3: Report the deploy commands** for the VPS, including the `.next` rename step (a stale `.next` corrupts builds there) and the new migration:

```bash
cd /home/flockinsight/app && git pull && pnpm install --prod=false && \
  mv .next .next.bak.$(date +%F-%H%M) 2>/dev/null; pnpm db:migrate && pnpm build && pm2 restart flockinsight
```

- [ ] **Step 4: Report the new crontab line** to add:

```bash
*/30 * * * * curl -s "https://flockinsight.com/api/cron/platform-health?key=YOUR_CRON_SECRET" >/dev/null
```

- [ ] **Step 5: Post-deploy setup** — set `termii_unit_cost` manually on the Health page (auto-derivation needs ≥7 days of snapshots), and confirm the Termii balance card shows a real number.

---

## Self-Review Notes

**Spec coverage:** §7 signals → Tasks 1, 7. §8 float → Tasks 2, 5. §6.1 tables → Task 3. §6.3 sms_pages → Task 4. §9 heartbeats → Task 6. §10 alerts → Task 8. §11.1 Overview → Tasks 9, 10. §11.2 Churches → Task 11. §11.3 Health → Task 12. §12 extras → revenue-at-risk (Task 7 stats + Task 10 card), cohort retention (Tasks 7, 13), ⌘K (Task 13), per-church P&L (Tasks 7, 11). §13 performance → Tasks 5, 7, 10. §14 error handling → Tasks 5, 6, 8, 10. §15 testing → Tasks 1, 2. §16 rollout → Task 14.

**Ordering constraint:** Task 4 (`sms_pages`) must ship before Task 5's auto unit-cost derivation has data to work with; manual mode is the day-one default precisely because of this.

**Type consistency:** `ChurchHealth` (Task 1) is consumed unchanged in Tasks 9 and 11. `FloatOverview` (Task 5) is consumed in Tasks 8, 10, 12. `CronJob`/`CronLiveness` (Task 6) in Tasks 8 and 12. `ChurchSignal` (Task 7) in Task 11.
