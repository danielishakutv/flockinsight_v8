#!/usr/bin/env bash
# FlockInsight — zero-downtime release.
#
# Builds the new version in its own directory while the running one keeps
# serving, then flips an atomic symlink and asks PM2 for a rolling reload. The
# live site is never pointed at a half-built tree, and there is no moment with
# no process on the port.
#
# Run on the VPS, or pipe it in over SSH (what the GitHub Action does):
#   ssh vps "APP_ROOT=/home/me/apps/flockinsight DEPLOY_SHA=$GITHUB_SHA bash -s" < deploy/deploy.sh
#
# Nothing here deletes: superseded releases are moved to releases/.trash/.
set -Eeuo pipefail

# Where the release layout lives.
#
# Run as a file it is <root>/releases/<stamp>/deploy/deploy.sh, so the root is
# three levels up — meaning a manual deploy needs no environment at all. Piped
# over SSH there is no script path to read, and the caller passes APP_ROOT.
default_app_root() {
  local src="${BASH_SOURCE[0]:-}"
  if [ -n "$src" ] && [ -f "$src" ]; then
    local dir root
    dir="$(cd "$(dirname "$src")" && pwd)"
    root="$(cd "$dir/../../.." 2>/dev/null && pwd)" || root=""
    if [ -n "$root" ] && [ -d "$root/releases" ] && [ -d "$root/shared" ]; then
      printf '%s' "$root"
      return
    fi
  fi
  printf '%s' "$HOME/apps/flockinsight"
}

APP_ROOT="${APP_ROOT:-$(default_app_root)}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-production}"
DEPLOY_REPO="${DEPLOY_REPO:-https://github.com/danielishakutv/flockinsight_v8.git}"
SMOKE_PORT="${SMOKE_PORT:-3987}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
PM2_APP="${PM2_APP:-flockinsight}"

RELEASES="$APP_ROOT/releases"
SHARED="$APP_ROOT/shared"
CURRENT="$APP_ROOT/current"
MIRROR="$APP_ROOT/repo.git"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# The port Apache proxies to, resolved the way ecosystem.config.cjs does it:
# an explicit override, else PORT in shared/.env, else 3001. Verifying a
# different port from the one the app was told to listen on is how a good
# deploy reports failure — or a bad one reports success against another app.
resolve_port() {
  if [ -n "${FLOCKINSIGHT_PORT:-}" ]; then
    printf '%s' "$FLOCKINSIGHT_PORT"
    return
  fi
  local found
  found="$(grep -E '^[[:space:]]*PORT[[:space:]]*=' "$SHARED/.env" 2>/dev/null | head -1 | tr -dc '0-9')"
  printf '%s' "${found:-3001}"
}

PORT="$(resolve_port)"

SMOKE_PID=""
cleanup() {
  if [ -n "$SMOKE_PID" ] && kill -0 "$SMOKE_PID" 2>/dev/null; then
    kill "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------- preflight
log "Preflight"
for cmd in git node pnpm pm2 curl; do
  command -v "$cmd" >/dev/null 2>&1 || die "$cmd is not on PATH"
done
[ -d "$RELEASES" ] || die "$RELEASES is missing — run deploy/setup-releases.sh once first"
[ -f "$SHARED/.env" ] || die "$SHARED/.env is missing — the release symlinks its env from there"
[ -f "$SHARED/ecosystem.config.cjs" ] || die "$SHARED/ecosystem.config.cjs is missing"
note "app root  $APP_ROOT"
note "node      $(node --version)"

# Needed at build time so every worker can decrypt the other's Server Action
# payloads; Next generates a throwaway key per build otherwise, which shows up
# as "Failed to find Server Action" for anyone mid-session across a deploy.
grep -q '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' "$SHARED/.env" \
  || die "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is not set in $SHARED/.env (see DEPLOY.md)"

# ------------------------------------------------------------------- fetch
log "Fetching $DEPLOY_BRANCH"
if [ ! -d "$MIRROR" ]; then
  git clone --mirror "$DEPLOY_REPO" "$MIRROR"
else
  git -C "$MIRROR" remote set-url origin "$DEPLOY_REPO"
  git -C "$MIRROR" fetch --prune origin "+refs/heads/*:refs/heads/*"
fi

# Say plainly which branch is missing, rather than letting rev-parse fail
# with "unknown revision" — which reads like a broken clone. Deploying by
# hand from main before a production branch exists is the normal case here,
# not a mistake.
if [ -z "${DEPLOY_SHA:-}" ] &&
   ! git -C "$MIRROR" show-ref --verify --quiet "refs/heads/$DEPLOY_BRANCH"; then
  note "Branches on the remote:"
  git -C "$MIRROR" for-each-ref --format='      %(refname:short)' refs/heads/ >&2
  note ""
  note "Deploy from one of those, e.g.:  DEPLOY_BRANCH=main bash deploy/deploy.sh"
  die "branch '$DEPLOY_BRANCH' does not exist on the remote"
fi

SHA="${DEPLOY_SHA:-$(git -C "$MIRROR" rev-parse "$DEPLOY_BRANCH")}"
git -C "$MIRROR" cat-file -e "${SHA}^{commit}" 2>/dev/null || die "commit $SHA is not in the mirror"
SHORT="${SHA:0:7}"
SUBJECT="$(git -C "$MIRROR" log -1 --format=%s "$SHA")"
note "$SHORT  $SUBJECT"

RELEASE="$RELEASES/$(date +%Y%m%d-%H%M%S)-$SHORT"
if [ -e "$RELEASE" ]; then die "$RELEASE already exists"; fi

PREVIOUS=""
if [ -L "$CURRENT" ]; then PREVIOUS="$(readlink -f "$CURRENT")"; fi

# ----------------------------------------------------------------- prepare
log "Unpacking into $(basename "$RELEASE")"
mkdir -p "$RELEASE"
git -C "$MIRROR" archive "$SHA" | tar -x -C "$RELEASE"

ln -s "$SHARED/.env" "$RELEASE/.env"
# Read by next build (embedded into the output) and by next start at runtime,
# so /api/health can report exactly which commit is answering.
printf 'DEPLOYMENT_ID=%s\n' "$SHA" > "$RELEASE/.env.production.local"

log "Installing dependencies"
( cd "$RELEASE" && pnpm install --prod=false --frozen-lockfile )

# Migrations run before the swap, so they must be additive — adding columns,
# tables or indexes. A rename or a drop breaks the old workers that are still
# serving during the reload, and breaks a rollback outright.
log "Applying database migrations"
( cd "$RELEASE" && pnpm db:migrate )

log "Building"
( cd "$RELEASE" && NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" pnpm build )

# --------------------------------------------------------------- smoke test
# Prove the new build boots and answers before anything points at it. This is
# what stops a broken release from ever reaching the public.
#
# Bound to loopback: next start listens on every interface by default, which
# would put an unreleased build on the public IP for the length of the check.
log "Smoke-testing on port $SMOKE_PORT"
( cd "$RELEASE" && PORT="$SMOKE_PORT" exec node node_modules/next/dist/bin/next start -p "$SMOKE_PORT" -H 127.0.0.1 ) \
  > "$RELEASE/smoke.log" 2>&1 &
SMOKE_PID=$!

smoke_ok=""
for _ in $(seq 1 60); do
  if ! kill -0 "$SMOKE_PID" 2>/dev/null; then break; fi
  body="$(curl -fsS --max-time 3 "http://127.0.0.1:$SMOKE_PORT/api/health" 2>/dev/null || true)"
  case "$body" in *"\"deployment\":\"$SHA\""*) smoke_ok=yes; break ;; esac
  sleep 1
done
cleanup
SMOKE_PID=""

if [ -z "$smoke_ok" ]; then
  note "--- last 30 lines of smoke.log ---"
  tail -30 "$RELEASE/smoke.log" || true
  die "the new build never answered on $SMOKE_PORT — nothing was swapped, the site is untouched"
fi
note "new build boots and reports $SHORT"

# --------------------------------------------------------------- go live
# ln + mv -T replaces the symlink in one syscall: no instant where `current`
# is missing or points at nothing.
log "Switching current → $(basename "$RELEASE")"
ln -sfn "$RELEASE" "$CURRENT.staging"
mv -Tf "$CURRENT.staging" "$CURRENT"

# setup-releases.sh stages the very first release this way: the symlink is
# in place, but PM2 is still running the old single-directory install and is
# cut over deliberately rather than reloaded into a layout it never knew.
if [ -n "${SKIP_PM2:-}" ]; then
  log "SKIP_PM2 set — release staged at $CURRENT, PM2 left alone"
  exit 0
fi

log "Reloading PM2 (rolling, one worker at a time)"
pm2 startOrReload "$SHARED/ecosystem.config.cjs" --update-env
pm2 save --force >/dev/null

# --------------------------------------------------------------- verify
log "Verifying on port $PORT"
live=""
for _ in $(seq 1 60); do
  body="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  case "$body" in *"\"deployment\":\"$SHA\""*) live=$(( live + 1 )) ;; *) live="" ;; esac
  # Several in a row, so we are reasonably sure both workers have turned over
  # rather than having caught the one that happened to restart first.
  if [ "${live:-0}" -ge 5 ]; then break; fi
  sleep 1
done

if [ "${live:-0}" -lt 5 ]; then
  log "Verification failed — rolling back"
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    ln -sfn "$PREVIOUS" "$CURRENT.staging"
    mv -Tf "$CURRENT.staging" "$CURRENT"
    pm2 startOrReload "$SHARED/ecosystem.config.cjs" --update-env
    note "rolled back to $(basename "$PREVIOUS")"
  else
    note "no previous release to roll back to — check: pm2 logs $PM2_APP"
  fi
  die "$SHORT did not come up on port $PORT"
fi

# --------------------------------------------------------------- tidy up
# Moved aside, never removed: emptying releases/.trash is a decision for a
# human with a look at what is in it.
if [ "$KEEP_RELEASES" -gt 0 ]; then
  mkdir -p "$RELEASES/.trash"
  keep_from=$(( KEEP_RELEASES + 1 ))
  superseded="$(ls -1 "$RELEASES" | grep -v '^\.trash$' | sort -r | tail -n "+$keep_from" || true)"
  for old in $superseded; do
    if [ "$RELEASES/$old" = "$PREVIOUS" ] || [ "$RELEASES/$old" = "$RELEASE" ]; then
      continue
    fi
    mv "$RELEASES/$old" "$RELEASES/.trash/$old"
    note "retired $old → .trash/"
  done
  trash_count="$(ls -1 "$RELEASES/.trash" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${trash_count:-0}" -gt 0 ]; then
    note "$trash_count release(s) in $RELEASES/.trash — remove by hand when happy"
  fi
fi

log "Deployed $SHORT — $SUBJECT"
