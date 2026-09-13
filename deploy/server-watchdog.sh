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
RESEND_API_KEY=${RESEND_API_KEY:-}
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
CERT_MIN_DAYS=${CERT_MIN_DAYS:-14}
# Space-separated. Each must answer 200.
CHECK_URLS=${CHECK_URLS:-"https://flockinsight.com/api/health"}
CHECK_PM2=${CHECK_PM2:-1}
PG_CHECK=${PG_CHECK:-1}

mkdir -p "$STATE_DIR" 2>/dev/null || true

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
should_alert() {
  local key=$1 now stamp last
  now=$(date +%s)
  stamp="$STATE_DIR/$(printf '%s' "$key" | tr -c 'a-zA-Z0-9_.-' '_')"
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt "$REPEAT_AFTER" ]; then
    return 1
  fi
  printf '%s' "$now" > "$stamp"
  return 0
}

send_email() {
  local subject=$1 body=$2
  if [ -z "$RESEND_API_KEY" ] || [ -z "$ALERT_TO" ] || [ -z "$ALERT_FROM" ]; then
    logger -t server-watchdog "ALERT (email not configured): $subject"
    return 0
  fi
  # Resend rather than the local MTA on purpose: this box signs with a DKIM
  # key that was never published, so Gmail rejects its mail outright. An alert
  # that bounces is worse than no alert, because it feels safe.
  curl -s -o /dev/null --max-time 20 \
    -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"from":%s,"to":[%s],"subject":%s,"text":%s}' \
          "$(json_str "$ALERT_FROM")" \
          "$(json_str "$ALERT_TO")" \
          "$(json_str "$subject")" \
          "$(json_str "$body")")"
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
  send_email "[watchdog] test from $(hostname)" \
    "If you are reading this, alerting works.

Sent $(date -Is) from $(hostname).
Checks configured: load, memory, swap, per-process memory, disk, TCP memory,
PM2, URLs, Postgres, backups, certificates."
  echo "Test alert sent to ${ALERT_TO:-<unset>}. Confirm it ARRIVES — a bounce"
  echo "is the failure this script exists to avoid."
  exit 0
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
check_cert

[ -z "$FINDINGS" ] && exit 0

# One alert per distinct set of problems per hour. Keyed on which checks are
# firing, so a new problem appearing is never swallowed by an old one's
# cooldown.
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

Runbook: /root/SERVER-RUNBOOK.md"
fi

exit 0
