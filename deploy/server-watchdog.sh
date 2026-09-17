#!/usr/bin/env bash
#
# Server watchdog — every five minutes, check the things that have actually
# broken this box, and email when one of them is breaking again.
#
# Written after two incidents that had the same shape:
#
#   2026-08-25  Every site returned Cloudflare 522 for a full day. An SMTP
#               AUTH flood exhausted kernel tcp_mem. Apache looked guilty and
#               was a victim. Nothing was watching, so nobody knew.
#   2026-09-13  A deploy failed for want of memory. One Next app had been
#               holding 5.3GB — 43% of the machine — for five days. PM2
#               reported it as 26MB, because PM2 was managing the `npm start`
#               wrapper and the memory was in its grandchild. Nothing was
#               watching that either.
#
# The lesson both times was not "add a check for X". It was that the thing
# which broke was not on the list. So this watches the whole machine — every
# process, not just ours; memory and swap, not just load; the backup, the
# database, the certificate, and the URLs a person would actually visit.
#
# Install:
#   cp deploy/server-watchdog.sh /usr/local/sbin/server-watchdog.sh
#   chmod 700 /usr/local/sbin/server-watchdog.sh
#   cp deploy/server-watchdog.conf.example /etc/server-watchdog.conf
#   chmod 600 /etc/server-watchdog.conf     # it holds an API key
#   nano /etc/server-watchdog.conf
#   /usr/local/sbin/server-watchdog.sh --test     # prove the alert arrives
#   crontab -e
#     */5 * * * * /usr/local/sbin/server-watchdog.sh >/dev/null 2>&1
#
# Exits 0 even when it alerts. A watchdog that makes cron email you as well is
# a watchdog you turn off.

set -uo pipefail

CONF=${WATCHDOG_CONF:-/etc/server-watchdog.conf}
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"

# ---------------------------------------------------------------- settings
# All overridable from the conf file.
ALERT_TO=${ALERT_TO:-}
ALERT_FROM=${ALERT_FROM:-}
# Alerts go out through ZeptoMail — the same provider the app sends on, so
# there is one account to keep alive instead of two.
ZEPTOMAIL_TOKEN=${ZEPTOMAIL_TOKEN:-}
ZEPTOMAIL_API_URL=${ZEPTOMAIL_API_URL:-}
# Where to fall back to for the token, so it lives in exactly one place.
APP_ENV_FILE=${APP_ENV_FILE:-/home/flockinsight/app/shared/.env}
STATE_DIR=${STATE_DIR:-/var/lib/server-watchdog}
# One alert per condition per hour. Long enough not to nag, short enough that
# an ongoing problem keeps reminding you.
REPEAT_AFTER=${REPEAT_AFTER:-3600}

# Thresholds. Chosen to fire before a problem becomes an outage, not after.
LOAD_PER_CORE=${LOAD_PER_CORE:-2.0}       # 1-min load / nproc
MEM_AVAIL_MIN_PCT=${MEM_AVAIL_MIN_PCT:-15}
SWAP_USED_MAX_PCT=${SWAP_USED_MAX_PCT:-50}
# The 2026-09-13 check: no single process should own this much of the box.
PROC_RSS_MAX_PCT=${PROC_RSS_MAX_PCT:-25}
DISK_MAX_PCT=${DISK_MAX_PCT:-85}
# The 2026-08-25 check. tcp_mem's ceiling is small relative to RAM and does
# not always drain after a flood.
TCP_MEM_MAX_PCT=${TCP_MEM_MAX_PCT:-70}
BACKUP_MAX_AGE_H=${BACKUP_MAX_AGE_H:-36}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/flockinsight}
# The off-site copy. scripts/backup.sh treats its rclone step as non-fatal, so
# nothing else would ever tell you it stopped. Empty disables the check.
OFFSITE_REMOTE=${OFFSITE_REMOTE:-gdrive:flockinsight-backups}
OFFSITE_MAX_AGE_H=${OFFSITE_MAX_AGE_H:-36}
OFFSITE_MIN_FREE_PCT=${OFFSITE_MIN_FREE_PCT:-20}
# A single failed listing is almost always the network or a Drive API hiccup,
# not a broken backup: on 2026-09-17 one run timed out at 45s while eight run
# by hand straight afterwards each answered in under a second. Alerting on one
# bad run teaches you to ignore the alert, which is worse than not having it.
# So a failure must survive this many consecutive runs — five minutes apart —
# before it speaks, and rclone gets real retries rather than a single attempt.
OFFSITE_FAIL_STREAK=${OFFSITE_FAIL_STREAK:-2}
OFFSITE_RETRIES=${OFFSITE_RETRIES:-3}
OFFSITE_TIMEOUT_S=${OFFSITE_TIMEOUT_S:-120}
CERT_MIN_DAYS=${CERT_MIN_DAYS:-14}
# Space-separated. Each must answer 200.
CHECK_URLS=${CHECK_URLS:-"https://flockinsight.com/api/health"}
CHECK_PM2=${CHECK_PM2:-1}
PG_CHECK=${PG_CHECK:-1}

mkdir -p "$STATE_DIR" 2>/dev/null || true

# Read one KEY=value out of an env file. Deliberately not `source`: that would
# execute the app's entire .env inside a root cron job.
env_value() {
  local key=$1 file=$2 v
  [ -r "$file" ] || return 0
  v=$(sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}${key}=//p" "$file" | head -1)
  v=${v%$'\r'}
  case "$v" in
    \"*\") v=${v#\"}; v=${v%\"} ;;
    \'*\') v=${v#\'}; v=${v%\'} ;;
  esac
  printf '%s' "$v"
}

# One token, one place. If the conf does not carry it, read the app's env —
# rotating the token there must never quietly leave this script mute.
[ -n "$ZEPTOMAIL_TOKEN" ] || ZEPTOMAIL_TOKEN=$(env_value ZEPTOMAIL_TOKEN "$APP_ENV_FILE")
[ -n "$ZEPTOMAIL_API_URL" ] || ZEPTOMAIL_API_URL=$(env_value ZEPTOMAIL_API_URL "$APP_ENV_FILE")
ZEPTOMAIL_API_URL=${ZEPTOMAIL_API_URL:-https://api.zeptomail.com/v1.1/email}

FINDINGS=""
# Categories of the checks currently firing, one per line. Kept apart from the
# text on purpose: the rate-limit key is built from these, and findings are
# multi-line, so deriving the key from the text itself would fold continuation
# lines ("cwd:", "Busiest:") into it and change the key on every run — which
# would defeat the rate limiting entirely.
FIRING=""
note() {
  FIRING="${FIRING}$1"$'\n'
  FINDINGS="${FINDINGS}$1  $2"$'\n'
}

# ------------------------------------------------------------------- alert
#
# Rate limited per condition, by a key the caller chooses. The key must be
# stable for the same problem and different for a different one, or an ongoing
# disk alert will suppress a new memory alert.
# Where a condition's cooldown is recorded. Shared with the caller, which
# clears it when a send fails.
stamp_path() {
  printf '%s/%s' "$STATE_DIR" "$(printf '%s' "$1" | tr -c 'a-zA-Z0-9_.-' '_')"
}

should_alert() {
  local key=$1 now stamp last
  now=$(date +%s)
  stamp=$(stamp_path "$key")
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt "$REPEAT_AFTER" ]; then
    return 1
  fi
  printf '%s' "$now" > "$stamp"
  return 0
}

# ZeptoMail, over its REST API — the same provider the app sends on, so there
# is one account and one token to keep alive rather than two.
#
# Not the local MTA, for the reason it was never the local MTA: this box signs
# with a DKIM key that was never published to DNS, so Gmail rejects its mail
# outright with dsn=5.7.26. An alert that bounces is worse than no alert,
# because it feels safe.
#
# Returns non-zero when the mail did not leave, and says so to syslog. Reading
# the status rather than trusting that curl ran is the whole point: a watchdog
# that thinks it alerted is the failure this script exists to avoid.
send_email() {
  local subject=$1 body=$2 auth from_name from_addr html res code
  if [ -z "$ZEPTOMAIL_TOKEN" ] || [ -z "$ALERT_TO" ] || [ -z "$ALERT_FROM" ]; then
    logger -t server-watchdog "ALERT (email not configured): $subject"
    return 1
  fi

  # ZeptoMail wants the display name and the address apart, and refuses any
  # address outside a verified domain — so only the name ever varies.
  from_addr=$(printf '%s' "$ALERT_FROM" | sed -n 's/.*<\(.*\)>.*/\1/p')
  from_name=$(printf '%s' "$ALERT_FROM" | sed -n 's/^[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*<.*>.*$/\1/p')
  [ -n "$from_addr" ] || from_addr=$ALERT_FROM

  # Both bodies. textbody is the alert as written; htmlbody wraps it in <pre>
  # so a mail client keeps the line breaks that make a findings list readable.
  html="<pre>$(printf '%s' "$body" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')</pre>"

  # The console hands you the token with its scheme already attached; adding a
  # second prefix is the easiest way to get a 401 that looks like a bad key.
  case "$ZEPTOMAIL_TOKEN" in
    Zoho-enczapikey*) auth=$ZEPTOMAIL_TOKEN ;;
    *) auth="Zoho-enczapikey $ZEPTOMAIL_TOKEN" ;;
  esac

  res=$(curl -s -w '\n%{http_code}' --max-time 20 \
    -X POST "$ZEPTOMAIL_API_URL" \
    -H "Authorization: $auth" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$(printf '{"from":{"address":%s,"name":%s},"to":[{"email_address":{"address":%s}}],"subject":%s,"textbody":%s,"htmlbody":%s}' \
          "$(json_str "$from_addr")" \
          "$(json_str "$from_name")" \
          "$(json_str "$ALERT_TO")" \
          "$(json_str "$subject")" \
          "$(json_str "$body")" \
          "$(json_str "$html")")" 2>/dev/null)
  code=$(printf '%s' "$res" | tail -n1)

  case "$code" in
    2*) return 0 ;;
  esac
  logger -t server-watchdog \
    "ALERT SEND FAILED (HTTP ${code:-none}): $(printf '%s' "$res" | sed '$d' | tr -d '\n' | cut -c1-200)"
  return 1
}

# JSON string escaping for the alert payload.
#
# Prefers python3, falls back to awk. The fallback matters more than it looks:
# every alert body is multi-line, and an earlier version stripped newlines
# rather than escaping them, which turned a readable report into one run-on
# line on any box without python3.
json_str() {
  local out
  # Judged on what it produced, not on whether it exists. A python3 that is
  # present but broken would otherwise return nothing, and nothing makes the
  # JSON malformed — so the alert fails to send while everything here looks
  # like it worked, which is the failure this whole script exists to avoid.
  out=$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null)
  if [ -n "$out" ]; then
    printf '%s' "$out"
    return
  fi
  printf '%s' "$1" | awk '
    BEGIN { ORS = ""; print "\"" }
    {
      gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "")
      if (NR > 1) print "\\n"
      print
    }
    END { print "\"" }
  '
}

# --------------------------------------------------------------- the checks

check_load() {
  local load cores ratio
  load=$(awk '{print $1}' /proc/loadavg)
  cores=$(nproc)
  ratio=$(awk -v l="$load" -v c="$cores" 'BEGIN{printf "%.2f", l/c}')
  if awk -v r="$ratio" -v m="$LOAD_PER_CORE" 'BEGIN{exit !(r > m)}'; then
    note LOAD "${load} over ${cores} cores (${ratio}x per core, limit ${LOAD_PER_CORE}x)
      Busiest: $(ps -eo pcpu,comm --sort=-pcpu | sed -n '2,4p' | tr '\n' ';')"
    return 1
  fi
}

check_memory() {
  local total avail pct rc=0
  total=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
  avail=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
  pct=$(( avail * 100 / total ))
  if [ "$pct" -lt "$MEM_AVAIL_MIN_PCT" ]; then
    note MEMORY "only ${pct}% available (${avail}kB of ${total}kB), limit ${MEM_AVAIL_MIN_PCT}%
      Largest: $(ps -eo rss,args --sort=-rss | sed -n '2,4p' | awk '{printf "%dMB %s; ", $1/1024, $2}')"
    rc=1
  fi

  local swtotal swfree swpct
  swtotal=$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)
  swfree=$(awk '/^SwapFree:/{print $2}' /proc/meminfo)
  if [ "$swtotal" -eq 0 ]; then
    note SWAP "none configured. This box has been taken down by memory
      starvation before; it needs at least 4GB."
    rc=1
  else
    swpct=$(( (swtotal - swfree) * 100 / swtotal ))
    if [ "$swpct" -gt "$SWAP_USED_MAX_PCT" ]; then
      note SWAP "${swpct}% used, limit ${SWAP_USED_MAX_PCT}%. Something is
      squeezing RAM; swap filling is the warning before the squeeze hurts."
      rc=1
    fi
  fi
  return $rc
}

# The check that was missing on 2026-09-13.
#
# Deliberately looks at EVERY process, not at a list of ours. The one that ate
# the box was somebody else's app, reported by its manager as 26MB, and would
# not have appeared on any list we thought to write.
check_hungry_process() {
  local total limit_kb worst rss pid cmd
  total=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
  limit_kb=$(( total * PROC_RSS_MAX_PCT / 100 ))
  worst=$(ps -eo rss,pid,args --sort=-rss --no-headers | head -1)
  rss=$(printf '%s' "$worst" | awk '{print $1}')
  pid=$(printf '%s' "$worst" | awk '{print $2}')
  cmd=$(printf '%s' "$worst" | cut -d' ' -f3- | cut -c1-120)
  if [ "${rss:-0}" -gt "$limit_kb" ]; then
    note PROCESS "pid ${pid} is holding $(( rss / 1024 ))MB, $(( rss * 100 / total ))% of RAM (limit ${PROC_RSS_MAX_PCT}%)
      ${cmd}
      cwd: $(readlink -f "/proc/${pid}/cwd" 2>/dev/null || echo '?')
      up:  $(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')
      NOTE: a process manager may report this as small if it manages a
      wrapper rather than the server itself. Trust this number."
    return 1
  fi
}

check_disk() {
  local rc=0
  while read -r pct mount; do
    [ "${pct%\%}" -gt "$DISK_MAX_PCT" ] && {
      note DISK "${mount} is ${pct} full (limit ${DISK_MAX_PCT}%)"
      rc=1
    }
  done < <(df -P -x tmpfs -x devtmpfs --output=pcent,target 2>/dev/null | tail -n +2)
  return $rc
}

# The 2026-08-25 killer. A 522 means Cloudflare could not finish a handshake;
# exhausted tcp_mem is what stops the kernel allocating socket buffers.
check_tcp_mem() {
  local used ceiling pct
  used=$(awk '/^TCP:/{print $NF}' /proc/net/sockstat 2>/dev/null)
  ceiling=$(sysctl -n net.ipv4.tcp_mem 2>/dev/null | awk '{print $3}')
  [ -z "${used:-}" ] || [ -z "${ceiling:-}" ] && return 0
  pct=$(( used * 100 / ceiling ))
  if [ "$pct" -gt "$TCP_MEM_MAX_PCT" ]; then
    note TCPMEM "${used} of ${ceiling} pages (${pct}%, limit ${TCP_MEM_MAX_PCT}%)
      This is what caused the day of 522s. Check for a connection flood:
        ss -tan state established | awk '{print \$5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head"
    return 1
  fi
  if dmesg -T 2>/dev/null | tail -200 | grep -q 'TCP: out of memory'; then
    note TCPMEM "kernel logged 'TCP: out of memory'. Sockets are being
      dropped right now."
    return 1
  fi
}

check_pm2() {
  [ "$CHECK_PM2" = "1" ] || return 0
  command -v pm2 >/dev/null 2>&1 || return 0
  local bad
  bad=$(pm2 jlist 2>/dev/null \
    | python3 -c '
import json,sys
try: apps = json.load(sys.stdin)
except Exception: sys.exit(0)
for a in apps:
    st = a.get("pm2_env", {}).get("status")
    if st != "online":
        print(f"{a.get(\"name\")} is {st}")
' 2>/dev/null)
  if [ -n "$bad" ]; then
    note PM2 "$(printf '%s' "$bad" | tr '\n' ';')"
    return 1
  fi
}

check_urls() {
  local rc=0 url code
  for url in $CHECK_URLS; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" 2>/dev/null)
    if [ "$code" != "200" ]; then
      note URL "${url} returned ${code:-no response}"
      rc=1
    fi
  done
  return $rc
}

check_database() {
  [ "$PG_CHECK" = "1" ] || return 0
  command -v pg_isready >/dev/null 2>&1 || return 0
  if ! pg_isready -q -t 5 2>/dev/null; then
    note POSTGRES "not accepting connections"
    return 1
  fi
}

# The superadmin dashboard has been reporting this as critical. A backup you
# are not taking is discovered at the worst possible moment.
check_backups() {
  [ -d "$BACKUP_DIR" ] || return 0
  local newest age_h
  newest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump.enc' -printf '%T@\n' 2>/dev/null | sort -rn | head -1)
  if [ -z "${newest:-}" ]; then
    note BACKUP "no backup files in ${BACKUP_DIR} at all"
    return 1
  fi
  age_h=$(awk -v t="$newest" 'BEGIN{printf "%d", (systime()-t)/3600}')
  if [ "$age_h" -gt "$BACKUP_MAX_AGE_H" ]; then
    note BACKUP "newest is ${age_h}h old (limit ${BACKUP_MAX_AGE_H}h)"
    return 1
  fi
}

# The copy that survives losing this box — and the one nothing was watching.
#
# scripts/backup.sh sends each dump off-site with `rclone copy` and treats
# failure as non-fatal: it prints "(non-fatal)" and still exits 0. So an
# expired token or a full remote stops the off-site copy while the local dump
# keeps being written — check_backups stays quiet, cron stays quiet, and the
# backup you would actually reach for after losing the server stopped arriving
# weeks ago. Same shape as every incident above: the thing that broke was not
# on the list.
#
# Headroom is checked too, because nothing prunes the remote. It only grows,
# and the day it fills is the day the silent failure starts.
check_offsite_backup() {
  [ -n "$OFFSITE_REMOTE" ] || return 0
  command -v rclone >/dev/null 2>&1 || return 0

  # One bad run is not an outage. Both failure branches below are gated behind
  # OFFSITE_FAIL_STREAK consecutive bad runs, and the counter resets the moment
  # a listing comes back clean — so a real outage still speaks within minutes
  # while a blip never does.
  local listing rc why streak streak_file
  streak_file=$(stamp_path offsite.fails)

  listing=$(timeout "$OFFSITE_TIMEOUT_S" rclone lsf --files-only --max-age "${OFFSITE_MAX_AGE_H}h" \
              --retries "$OFFSITE_RETRIES" --timeout 30s "$OFFSITE_REMOTE" 2>&1)
  rc=$?

  if [ "$rc" -ne 0 ] || [ -z "$listing" ]; then
    streak=$(( $(cat "$streak_file" 2>/dev/null || echo 0) + 1 ))
    printf '%s' "$streak" > "$streak_file"
    if [ "$streak" -lt "$OFFSITE_FAIL_STREAK" ]; then
      logger -t server-watchdog \
        "off-site check failed (${streak}/${OFFSITE_FAIL_STREAK}) - quiet until it repeats" 2>/dev/null
      return 0
    fi

    if [ "$rc" -ne 0 ]; then
      why="rclone exit ${rc}"
      [ "$rc" -eq 124 ] && why="timed out after ${OFFSITE_TIMEOUT_S}s"
      note OFFSITE "cannot list ${OFFSITE_REMOTE} (${why}), ${streak} runs in a row
      $(printf '%s' "$listing" | grep -v '^[[:space:]]*$' | tail -2 | tr '\n' ';')
      The local dump is unaffected. It is the off-site copy that has stopped,
      which is the one that matters if this box is gone.
      Check the remote: rclone about ${OFFSITE_REMOTE%%:*}:"
    else
      note OFFSITE "nothing newer than ${OFFSITE_MAX_AGE_H}h in ${OFFSITE_REMOTE}, ${streak} runs in a row
      Newest there: $(timeout "$OFFSITE_TIMEOUT_S" rclone lsf --files-only "$OFFSITE_REMOTE" 2>/dev/null | sort | tail -1 | tr -d '\n')
      The remote is reachable, so uploads are failing or have stopped. Look
      for 'rclone copy failed' in /var/log/flockinsight-backup.log"
    fi
    return 1
  fi

  printf '0' > "$streak_file"

  # Quota. Not every backend reports one; no numbers is not a problem. This one
  # speaks on the first run: it is a steady measurement, not a network call, so
  # the streak above has nothing to protect it from.
  local about total free pct
  about=$(timeout 30 rclone about --json "${OFFSITE_REMOTE%%:*}:" 2>/dev/null)
  total=$(printf '%s' "$about" | grep -o '"total":[0-9]*' | cut -d: -f2)
  free=$(printf '%s' "$about" | grep -o '"free":[0-9]*' | cut -d: -f2)
  [ -n "${total:-}" ] && [ -n "${free:-}" ] && [ "$total" -gt 0 ] || return 0
  pct=$(( free * 100 / total ))
  if [ "$pct" -lt "$OFFSITE_MIN_FREE_PCT" ]; then
    note OFFSITE "${OFFSITE_REMOTE%%:*}: is ${pct}% free ($(( free / 1048576 ))MB of $(( total / 1048576 ))MB), limit ${OFFSITE_MIN_FREE_PCT}%
      Nothing prunes the remote, so this only grows. When it fills, the copy
      step fails non-fatally and the off-site backup stops without a word."
    return 1
  fi
}

check_cert() {
  local url host end days
  for url in $CHECK_URLS; do
    case "$url" in https://*) ;; *) continue ;; esac
    host=$(printf '%s' "$url" | sed -E 's#https://([^/]+).*#\1#')
    end=$(echo | timeout 15 openssl s_client -connect "${host}:443" -servername "$host" 2>/dev/null \
          | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    [ -z "${end:-}" ] && continue
    days=$(( ( $(date -d "$end" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))
    if [ "$days" -lt "$CERT_MIN_DAYS" ] && [ "$days" -gt -3650 ]; then
      note CERTIFICATE "${host} expires in ${days} days"
      return 1
    fi
  done
}

# ------------------------------------------------------------------- run it

if [ "${1:-}" = "--test" ]; then
  if send_email "[watchdog] test from $(hostname)" \
    "If you are reading this, alerting works.

Sent $(date -Is) from $(hostname).
Checks configured: load, memory, swap, per-process memory, disk, TCP memory,
PM2, URLs, Postgres, backups (local and off-site), certificates."
  then
    echo "Accepted by ZeptoMail for ${ALERT_TO:-<unset>}. Now confirm it ARRIVES"
    echo "— acceptance is not delivery, and a bounce is the failure this script"
    echo "exists to avoid."
    exit 0
  fi
  echo "FAILED to send. The alert path is down, so the watchdog cannot tell you" >&2
  echo "anything: journalctl -t server-watchdog -n 5" >&2
  exit 1
fi

check_load
check_memory
check_hungry_process
check_disk
check_tcp_mem
check_pm2
check_urls
check_database
check_backups
check_offsite_backup
check_cert

[ -z "$FINDINGS" ] && exit 0

# One alert per distinct set of problems per hour. Keyed on which checks are
# firing, so a new problem appearing is never swallowed by an old one's
# cooldown. A send that fails clears the stamp, so the next run — five
# minutes — tries again instead of sitting out the hour.
KEY=$(printf '%s' "$FIRING" | sort -u | tr '\n' '-')
if should_alert "$KEY"; then
  send_email "[watchdog] $(hostname): $(printf '%s' "$KEY" | tr '-' ' ' | sed 's/ *$//')" \
"$(hostname) at $(date -Is)

${FINDINGS}
--
load    $(cat /proc/loadavg)
memory  $(free -h | awk '/^Mem:/{print "used "$3" of "$2", "$7" available"}')
swap    $(free -h | awk '/^Swap:/{print "used "$3" of "$2}')
top     $(ps -eo rss,args --sort=-rss --no-headers | head -3 | awk '{printf "%dMB %s | ", $1/1024, $2}')

Runbook: /root/SERVER-RUNBOOK.md" \
    || printf '0' > "$(stamp_path "$KEY")"
fi

exit 0
