#!/usr/bin/env bash
# FlockInsight — one-time migration to the zero-downtime release layout.
#
# Turns a plain clone at ~/apps/flockinsight into:
#
#   ~/apps/flockinsight/
#   ├── shared/            .env and ecosystem.config.cjs — outlive every release
#   ├── releases/          one directory per deploy
#   ├── current -> releases/<newest>
#   └── repo.git           mirror, so a deploy fetches instead of re-cloning
#
# Nothing is deleted. The existing install is renamed to
# <root>.pre-releases.<date> and left exactly as it is; the running process
# keeps serving from it throughout, because a rename does not disturb an open
# working directory.
#
# The site is down for one Next.js boot — a few seconds — at the cutover at the
# end, and never again after that.
#
# The branch it builds from must already exist on the remote. Migrate off main
# before the production branch exists, so that creating that branch later does
# not fire a deploy at a box that is not ready:
#
#   DEPLOY_BRANCH=main bash deploy/setup-releases.sh
#
#   bash deploy/setup-releases.sh              # prepare and stage, no cutover
#   CONFIRM_CUTOVER=yes bash deploy/setup-releases.sh   # ... and switch PM2 over
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-$HOME/apps/flockinsight}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-production}"
DEPLOY_REPO="${DEPLOY_REPO:-https://github.com/danielishakutv/flockinsight_v8.git}"
PM2_APP="${PM2_APP:-flockinsight}"

SHARED="$APP_ROOT/shared"
CURRENT="$APP_ROOT/current"
RELEASES="$APP_ROOT/releases"
MIRROR="$APP_ROOT/repo.git"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

log "Preflight"
for cmd in git node pnpm pm2 curl openssl tar; do
  command -v "$cmd" >/dev/null 2>&1 || die "$cmd is not on PATH"
done
[ -f "$HERE/deploy.sh" ] || die "deploy.sh must sit next to this script"
if [ -d "$RELEASES" ]; then
  die "$RELEASES already exists — this box is already migrated, just run deploy.sh"
fi

# ------------------------------------------------- move the old install aside
OLD=""
if [ -e "$APP_ROOT" ]; then
  OLD="$APP_ROOT.pre-releases.$(date +%F-%H%M)"
  log "Renaming the existing install"
  note "$APP_ROOT  →  $OLD"
  note "the running process is unaffected: its working directory follows the rename"
  mv "$APP_ROOT" "$OLD"
  # ...which just moved this script too. Bash carries on from the open file,
  # but HERE now names a directory that no longer exists.
  case "$HERE" in
    "$APP_ROOT"/*) HERE="$OLD${HERE#$APP_ROOT}" ;;
  esac
  [ -f "$HERE/deploy.sh" ] || die "lost track of deploy.sh after the rename (looked in $HERE)"
  note "scripts now read from $HERE"
fi

mkdir -p "$SHARED" "$RELEASES"

# ----------------------------------------------------------------- shared env
log "Setting up shared/"
if [ -n "$OLD" ] && [ -f "$OLD/.env" ]; then
  cp -a "$OLD/.env" "$SHARED/.env"
  note "copied .env from the previous install"
else
  die "no .env found at $OLD/.env — put your production .env at $SHARED/.env and re-run"
fi

# Next generates a fresh Server Actions key per build unless this is pinned, so
# without it every deploy hands mid-session users "Failed to find Server
# Action" — and with two workers, so does every other request.
if grep -q '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' "$SHARED/.env"; then
  note "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY already set"
else
  printf '\n# Pinned so every worker and every release share one key.\nNEXT_SERVER_ACTIONS_ENCRYPTION_KEY=%s\n' \
    "$(openssl rand -base64 32)" >> "$SHARED/.env"
  note "generated NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"
fi

# ---------------------------------------------------------------- the mirror
log "Mirroring the repository"
git clone --mirror "$DEPLOY_REPO" "$MIRROR"
git -C "$MIRROR" cat-file -e "$DEPLOY_BRANCH^{commit}" 2>/dev/null \
  || die "branch '$DEPLOY_BRANCH' does not exist on the remote yet — push it first"

# PM2 reads this from shared/, a path that survives every release.
git -C "$MIRROR" show "$DEPLOY_BRANCH:ecosystem.config.cjs" > "$SHARED/ecosystem.config.cjs"
note "wrote $SHARED/ecosystem.config.cjs"

# ------------------------------------------------------ stage first release
log "Building the first release (PM2 untouched)"
SKIP_PM2=1 APP_ROOT="$APP_ROOT" DEPLOY_BRANCH="$DEPLOY_BRANCH" DEPLOY_REPO="$DEPLOY_REPO" \
  bash "$HERE/deploy.sh"

# ------------------------------------------------------------------ cutover
if [ "${CONFIRM_CUTOVER:-}" != "yes" ]; then
  log "Staged, not yet live"
  note "The site is still served by the old install. When you are ready:"
  note ""
  note "  CONFIRM_CUTOVER=yes bash $(readlink -f "$CURRENT")/deploy/setup-releases.sh"
  note ""
  note "or do it by hand (a few seconds of downtime):"
  note "  pm2 delete $PM2_APP && pm2 start $SHARED/ecosystem.config.cjs && pm2 save"
  exit 0
fi

log "Cutting PM2 over to the release layout"
note "this is the one short outage — a single Next.js boot"
pm2 delete "$PM2_APP" 2>/dev/null || note "no existing '$PM2_APP' process to remove"
pm2 start "$SHARED/ecosystem.config.cjs"
pm2 save --force >/dev/null

PORT="${FLOCKINSIGHT_PORT:-3001}"
log "Verifying on port $PORT"
ok=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    ok=yes
    break
  fi
  sleep 1
done
[ -n "$ok" ] || die "nothing answered on $PORT — pm2 logs $PM2_APP, and $OLD is still intact"

log "Done"
note "old install kept at $OLD — remove it yourself once you are happy"
note "from here on, deploys are: bash deploy/deploy.sh (or a push to $DEPLOY_BRANCH)"
