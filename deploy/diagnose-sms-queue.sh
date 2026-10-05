#!/usr/bin/env bash
#
# What is in the SMS queue, and is anything scheduled to flush it?
#
# READ-ONLY. It inspects and prints; it changes nothing, sends nothing and
# charges nothing. Safe to run on production at any time.
#
# Written after finding that `sms-queue` had never been added to this server's
# crontab. Every SMS handed in outside the 8am-8pm delivery window queued
# successfully and then sat in `scheduled_sms`, unsent, for months — the only
# thing that would have flushed it was a line nobody had typed. A queued
# message looks identical to a message in flight, so nothing reported it.
#
# Answering it took four rounds of guessing at paths over SSH. This exists so
# the next time it is one command.
#
# Usage:  bash deploy/diagnose-sms-queue.sh
#         ENV_FILE=/path/to/.env bash deploy/diagnose-sms-queue.sh
set -uo pipefail

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
ok() { printf '   \033[32mok\033[0m %s\n' "$*"; }

# ── 1. Find the app's .env, rather than assuming a layout ────────────────────
#
# THIS BOX HOSTS SEVERAL APPS, which is the trap. Taking PM2's first process
# landed on /home/dsii/public_html -- a different site entirely, with no
# deploy/ directory, which read as "the script isn't deployed" when in fact we
# were simply standing in somebody else's app. So every candidate is CHECKED
# before it is accepted: a directory only counts if it is recognisably this
# codebase, not merely because something is running there.

# Is this directory FlockInsight, rather than one of its neighbours?
is_this_app() {
  [ -f "$1/package.json" ] && grep -qi 'flockinsight' "$1/package.json" 2>/dev/null
}

# The .env for a directory: beside it, or in the releases layout's shared/.
env_for() {
  for cand in "$1/.env" "$1/../shared/.env" "$1/../../shared/.env"; do
    [ -f "$cand" ] && { (cd "$(dirname "$cand")" && printf '%s/%s' "$PWD" ".env"); return 0; }
  done
  return 1
}

find_env() {
  if [ -n "${ENV_FILE:-}" ]; then printf '%s' "$ENV_FILE"; return; fi

  # Every PM2 process, not the first -- and only ones that are actually this app.
  local cwd
  while read -r cwd; do
    [ -n "$cwd" ] || continue
    [ -d "$cwd" ] || continue
    is_this_app "$cwd" || continue
    env_for "$cwd" && return
  done <<EOF
$(pm2 jlist 2>/dev/null | tr ',' '\n' | grep -oE '"pm_cwd":"[^"]*"' | cut -d'"' -f4 | sort -u)
EOF

  for p in \
    "$HOME/apps/flockinsight/shared/.env" \
    "$HOME/apps/flockinsight/current/.env" \
    /var/www/flockinsight/.env \
    /var/www/flockinsight.com/.env
  do
    [ -f "$p" ] && { printf '%s' "$p"; return; }
  done

  # Last resort, bounded. -xdev stays on one filesystem.
  find / -xdev -maxdepth 7 -name .env -path '*flock*' 2>/dev/null | head -1
}

# Say what is running here regardless, because "which app am I in" is half the
# question every time somebody SSHes into this box.
say "PM2 processes on this box"
pm2 list 2>/dev/null | sed 's/^/   /' || warn "pm2 not on PATH"

say "App environment"
ENV_PATH="$(find_env)"
if [ -z "$ENV_PATH" ] || [ ! -f "$ENV_PATH" ]; then
  warn "no .env found. Pass it explicitly: ENV_FILE=/path/.env bash $0"
  exit 1
fi
ok ".env at $ENV_PATH"

# Read one value without sourcing the file — sourcing a .env runs whatever is
# in it, and a stray backtick in a password would be executed.
envval() {
  grep -m1 "^$1=" "$ENV_PATH" | cut -d= -f2- | sed -e 's/^"//' -e "s/^'//" \
    -e 's/"$//' -e "s/'$//"
}

IN_APP_CRON="$(envval IN_APP_CRON)"
DATABASE_URL="$(envval DATABASE_URL)"
BASE_URL="$(envval BETTER_AUTH_URL)"
[ -n "$(envval CRON_SECRET)" ] && ok "CRON_SECRET is set" || warn "CRON_SECRET is EMPTY — every /api/cron/* call returns 401"

# ── 2. Is anything scheduled to run the flush? ──────────────────────────────
say "Who is meant to run the jobs"
if [ "$IN_APP_CRON" = "true" ]; then
  ok "IN_APP_CRON=true — the app schedules itself from src/lib/cron-schedule.ts"
  warn "so the crontab lines below MUST NOT also exist, or every job runs twice"
else
  warn "IN_APP_CRON is not 'true' (value: '${IN_APP_CRON:-unset}') — the crontab is the only schedule"
fi

say "Jobs in this user's crontab"
CRON_JOBS_FOUND="$(crontab -l 2>/dev/null | grep -oE 'api/cron/[a-z-]+' | sed 's|api/cron/||' | sort -u)"
if [ -z "$CRON_JOBS_FOUND" ]; then
  warn "none at all"
else
  printf '%s\n' "$CRON_JOBS_FOUND" | sed 's/^/   /'
fi

if printf '%s\n' "$CRON_JOBS_FOUND" | grep -qx 'sms-queue'; then
  ok "sms-queue IS scheduled"
elif [ "$IN_APP_CRON" = "true" ]; then
  ok "sms-queue is not in the crontab, but the in-app scheduler covers it"
else
  warn "sms-queue is NOT SCHEDULED AND NOT COVERED. Nothing flushes the queue."
  warn "This is the fault. Fix it with either:"
  warn "  a) comment out the api/cron lines in the crontab, set IN_APP_CRON=true"
  warn "     in $ENV_PATH, then:"
  warn "       pm2 restart flockinsight --update-env"
  warn "     NOT 'pm2 restart all' — this box runs other sites, and restarting"
  warn "     them to change a FlockInsight setting takes them down for nothing."
  warn "     --update-env matters: without it PM2 keeps the old value and the"
  warn "     restart changes nothing at all."
  warn "  b) pnpm exec tsx scripts/print-crontab.ts --install"
fi

# ── 3. What is actually sitting in the queue? ───────────────────────────────
say "The queue itself"
if [ -z "$DATABASE_URL" ]; then
  warn "DATABASE_URL not readable from $ENV_PATH — skipping"
elif ! command -v psql >/dev/null 2>&1; then
  # psql is not installed here, and needing to install a package before you may
  # look at your own table is a reason not to look. The app's own connection
  # answers the same questions.
  warn "psql is not installed — using the app's own database connection instead"
  APP_DIR="$(dirname "$ENV_PATH")"
  [ -f "$APP_DIR/scripts/sms-queue-report.ts" ] || APP_DIR="$(dirname "$APP_DIR")/current"
  if [ -f "$APP_DIR/scripts/sms-queue-report.ts" ]; then
    ( cd "$APP_DIR" && pnpm exec tsx scripts/sms-queue-report.ts ) \
      || warn "the report failed — run it by hand from $APP_DIR"
  else
    warn "scripts/sms-queue-report.ts not found near $ENV_PATH"
    warn "run it from the app directory: pnpm exec tsx scripts/sms-queue-report.ts"
  fi
else
  psql "$DATABASE_URL" -X -P pager=off <<'SQL'
\echo '-- Batches by status. "queued" with an old `oldest` is the backlog.'
select status,
       count(*)                               as batches,
       sum(jsonb_array_length(recipients))    as messages,
       min(send_after)                        as oldest,
       max(send_after)                        as newest
  from scheduled_sms
 group by status
 order by status;

\echo '-- Queued, by age. Anything over a day old is past being worth sending.'
select case when send_after < now() - interval '24 hours' then 'over 24h (stale)'
            when send_after < now()                      then 'due now'
            else 'future'
       end                                    as age,
       count(*)                               as batches,
       sum(jsonb_array_length(recipients))    as messages
  from scheduled_sms
 where status = 'queued'
 group by 1
 order by 1;

\echo '-- Last run of every scheduled job. A job absent here has NEVER run.'
select job, max(started_at) as last_run
  from cron_run
 group by job
 order by last_run desc nulls last;
SQL
fi

# ── 4. Can the endpoint even be reached? ────────────────────────────────────
say "The endpoint, from this box"
if [ -z "$BASE_URL" ]; then
  warn "BETTER_AUTH_URL not set — cannot build the URL"
else
  # HEAD, and no key: a 401 proves the route is up and the guard works, while
  # sending nothing. Checking from the box is not the same as checking from
  # outside it, so this only rules the route out as the problem.
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
          "$BASE_URL/api/cron/sms-queue")"
  case "$code" in
    401) ok "$BASE_URL/api/cron/sms-queue answers 401 unauthorised — route is live" ;;
    000) warn "no answer at all from $BASE_URL — the app or the proxy is down" ;;
    *)   warn "answered $code without a key, which is not the 401 expected" ;;
  esac
fi

printf '\n'
