# Hardening plan — safety, stability, scale (October 2026)

Written after a full read-only audit of the codebase on 2026-10-30, before a
big marketing push that will onboard many churches who keep **no backups of
their own**. The goal: never have to tell a church "sorry, your data is gone"
or "sorry, someone got in".

This file is a work order for Claude Code running locally (with access to the
production server). Read it top to bottom before touching anything.

---

## How to work through this (rules for Claude)

1. Read `AGENTS.md` first. It documents traps that have already cost real bugs
   (raw `sql` templates, `db.transaction` is not isolation, PDFs and ₦, etc.).
   Also read the relevant guide in `node_modules/next/dist/docs/` before
   changing Next.js code. This is Next 16; APIs differ from your training data.
2. **One item at a time.** For each item: make the change → run
   `npx tsc --noEmit`, `pnpm lint`, `pnpm test` (and `pnpm test:db` when the
   item touches database behaviour) → commit with a clear message → tick the
   box in this file in the same commit → move on. Do not batch unrelated fixes
   into one commit.
3. **Never deploy** (push to `production`) without the owner saying so. Never
   run anything destructive on the server. Phase 0 is read-only and must be
   run with the owner watching.
4. Line numbers below were correct on 2026-10-30 and may have drifted. Search
   for the named function if a line does not match.
5. Migrations must stay **additive** (see DEPLOY.md). Indexes on big tables are
   created out-of-band with `CREATE INDEX CONCURRENTLY` (drizzle runs
   migrations in a transaction, which forbids CONCURRENTLY).
6. When an item is shipped, record it on the in-app roadmap
   (`/superadmin/roadmap` or the `/api/roadmap` feed, see AGENTS.md) so the
   queue stays the single source of truth.
7. If an item turns out to be wrong after reading the code, say so, explain
   why, and skip it. Don't force it.

---

## What the audit found (summary)

| Area | Verdict |
| --- | --- |
| Church-to-church isolation | **Strong.** 294 server actions + 94 routes swept; no way for church A to read/write church B. One low gap (stale session after superadmin removal). |
| Payments / webhooks | **Strong.** Signed, constant-time compared, re-verified with the provider, idempotent. |
| Auth | **Medium gaps.** No 2FA; sessions survive password reset/change; rate limits in-memory per worker; outdated libraries with known advisories. |
| Data durability / recovery | **The real risk.** Off-site backup not proven to exist; two competing backup scripts; restore never tested; no per-church restore; one-click mass deletes with no undo. |
| Scalability | **Fine for a few hundred churches.** Background work (email, crons, recordings, delete cascades) gives out first. |
| Release safety | **Gap.** Deploying to `production` runs no tests and no lint — only the build's type-check. |

Automated tests: 216 files / 3503 tests passing, `tsc --noEmit` clean at audit time.

---

## Phase 0 — Find out what is actually running on the server (read-only)

Run with the owner, over SSH. Record the answers at the bottom of this file
under "Server facts" — Phase 1 depends on them.

```bash
crontab -l; sudo crontab -l          # which backup script runs? with what env (RCLONE_REMOTE, DB_CONTAINER)? watchdog?
ls -la /var/backups/flockinsight | tail
tail -50 /var/log/flockinsight-backup.log      # any errors, any "rclone copy failed"?
command -v rclone pg_dump pg_isready; rclone listremotes
rclone lsf --max-age 36h gdrive:flockinsight-backups   # (use the real remote name)
rclone about gdrive:
docker exec flockinsight-db pg_dump --version; pg_dump --version   # version mismatch?
docker inspect flockinsight-db --format '{{.HostConfig.RestartPolicy.Name}} {{json .Mounts}}'
docker port flockinsight-db                    # 5432 must NOT be published publicly
docker exec flockinsight-db psql -U flockinsight -c "show archive_mode; show wal_level; show max_connections;"
ls -la ~/.flockinsight-backup.key /root/.flockinsight-backup.key   # which exists? matches the script cron runs?
grep -E '^(REQUIRE_EMAIL_VERIFICATION|IN_APP_CRON|BACKUP_DIR|MEDIA_ROOT)=' ~/apps/flockinsight/shared/.env   # never print secrets
cat /etc/server-watchdog.conf 2>/dev/null
df -h; du -sh /var/backups/flockinsight* <MEDIA_ROOT>
tail /var/log/flockinsight-media-backup.log
```

Ask the owner directly: **is the backup encryption key and the full `.env`
(BETTER_AUTH_SECRET, PAYMENTS_ENC_KEY, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, …)
stored somewhere off the server, e.g. a password manager?** If not, that is
step one of Phase 1. Without them, off-site backups cannot be decrypted and
every church's payment-gateway keys are unreadable after a restore.

---

## Phase 1 — Data safety (do first; this is the "sorry" risk)

- [ ] **1.1 One backup script, off-site mandatory.** There are two:
  `deploy/backup-db.sh` (6-hourly, docker-aware, off-site *optional* — empty
  `RCLONE_REMOTE` silently means local-only) and `scripts/backup.sh` (daily,
  host `pg_dump`, pipes the dump straight into the final file so a failed dump
  leaves a truncated file that looks like a good backup; off-site failure is
  "non-fatal"). Make `deploy/backup-db.sh` the only one:
  - dump to a temp file, check `pg_dump` exit status, verify with
    `pg_restore --list` and a minimum size, only then encrypt and move into place;
  - **exit non-zero if `RCLONE_REMOTE` is empty or `rclone copy` fails**;
  - support both docker and host `pg_dump`;
  - one key location (env `KEY_FILE`, documented);
  - ping a dead-man's-switch URL (`BACKUP_HEARTBEAT_URL`, e.g. healthchecks.io)
    on success only, so a backup that *stops* alerts from outside the server;
  - turn `scripts/backup.sh` into a thin wrapper that execs the new one (or
    delete it after the server's crontab is switched), and fix
    `deploy/server-watchdog.sh` comments that reference it.
  - Update `deploy/BACKUPS.md` to match, including the exact cron line.
- [ ] **1.2 Fix the restore runbook and add a restore test script.**
  `BACKUPS.md` "Test your restores" uses host `pg_restore` / `sudo -u postgres`
  (wrong for the docker DB) and `-pass file:~/…` (tilde not expanded).
  Add `deploy/test-restore.sh`: pull the newest dump **from the off-site
  remote**, decrypt, restore into a scratch DB inside the container, print row
  counts for `church`, `member`, `giving`, `attendance_record`, drop the scratch
  DB, ping a heartbeat URL on success. Schedule monthly.
- [ ] **1.3 Harden `deploy/restore-db.sh`.** Abort if the safety dump fails
  (currently continues, `restore-db.sh:42-46`); stop the app (`pm2 stop`)
  before restoring; add a way to fetch from the off-site remote; write a
  "new VPS from scratch" runbook section in `BACKUPS.md`.
- [ ] **1.4 Pre-migration backup in `deploy/deploy.sh`.** Before
  `pnpm db:migrate` (~line 166), take a dump (reuse the backup script with a
  `pre-migrate` tag) and abort the deploy if it fails.
- [ ] **1.5 Backup monitoring reads off-site, not just local.** The app's
  platform alerts (`src/lib/platform-alerts.ts`) and `/superadmin/health` only
  look at the local directory. Have the backup script write a small status
  file (last success time, last off-site success time, size) that the app reads
  and alerts on (>8h stale for a 6-hourly job). Fix the watchdog's silent passes:
  `check_offsite_backup` returns 0 when rclone is missing (~`server-watchdog.sh:401`),
  `check_backups` passes when the dir is missing (~`:373`), `check_database`
  is skipped without host `pg_isready` (~`:363`; use `docker exec`).
- [ ] **1.6 Media backup off-site is a full copy every day.** `backup-media.sh:111`
  uploads each daily snapshot in full to `remote/media/<stamp>`; with 40 GB of
  recordings that is 40 GB/day to Drive. Switch to `rclone copy MEDIA_ROOT remote/media/current`
  (incremental) plus `--backup-dir remote/media/deleted/<stamp>` for deleted/changed files.
  Fail loudly. Empty the local `.trash` after N days.
- [ ] **1.7 Server-side guard on "Reset church".** `resetChurchAction`
  (`src/app/superadmin/churches/[id]/actions.ts:24`) relies on a client-side
  `disabled={!backedUp}` button. Make the server take (or require a recent)
  per-church export before resetting, and refuse otherwise.
- [ ] **1.8 Keep the giver's name when a member is deleted.** `giving.member_id`
  is `ON DELETE SET NULL` (`src/db/schema.ts` ~1473), so deleting a member
  leaves amounts with no giver. Before deleting, stamp `giver_name` from the
  member (like `preserveInviterNames` does for inviters) in `deleteMember` and
  `deleteMembers` (`src/app/(app)/members/actions.ts` ~495-563), and in the same
  way for pledges if they have the same shape. Add a test.
- [ ] **1.9 Church deletion keeps its audit log.** `audit_log.church_id` is
  `ON DELETE CASCADE` (`schema.ts` ~1871), so deleting a church erases the
  record of who did what. Change to `SET NULL` (keep a `church_name` snapshot
  column) via an additive migration.

Server-side tasks the owner does (Claude can prepare commands, owner runs):
- [ ] Switch crontab to the single script with `RCLONE_REMOTE` and the heartbeat URL set.
- [ ] Put the backup key and `.env` in a password manager.
- [ ] Run the restore test once by hand, from the off-site copy, and see real row counts.
- [ ] External uptime monitor (UptimeRobot/BetterStack) on `https://flockinsight.com/api/health?key=…`
      via a header if possible — the plain `/api/health` does not touch the DB.
- [ ] Make sure `REQUIRE_EMAIL_VERIFICATION=true` in production `.env`.

---

## Phase 2 — Security fixes

- [ ] **2.1 Upgrade vulnerable dependencies.** `pnpm audit --prod`: 4 critical,
  8 high. Most urgent: **next 16.3.8 → ≥16.4.1** (unauthenticated Server
  Actions DoS, no workaround). Also better-auth ≥1.7.7, sanitize-html ≥2.18,
  nodemailer ≥10.1.4, zod ≥4.6.6, ws ≥8.21, and eslint-config-next to match
  next. Read the Next.js upgrade notes in `node_modules/next/dist/docs/` after
  upgrading. Then full checks, `next build`, and click through: login,
  members, giving, a public form, a meeting (`scripts/test-meeting-call.mjs`
  against `next build && next start`).
- [ ] **2.2 Revoke sessions on password reset and change.** In
  `src/lib/auth.ts` (~155-180) set `revokeSessionsOnPasswordReset: true`. In
  `changeMyPassword` (`src/app/(app)/profile/actions.ts` ~179) revoke the
  user's other sessions, and rate-limit the current-password check.
- [ ] **2.3 Escape names in notification emails.** `src/lib/member-signup.ts:937`
  puts `opts.personName` (from the public `/join` form) into email HTML
  unescaped — a phishing link inside a genuine FlockInsight email. `escapeHtml`
  is already imported there. Same pattern: `members/actions.ts` ~377,
  `member-signup.ts` ~687, `src/lib/reminder-emails.ts` ~17/31/45,
  `attendance/export-actions.ts` ~64. Grep for other `${…}` in `emailLayout(`
  calls. Add a test.
- [ ] **2.4 Close the stale-session gap.** `removeUserFromChurch`
  (`src/app/superadmin/users/actions.ts` ~199) deletes the staff row but does
  not call `repointSessionsLeaving` like the other removal paths. Add it. Then
  make `api/notifications/recent`, `api/notifications/unread` and
  `api/contributions/proof` resolve the church via `churchForApi()` instead of
  reading `session.activeOrganizationId` directly.
- [ ] **2.5 Shared rate limiting.** `src/lib/rate-limit.ts` and Better Auth's
  limiter are in-memory per PM2 worker (2 workers → double the limit; reset on
  every deploy). Move to a Postgres-backed limiter (a small table with
  upsert-and-increment; Better Auth supports `storage: "database"`). Add a
  per-account sign-in lockout/backoff, not just per-IP. Make the platform-wide
  `signup:all` counter count only validated attempts (`signup/actions.ts` ~118).
- [ ] **2.6 Constant-time secret compares; secrets out of URLs.** All cron
  routes, `api/admin/backfill-members`, `api/health`, `webhooks/termii` use
  `key !== secret`. Add one helper using `timingSafeEqual` and use it
  everywhere. Prefer the `Authorization` header; keep `?key=` only where a
  third party forces it (Termii).
- [ ] **2.7 Rich-text sanitiser.** Drop `meta` and `style` from the allow-list
  in `src/lib/rich-text.ts`.
- [ ] **2.8 Two-factor authentication** (bigger — plan it, confirm with owner).
  Better Auth `twoFactor` plugin (TOTP + backup codes). Required for
  superadmins, offered to church owners/admins, optional for others.
  Superadmin destructive actions (delete church, reset church, set password)
  require a fresh 2FA check.
- [ ] **2.9 Small within-church items.** Delete unused `invitableMembers`
  (`members/access-actions.ts` ~516) or add a permission check. Scope the
  update in `meet/[code]/recording/failed/route.ts` ~96 to the meeting too.

---

## Phase 3 — Stability and scale

- [ ] **3.1 Missing indexes on member foreign keys.** `attendance_record.member_id`
  has no index (only unique `(session_id, member_id)`) but is
  `ON DELETE CASCADE` → every member delete seq-scans the platform's whole
  attendance table; `demo-reset` deletes ~170 members every 2 hours. Same for
  `giving.member_id`, `form_response.member_id`, `meeting_participant.member_id`,
  `member.invited_by_id`, `household.head_member_id`,
  `facility_booking.member_id`, `session.user_id`, `account.user_id`.
  Write a script that finds every FK column without a leading index (query
  `pg_constraint` vs `pg_index`) so none are missed. Declare the indexes in
  `schema.ts`, but create them on production with `CREATE INDEX CONCURRENTLY
  IF NOT EXISTS` run out-of-band *before* the migration that declares them,
  so the migration is a no-op there.
- [ ] **3.2 DB pool timeouts.** `src/db/index.ts` sets only `max: 10`. Add
  `connectionTimeoutMillis: 5000`, `idleTimeoutMillis`, and per-connection
  `statement_timeout` (~15s for web) and `idle_in_transaction_session_timeout`.
  Cron/job code that legitimately runs long sets its own longer timeout.
  Limit `Promise.all` fan-outs that can grab the whole pool (`exportChurch`
  in `src/lib/church-data.ts` ~46-110 runs ~16 in parallel).
- [ ] **3.3 Crons can overlap after 10 minutes.** The scheduler's advisory lock
  is held only while the loopback fetch is open, and that is aborted at 10 min
  (`src/lib/scheduler.ts` ~85-90) while the route keeps running. Add a real
  lease in `withCronRun` (`src/lib/cron-run.ts`): a `running_until` row claimed
  with `UPDATE … WHERE running_until < now() RETURNING`, renewed while running.
  `deploy/run-cron.sh` must go through the same lease.
- [ ] **3.4 Members list pagination.** `members/page.tsx` ~25-41 loads every
  member (with notes) into the page. Server-side pagination + search; the
  giving page's member picker (`giving/page.tsx` ~77) becomes a search box. Cap
  or queue the bulk members PDF (`members-pdf.tsx` ~181) like report PDFs (1,200).
- [ ] **3.5 Cap concurrent recordings.** `src/recorder/supervisor.ts` ~51 has no
  limit. Add `MAX_CONCURRENT_RECORDINGS` (env, default ~4) and refuse Record with
  a clear sentence when full, the same way it refuses when the recorder is down.
  Run ffmpeg with `nice`.
- [ ] **3.6 Stream large uploads.** `api/media/upload/route.ts` ~28-136 buffers
  the whole file (`formData()` then `Buffer.from`) — ~2× file size in a worker
  with an 800 MB restart limit. Check `content-length` before parsing and steer
  big files to the chunked path. Same for the contributions proof route.
- [ ] **3.7 Bound the health-signal scan.** `loadChurchSignals`
  (`src/lib/platform-health.ts`) runs the all-time `REAL_USE` union
  (`real-use-sql.ts`) every 60s per worker. Add a date window and use the
  pre-aggregated `user_active_day` table.
- [ ] **3.8 Retention for growing log tables.** Prune expired `session` rows;
  archive/prune `communication_recipient`, `ai_call`, `scheduled_sms`,
  `meeting_participant` past a set age (keep aggregates). Do not prune
  `audit_log` — archive it.
- [ ] **3.9 Timeouts on Cloudinary fetches** (`src/lib/cloudinary.ts` ~202, 250, 421)
  — every other provider call already has `AbortSignal.timeout`.
- [ ] **3.10 Media and member-delete safety net** (bigger — plan, confirm with owner):
  soft delete / trash for members (restore within 30 days, purge job after),
  a 30-day pending-delete for churches with an owner email, and an email to the
  church owner when more than N members are deleted at once.

---

## Phase 4 — Make future features safe by default

- [ ] **4.1 CI that gates production.** Today `deploy-production.yml` deploys
  with no tests or lint. Add `.github/workflows/ci.yml` on every push/PR:
  `pnpm install --frozen-lockfile`, `npx tsc --noEmit`, `pnpm lint`,
  `pnpm test`, and `pnpm test:db` against a Postgres service container. Make
  the production deploy job depend on CI passing for that commit.
- [ ] **4.2 Turn the audit's sweeps into permanent tests** (like
  `src/lib/sql-safety.test.ts`):
  - every exported server action in a `"use server"` file under `src/app/(app)`
    calls `requireChurch`/a permission helper before touching the DB;
  - every superadmin action calls `requirePlatform`/`requireAsker`;
  - no `api/` route reads `activeOrganizationId` directly (use `churchForApi`);
  - every migration is additive (no `DROP`, `RENAME`, or `NOT NULL` without
    `DEFAULT`) unless the file carries an explicit, reviewed opt-out comment;
  - every FK column has an index;
  - every `emailLayout(` call's interpolations are escaped.
- [ ] **4.3 Error tracking.** Add Sentry (or similar) for server and client so
  failures are seen before a church reports them.
- [ ] **4.4 Add a "Definition of done for a feature" section to AGENTS.md** (text below).

### Definition of done for a feature (proposed text for AGENTS.md)

- Every query is scoped by `churchId`; every client-supplied id is looked up
  inside the caller's church before use; permission checked server-side.
- New tables with `churchId`: indexed on it and on every FK; decided
  `ON DELETE` behaviour (does deleting a member/church destroy history it
  shouldn't?); included in the per-church export (`src/lib/church-data.ts`);
  a retention rule if it grows per event.
- Migration is additive; big-table indexes created CONCURRENTLY out-of-band.
- Anything calling an outside service has a timeout, fails gracefully with a
  sentence the user can read, and never blocks a page render.
- Anything that sends messages or costs money: per-church caps, idempotent
  claim rows, and runs in the background, not in the request.
- Anything CPU-heavy (PDF, transcode, big export) is capped or queued.
- Destructive actions: confirmation, audit row, and a way back (trash/undo)
  or an explicit owner-approved reason why not.
- New feature can be switched off per church (plan gate or flag) and is tried
  on the demo church first.
- Tests for the rule the feature depends on, `tsc`, lint, tests green in CI.

---

## Phase 5 — Architecture moves (plan each with the owner first; not one-shot)

The app is a **modular monolith** and should stay one. Do **not** split it
into microservices. Split by *workload*, not by feature — same codebase, same
database, separate processes/boxes:

1. **Jobs process.** A third PM2 app (fork mode, 1 instance) that runs the
   scheduler and crons, a durable DB-backed **outbox** for email and SMS (one
   row per recipient, claimed with `FOR UPDATE SKIP LOCKED`, retries, survives
   deploys), and media transcodes. Web workers set `IN_APP_CRON=false`. Today
   big email sends run in `after()` with an in-memory queue
   (`communication/actions.ts` ~562, `src/lib/mailer.ts` ~155) and are cut off
   by every deploy; throughput is ~18-36k emails/hour.
2. **Postgres off the app box** — managed Postgres (with point-in-time
   recovery) or a second VPS with WAL archiving (pgBackRest/WAL-G to object
   storage). Turns "up to 24h lost" into "minutes lost". Add PgBouncer before
   going beyond 2 web workers.
3. **Media to object storage** (Cloudflare R2/S3) instead of local
   `MEDIA_ROOT`; removes the disk-full risk and most of the media-backup problem.
4. **Recorder on its own box** once Sunday recordings exceed ~4 at once.
5. **Per-church restore tool**: restore a full dump into a scratch DB and
   extract one church completely (extend `exportChurch`, which today covers ~18
   of ~99 church tables) so one church can be recovered without rolling back
   everyone.

---

## Server facts (fill in during Phase 0)

- Backup script in cron:
- Off-site remote and last off-site file:
- Key + `.env` stored off-server (owner confirmed):
- Postgres: docker? version? `max_connections`? port published?
- Disk: total / used / media / backups:
- `REQUIRE_EMAIL_VERIFICATION`:
- Watchdog installed:
