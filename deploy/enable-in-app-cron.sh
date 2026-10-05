#!/usr/bin/env bash
#
# Hand the schedule to the app, and stop relying on the crontab.
#
#   bash deploy/enable-in-app-cron.sh            # DRY RUN — shows everything, changes nothing
#   bash deploy/enable-in-app-cron.sh --apply    # does it
#
# WHY. Three jobs have been lost by the crontab on this box. `sms-queue` was
# never added, so every SMS held for the 8am-8pm delivery window sat unsent.
# `demo-reset` was never added, so the demo church that advertises "rebuilt
# every two hours" has never been rebuilt. `meetings` is present in the crontab
# and still stopped running on 3 October. A line being there is not the same as
# it working, and nothing can see the difference from inside the app.
#
# The in-app scheduler enumerates src/lib/cron-schedule.ts, and a job that has
# never run is due immediately — so a job cannot be forgotten, and all three of
# those heal themselves within a minute of this being switched on.
#
# ---------------------------------------------------------------------------
# WHAT THIS WILL NOT DO
#
# It never deletes a crontab line. Cron lines for this app are COMMENTED OUT,
# with the date and the reason, so the old schedule is readable and restorable.
#
# It never touches a line that is not one of this app's /api/cron/ calls. The
# backups, the watchdog, and the other five apps on this box are not its
# business.
#
# It writes the new crontab to a file, CHECKS IT, and only then installs it.
# `crontab -` replaces the entire crontab from stdin, so a pipeline that fails
# half way installs a truncated one — which is how a machine loses its backups
# without anybody noticing. The check refuses unless the line count is
# unchanged and every non-cron line survived byte for byte.
#
# It restarts flockinsight only, never `pm2 restart all`. This box also runs
# dsii, fremo, aictig-website and tedx-speaker.
#
# It prints the exact rollback command before it changes anything.
# ---------------------------------------------------------------------------
set -uo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32mok\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOPPED:\033[0m %s\n\n' "$*" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$APPLY" = "0" ]; then
  printf '\n\033[1;33m*** DRY RUN — nothing will be changed. ***\033[0m\n'
  printf 'Re-run with --apply once the plan below looks right.\n'
fi

# ── 1. The .env that the running app actually reads ─────────────────────────
say "The .env"
ENV_PATH=""
for cand in "${ENV_FILE:-}" "$HERE/.env" "$HERE/../shared/.env"; do
  [ -n "$cand" ] && [ -f "$cand" ] && { ENV_PATH="$cand"; break; }
done
[ -n "$ENV_PATH" ] || die "no .env found near $HERE — pass ENV_FILE=/path/.env"

# Follow the symlink. In the releases layout current/.env points at shared/.env,
# and writing to the link writes through — but a release where it is a REAL
# file would lose the setting at the next deploy, silently, and the outage
# would come back weeks later looking like something new.
REAL_ENV="$(readlink -f "$ENV_PATH")"
ok "app reads $ENV_PATH"
if [ "$REAL_ENV" != "$ENV_PATH" ]; then
  ok "which is a link to $REAL_ENV — the setting will survive a deploy"
else
  case "$REAL_ENV" in
    */shared/.env) ok "this is the shared .env — it will survive a deploy" ;;
    *) warn "this is a REAL FILE inside the release, not a link to shared/.env." ;;
  esac
fi

if grep -qE '^[[:space:]]*IN_APP_CRON[[:space:]]*=[[:space:]]*"?true"?[[:space:]]*$' "$REAL_ENV"; then
  ok "IN_APP_CRON is already true"
  ENV_NEEDS_WRITE=0
else
  warn "IN_APP_CRON is not true yet — will append IN_APP_CRON=true"
  ENV_NEEDS_WRITE=1
  if grep -q '^[[:space:]]*IN_APP_CRON' "$REAL_ENV"; then
    warn "there is an existing IN_APP_CRON line; the appended one wins (last wins)"
  fi
fi
# Read the value and strip the quotes before judging it: `CRON_SECRET=""` is a
# line with text on it and an empty secret, and the scheduler would start,
# log a warning nobody reads, and schedule nothing.
SECRET_VAL="$(grep -m1 '^[[:space:]]*CRON_SECRET=' "$REAL_ENV" | cut -d= -f2- \
  | sed -e 's/^"//' -e "s/^'//" -e 's/"$//' -e "s/'$//")"
[ -n "$SECRET_VAL" ] \
  || die "CRON_SECRET is empty in $REAL_ENV — the scheduler will not start without it, and would schedule nothing."
ok "CRON_SECRET is set"

# ── 2. The crontab, and exactly which lines are ours ────────────────────────
say "The crontab"
CURRENT="$(crontab -l 2>/dev/null)" || CURRENT=""
[ -n "$CURRENT" ] || die "this user has no crontab — nothing to do here."

TOTAL=$(printf '%s\n' "$CURRENT" | wc -l)
OURS=$(printf '%s\n' "$CURRENT" | grep -cE '^[[:space:]]*[^#].*api/cron/' || true)
ok "$TOTAL lines in total, $OURS of them calling this app's /api/cron/"
[ "$OURS" -gt 0 ] || { ok "nothing to comment out"; }

echo
echo "   These lines WILL BE COMMENTED OUT (secret redacted for display):"
printf '%s\n' "$CURRENT" | grep -nE '^[[:space:]]*[^#].*api/cron/' \
  | sed -E 's/(key=|Bearer )[^"& ]+/\1<redacted>/g' | sed 's/^/     /'
echo
echo "   Every other line is left exactly as it is, including:"
printf '%s\n' "$CURRENT" | grep -vE '^[[:space:]]*[^#].*api/cron/' | grep -vE '^[[:space:]]*$' \
  | sed -E 's/(key=|Bearer |PASSWORD=|SECRET=)[^"& ]+/\1<redacted>/g' | head -20 | sed 's/^/     /'

# ── 3. Build the replacement, then check it BEFORE installing ──────────────
STAMP="$(date +%F-%H%M%S)"
BACKUP_DIR="$HOME/.crontab-backups"
BACKUP="$BACKUP_DIR/crontab.$STAMP"
NEWFILE="$BACKUP_DIR/crontab.$STAMP.proposed"

mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
printf '%s\n' "$CURRENT" > "$BACKUP" && chmod 600 "$BACKUP"

# Comment, never delete. The marker says when and why, so a year from now the
# old schedule is not a mystery.
printf '%s\n' "$CURRENT" \
  | sed -E "s|^([[:space:]]*[^#].*api/cron/.*)$|# [disabled $STAMP: IN_APP_CRON=true runs these from inside the app] \1|" \
  > "$NEWFILE"
chmod 600 "$NEWFILE"

say "Checking the proposed crontab before installing it"
NEW_TOTAL=$(wc -l < "$NEWFILE")
[ "$NEW_TOTAL" = "$TOTAL" ] \
  || die "line count changed ($TOTAL -> $NEW_TOTAL). Nothing was installed. Backup: $BACKUP"
ok "line count unchanged ($TOTAL)"

# Every line that is not one of ours must be byte-for-byte identical.
KEPT_BEFORE="$(printf '%s\n' "$CURRENT" | grep -vE '^[[:space:]]*[^#].*api/cron/' || true)"
KEPT_AFTER="$(grep -vE '^# \[disabled '"$STAMP" "$NEWFILE" || true)"
if [ "$KEPT_BEFORE" != "$KEPT_AFTER" ]; then
  die "a line that is not ours would have changed. Nothing was installed. Backup: $BACKUP"
fi
ok "every other line is byte-for-byte identical"

STILL_ACTIVE=$(grep -cE '^[[:space:]]*[^#].*api/cron/' "$NEWFILE" || true)
[ "$STILL_ACTIVE" = "0" ] \
  || die "$STILL_ACTIVE cron line(s) would still be active — both schedules would run and jobs would double. Nothing installed."
ok "no /api/cron/ line left active — nothing will run twice"

say "Rollback (keep this)"
echo "   crontab $BACKUP"
echo
echo "   The backup is written whether or not this applies, so that command"
echo "   works from now on regardless."

# ── 4. Apply ───────────────────────────────────────────────────────────────
if [ "$APPLY" = "0" ]; then
  say "Dry run finished"
  echo "   Nothing was changed. The proposed crontab is at:"
  echo "     $NEWFILE"
  echo "   Read it, then run:  bash deploy/enable-in-app-cron.sh --apply"
  echo
  exit 0
fi

say "Applying"
crontab "$NEWFILE" || die "crontab refused the file. Nothing changed. Backup: $BACKUP"
ok "crontab installed"
INSTALLED_ACTIVE=$(crontab -l 2>/dev/null | grep -cE '^[[:space:]]*[^#].*api/cron/' || true)
[ "$INSTALLED_ACTIVE" = "0" ] \
  || warn "there are still $INSTALLED_ACTIVE active cron lines — check with: crontab -l"

if [ "$ENV_NEEDS_WRITE" = "1" ]; then
  cp -a "$REAL_ENV" "$REAL_ENV.bak.$STAMP" && chmod 600 "$REAL_ENV.bak.$STAMP"
  ok "copied $REAL_ENV to $REAL_ENV.bak.$STAMP"
  # A newline first: a .env whose last line has no trailing newline would
  # otherwise end up as `FOO=barIN_APP_CRON=true`.
  printf '\n# Added %s: the app schedules itself (see src/lib/cron-schedule.ts).\nIN_APP_CRON=true\n' \
    "$STAMP" >> "$REAL_ENV"
  ok "IN_APP_CRON=true appended to $REAL_ENV"
fi

say "Restarting flockinsight only"
# --update-env or PM2 keeps the old environment and the restart changes nothing.
# By name, so the other five apps on this box are not touched.
pm2 restart flockinsight --update-env || die "pm2 restart failed — check: pm2 logs flockinsight"
pm2 save --force >/dev/null 2>&1 || warn "pm2 save failed (the restart still took effect)"
ok "restarted"

say "Now verify"
cat <<VERIFY
   Give it about two minutes, then:

     pm2 logs flockinsight --lines 40 --nostream | grep -i scheduler
       expect: [scheduler] in-app cron is on; the crontab entries can be removed

     cd $HERE && pnpm exec tsx scripts/check-cron-status.ts
       expect: sms-queue, demo-reset and meetings all showing a recent run

   If nothing happens, the usual cause is a restart without --update-env.
   To undo everything:  crontab $BACKUP
VERIFY
echo
