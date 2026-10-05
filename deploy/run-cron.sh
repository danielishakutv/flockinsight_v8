#!/usr/bin/env bash
#
# Run one scheduled job by hand, now.
#
#   bash deploy/run-cron.sh sms-queue
#   bash deploy/run-cron.sh platform-health
#
# Reads CRON_SECRET from the app's .env and sends it as an Authorization
# header via curl's stdin config, so the secret appears in neither the process
# list (`ps` shows every argument to anyone with an account on this box) nor
# the web server's access log (which is where `?key=` has been writing it on
# every run, several times a minute, for months).
#
# Safe to run twice: every job claims its work with a conditional update before
# anything leaves the machine.
set -uo pipefail

JOB="${1:-}"
if [ -z "$JOB" ]; then
  echo "usage: bash deploy/run-cron.sh <job>" >&2
  echo "jobs:  see CRON_JOBS in src/lib/cron-schedule.ts" >&2
  exit 1
fi

# The .env beside this checkout, or the releases layout's shared copy.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_PATH=""
for cand in "${ENV_FILE:-}" "$HERE/.env" "$HERE/../shared/.env"; do
  [ -n "$cand" ] && [ -f "$cand" ] && { ENV_PATH="$cand"; break; }
done
[ -n "$ENV_PATH" ] || { echo "no .env found near $HERE" >&2; exit 1; }

# Read values without sourcing: sourcing a .env executes whatever is in it, and
# a backtick in a password would run.
envval() {
  grep -m1 "^$1=" "$ENV_PATH" | cut -d= -f2- \
    | sed -e 's/^"//' -e "s/^'//" -e 's/"$//' -e "s/'$//"
}

KEY="$(envval CRON_SECRET)"
URL="$(envval BETTER_AUTH_URL)"
[ -n "$KEY" ] || { echo "CRON_SECRET is empty in $ENV_PATH" >&2; exit 1; }
[ -n "$URL" ] || { echo "BETTER_AUTH_URL is empty in $ENV_PATH" >&2; exit 1; }
URL="${URL%/}"

echo "running $JOB against $URL ..." >&2
printf 'header = "Authorization: Bearer %s"\n' "$KEY" \
  | curl -sS --max-time 600 -K - -w '\n[HTTP %{http_code}]\n' "$URL/api/cron/$JOB"
