# FlockInsight — Overnight Build Review (2026‑06‑25)

Everything below is **committed and pushed to `main`** and **builds green**. You can
deploy and see it. Read the **"Deploy"** and **"Action required from you"** sections
first — there are two env vars to set for push, and one migration to run.

> **UPDATE — second batch (v0.15.0 → v0.18.0)** added: notification emails,
> real‑time bell, **SMS sender IDs + wallets**, **billing with Paystack**, plan
> limits, inactivity reminder emails, and backup retention. See
> **"Batch 2"** at the bottom — including **new env vars** (`PAYSTACK_SECRET_KEY`,
> `CRON_SECRET`), the **reminders cron**, and the **per‑church backup plan**.

Versions shipped tonight: **v0.12.0 → v0.13.x** (PWA, tiers, notifications, push,
pricing, currencies, dashboard cards, install prompt).

---

## 1. What I built, by area

### A. Progressive Web App (PWA) — installable, offline, fast
- **`src/app/manifest.ts`** — web manifest: name, standalone display, theme colours,
  app shortcuts (Record attendance / Giving / Members), and 3 generated icons.
- **`src/lib/pwa-icon.tsx` + `src/app/icon-192|512|512-maskable/route.tsx`** — the
  FlockInsight church glyph on the violet gradient, generated at build time into
  192px, 512px and a **maskable** 512px (Android adaptive icons). Clean, on‑brand.
- **`public/sw.js`** — service worker:
  - Offline fallback (`public/offline.html`, branded).
  - **Network‑first** for page navigations (so auth/redirects always work), falling
    back to cache then the offline page.
  - **Cache‑first** for hashed static assets (`/_next/static`, icons, fonts) →
    near‑instant repeat loads.
  - **Web‑push** `push` + `notificationclick` handlers.
- **`src/components/pwa/service-worker-register.tsx`** — registers the SW in
  **production only** (it would fight hot‑reload in dev). Mounted in the root layout.
- **`src/components/pwa/install-prompt.tsx`** — a tasteful, **dismissible** "Install
  FlockInsight" banner (captures `beforeinstallprompt`, remembers dismissal, hides
  when already installed). Mounted in the app shell.

### B. SEO + sharing
- **`src/app/layout.tsx`** — rich metadata: title template, description targeted at
  African churches, keywords, OpenGraph + Twitter cards, `appleWebApp`, `metadataBase`,
  `robots`. Viewport now `viewport-fit=cover` (notch‑safe) + dark theme colour.
- **`src/app/robots.ts`** — allows marketing pages, disallows the private app surfaces.
- **`src/app/sitemap.ts`** — landing, pricing, login, signup, terms, privacy, changelog.

### C. Subscription tiers (3 + Enterprise = 4)
- **`src/lib/plans.ts`** — `starter` (Free), `growth` (₦5,000/mo), `pro` (₦15,000/mo),
  `enterprise` (Custom), with taglines, member limits and feature lists.
  > **Decision:** prices/limits are placeholders — change them in this one file.
- **`church.plan`** column (default `starter`) + **`church.country` / `church.state`**.
- **`/pricing`** — a clean public pricing page (4 cards, "Most popular" on Growth).
- **Superadmin** can change any church's plan (`PlanSelect` on the church detail page;
  `setChurchPlan` action). Plan shows on the church list/detail.
- **Settings → General** now also captures the church's **country + state** (reuses the
  existing `geo.ts` Nigeria data) and shows the **current plan** with a link to pricing.
- > **Decision: limits are informational for now, not enforced.** Hard limits (e.g.
  blocking the 151st member on Starter) are a deliberate follow‑up — enforcing them
  wrong would lock real churches out of their own data. Plans currently drive pricing,
  notification targeting, and display. See "Recommendations".

### D. Notifications + Web Push
Schema: `notification`, `notification_target`, `notification_read`, `push_subscription`.

- **Admin (`/superadmin/notifications`)** — a composer to broadcast to:
  - **All churches**, **By plan**, **By country**, or **Specific churches** (searchable
    multi‑select). Category **System / General**, optional link, optional **push** toggle,
    and a **live "reaches N churches"** counter. Plus full **send history**.
- **Church side:**
  - **`/notifications`** — a notification centre with **All / General / System tabs**,
    unread highlighting, **mark‑read on open** and **mark‑all‑read**.
  - A **bell with an unread badge** in the desktop sidebar and the mobile top bar.
  - A **Notifications card on the dashboard** (latest 4) — exactly the "place for
    notifications on the dashboard" you asked for. Also added to the mobile More menu.
  - Read state is **per user** (each staff member has their own unread count — like email).
- **Web push (`src/lib/push.ts`, `web-push`/VAPID):** users tap **"Enable push"**
  (per device); broadcasts marked "send push" deliver to their phones/desktops even when
  the app is closed. **No‑ops gracefully if VAPID keys aren't set** — in‑app notifications
  still work 100%.

### E. African / Nigeria context
- **30+ currencies** (`src/lib/money.ts`) grouped by region — NGN, GHS, XOF, KES, UGX,
  TZS, RWF, ETB, XAF, CDF, AOA, ZAR, ZMW, MWK, MZN, BWP, NAD, ZWL, EGP, MAD, DZD, TND,
  plus USD/GBP/EUR/CAD.
- **Upcoming birthdays card** on the dashboard (next 14 days) — celebrating members is
  a big deal in African churches and the data (member DOB) was already there.
- Church **country/state** for regional targeting and reporting.

### F. Mobile + UX
- Audited the codebase for overflow risks: **no fixed wide widths, no non‑responsive
  multi‑column grids**; `whitespace-nowrap` only appears inside horizontally‑scrolling
  tab bars (correct). The one real offender you reported — the **Giving overview cards**
  — was already reworked. Verified the new pages render at 200 with no errors.
- New surfaces (pricing, notifications, composer, dashboard cards) are all mobile‑first
  (single column on phones, multi‑column on larger screens).

---

## 2. Decisions & why (your review section)

| Decision | Why |
|---|---|
| **In‑app notifications first, push as an enhancement** | In‑app works for everyone with zero setup. Push needs VAPID keys + the user granting permission; building it to degrade gracefully means a missing key never breaks the feature. |
| **Per‑user read state** (not per‑church) | A church has many staff; each should see their own unread badge, like email. Marking one person's read shouldn't clear everyone's. |
| **Plan limits informational, not enforced** | Enforcing limits incorrectly could lock a paying church out of its members/giving. Safer to ship the tiers + pricing + targeting now and add enforcement deliberately later, with grandfathering. |
| **Pre‑verify invitees was already done; tiers don't change auth** | Kept this build additive — no changes to the login/session path, so nothing destabilises what's working. |
| **SW registers in production only** | A service worker aggressively caches; in dev it fights hot‑reload and hides your changes. Prod‑only avoids that footgun. |
| **Network‑first navigations** | Church staff need fresh data (today's attendance/giving). Cache‑first would risk showing stale pages; we only fall back to cache when truly offline. |
| **Generated icons (no committed PNGs)** | One source of truth (the brand glyph), always crisp, regenerated at build — no binary blobs to drift. |
| **Naira‑first pricing, 30+ African currencies** | The app's audience is Nigeria/Africa; the currency list and pricing reflect that, while still supporting global churches. |
| **Never‑delete respected** | Dead push subscriptions are **kept** (they just stop receiving) rather than deleted; cache cleared by **rename** not `rm`. |

---

## 3. Deploy (do this on the VPS)

```bash
cd /home/flockinsight/app && git pull && pnpm install --prod=false && pnpm db:migrate && \
mv .next .next.bak.$(date +%s) && pnpm build && pm2 restart flockinsight
```
- **`pnpm db:migrate`** is required — this build adds the plans + notifications +
  push tables and the `church.plan/country/state` columns (migration `0009`).
- The `.next` rename is the stale‑cache safeguard from the other night.

## 4. Action required from you (for push to actually deliver)

Web push needs a VAPID key pair. Generate one and add 3 env vars to
`/home/flockinsight/app/.env`:

```bash
npx web-push generate-vapid-keys
```
Then add:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<the public key>
VAPID_PRIVATE_KEY=<the private key>
VAPID_SUBJECT=mailto:you@flockinsight.com
```
Rebuild/restart. Until you do this, **in‑app notifications work fully**; only the
"also send to phones" push delivery is inactive. (Keep the private key out of git.)

Also confirm **`BETTER_AUTH_URL=https://flockinsight.com`** is set (used for sitemap,
manifest start URL and OG tags).

---

## 5. What I deliberately did NOT do (and recommend next)

1. **Plan limit enforcement** + a real billing/upgrade flow (Paystack/Flutterwave for
   Naira). Right now plans are assigned by you in the admin. Recommend Paystack for NG.
2. **SMS/WhatsApp broadcast to a group or all members.** The `sendSms` lib exists and
   follow‑up already sends per‑member SMS; a true broadcast has cost/spam implications,
   so I left it for an explicit go‑ahead. This is probably the single highest‑value next
   feature for Nigerian churches.
3. **Events / programs module** (crusades, conventions, midweek services with RSVPs).
4. **Member self‑service / first‑timer web form** (QR at the door → visitor fills a form
   → lands in Follow‑up).
5. **A device QA pass** on real phones — my audit found no overflow risks in code, but
   eyes on a real Android/iPhone for the new screens is worth 10 minutes.
6. **Web‑push for the admin → "test push to myself"** button (small, nice for confidence).

---

## 6. Commit log (tonight)

- `v0.12.0` — PWA + SEO foundation (manifest, SW, icons, robots, sitemap).
- `v0.13.0` — Subscription tiers + notifications + web push.
- `v0.13.1` — Pricing page, 30+ African currencies, church country/state + plan.
- `v0.13.2` — Dashboard notifications + birthdays cards, PWA install prompt.

Every step was built (`pnpm build` green) and the church‑facing pages were smoke‑tested
(`/dashboard`, `/notifications`, `/settings`, `/giving`, `/pricing`, `/manifest.webmanifest`,
`/icon-192` all returned 200 with no runtime errors).

— Built overnight while you slept. Sleep well; review at your pace. 🌙

---

# Batch 2 (v0.15.0 → v0.18.0)

## What shipped

### Notifications — email + real-time
- **Email on broadcast:** admin notifications now also email every targeted member
  (toggle, on by default). Composer reports push + email counts.
- **Live bell:** the unread badge polls `/api/notifications/unread` every 20s and on
  focus — counts update **without a refresh**.

### SMS — sender IDs + per-church wallets
- Churches **apply for a sender ID** in **Settings → SMS**; admin **approves/rejects**
  from **/superadmin/sms**.
- Each church has an **SMS wallet** (`church.smsBalance`) with a ledger
  (`sms_wallet_txn`). Admin sets the **per-page SMS price** and **tops up wallets**.
- Sending requires an **approved sender ID + enough balance**; it deducts
  `price × pages × recipients` and records the debit. Follow-up SMS now routes
  through the wallet + the church's sender ID.

### Billing — Paystack + plan limits
- **Settings → Billing:** current plan, renewal date, discount, **upgrade/downgrade
  with Paystack checkout**, and **payment history**. "Manage plan" on the profile
  links here.
- **Paystack** init + callback verify. Free / 100%-discount plans activate instantly
  (no payment). Renewal extends from the later of now / current renewal (no lost time).
- **Admin (church detail):** set plan, grant **discount up to 100%**, extend renewal
  months, onboard, and see payments.
- **Plan member limits** enforced on member add and capped on CSV import, with an
  upgrade prompt. The limit **raises automatically when the plan changes** (upgrade or
  renewal), so a church that was paused resumes.

### Inactivity reminder emails
- 3 templates (`src/lib/reminder-emails.ts`): no login ~3 days, no weekend record,
  no activity ~1 week.
- Secured daily cron **`/api/cron/reminders`** (auth via `CRON_SECRET`) sends at most
  one per church using windowed conditions — fires once, no spam, no extra table.

### Backups
- **`scripts/backup.sh`**: whole-DB encrypted dump (so every new table is covered)
  with **count-based retention keeping the newest 15** and pruning older; optional
  rclone off-site copy.

## Deploy (batch 2)
```bash
cd /home/flockinsight/app && git pull && pnpm install --prod=false && pnpm db:migrate && \
mv .next .next.bak.$(date +%s) && pnpm build && pm2 restart flockinsight
```
Migrations **0010** (todo) and **0011** (SMS + billing) are applied by `db:migrate`.

## New env vars (add to `/home/flockinsight/app/.env`)
```
PAYSTACK_SECRET_KEY=sk_live_xxx       # from your Paystack dashboard
CRON_SECRET=<a long random string>    # protects the reminders cron
```
- Without `PAYSTACK_SECRET_KEY`, the billing page works but paid upgrades show
  "payment isn't set up"; free/100%-discount activations still work.
- Set the **Paystack callback** to `https://flockinsight.com/settings/billing/callback`
  (the code passes it per-transaction, so no dashboard config strictly needed).

## Cron jobs to add on the VPS
```bash
crontab -e
# Daily reminder emails (09:00)
0 9 * * * curl -fsS "https://flockinsight.com/api/cron/reminders?key=YOUR_CRON_SECRET" >/dev/null 2>&1
# Daily DB backup (02:00), keeping newest 15
0 2 * * * DATABASE_URL='postgresql://...' BACKUP_KEEP=15 /home/flockinsight/app/scripts/backup.sh >> /var/log/flockinsight-backup.log 2>&1
```
> Your current backup already dumps the whole database, so the new billing/SMS/
> notification tables are **already being captured** — installing `scripts/backup.sh`
> just standardises it and enforces the 15-backup retention you asked for.

## Decisions (batch 2)
| Decision | Why |
|---|---|
| SMS wallet is **money** (not unit count), price set by admin | Matches "admin sets the SMS charge"; one balance works across price changes. |
| Admin tops up wallets (no church self-recharge yet) | You said "wallet management by admins". Church self-recharge via Paystack is a clean follow-on (same Paystack code). |
| Billing charges in **NGN** via Paystack | Plan prices are in Naira; Paystack NGN is the simplest reliable path. Multi-currency/multi-gateway is structured to add later. |
| Plan limits **enforced on create, not retroactive** | Never lock a church out of data it already has; only pause *new* adds when over limit. Raises on upgrade/renewal. |
| Reminder cron uses **windowed conditions** (e.g. 3–4 days) | Fires each reminder once without needing a "last sent" table — simpler and safe for a daily cron. |
| Retention **deletes** backups beyond 15 | You explicitly asked to delete older than 15; the script only ever removes files matching the strict backup name inside the backup dir. |

## Rough plan — per-church backup / restore / reset / access (NOT built yet)
This needs care (FK ordering, irreversibility) so I planned rather than rushed it:

1. **Per-church export (backup):** an admin action that selects every church-scoped row
   (church, staff, members, services, attendance sessions+records, groups+memberships,
   giving+categories, follow-up interactions, roles, payments, sms_wallet_txn,
   notification_target) into a single JSON bundle, downloadable + optionally stored in
   `BACKUP_DIR/church_<id>_<ts>.json.enc`. ~1 day.
2. **Restore to an earlier state:** import a bundle. Safest model = restore into a
   **fresh church** (new id) to avoid clobbering live data, then let you switch the
   owner over; or an in-place restore that, in one transaction, clears current
   church-scoped rows and re-inserts the bundle in FK order. In-place is riskier —
   recommend "restore as new church" first. ~1–2 days.
3. **Reset a church:** a guarded admin action that deletes domain data (members,
   attendance, giving, groups, follow-up) but keeps the church + owner + plan. Requires
   typing the church name to confirm (like delete). ~half day.
4. **Gain access (impersonate):** admin action that adds the superadmin as an
   `admin`-role staff member of the church (with an audit row) so they can enter and
   help, plus a "leave church" action to remove themselves. Avoids password sharing.
   ~half day.

Tell me which of these to build first and I'll take it on. Recommended order: **export → reset → access → restore**.

— Batch 2 built non-stop; all green, all pushed.
