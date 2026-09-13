#!/usr/bin/env bash
#
# Tests for server-watchdog.sh's helpers.
#
#   bash deploy/server-watchdog.test.sh deploy/server-watchdog.sh
#
# The checks themselves read /proc and need a Linux box, but the parts most
# likely to fail quietly do not: the rate limiter that decides whether you are
# told at all, and the JSON escaping that decides whether the mail is valid.
# Both have already been wrong once — the key folded multi-line detail into
# itself, and the fallback escaper deleted newlines instead of escaping them.
set -uo pipefail
SRC="${1:-$(dirname "$0")/server-watchdog.sh}"

# Pull out just the helper definitions (everything before "the checks").
sed -n '1,/^# ---* the checks/p' "$SRC" > /tmp/wd-helpers.sh
export WATCHDOG_CONF=/dev/null
export STATE_DIR="$(mktemp -d)"
# shellcheck disable=SC1091
. /tmp/wd-helpers.sh

fail=0
t() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: expected [$3] got [$2]"; fail=1; fi; }

echo "note() separates category from text"
note DISK "/ is 91% full
      extra detail line"
note MEMORY "only 9% available"
t "two categories firing" "$(printf '%s' "$FIRING" | tr '\n' ',')" "DISK,MEMORY,"
t "findings keep the text"  "$(printf '%s' "$FINDINGS" | grep -c 'is 91% full')" "1"

echo "rate-limit key ignores continuation lines"
KEY=$(printf '%s' "$FIRING" | sort -u | tr '\n' '-')
t "key is stable + sorted" "$KEY" "DISK-MEMORY-"

echo "should_alert rate limits per key"
should_alert "$KEY"; t "first alert passes" "$?" "0"
should_alert "$KEY"; t "immediate repeat suppressed" "$?" "1"
should_alert "DISK-"; t "a different problem is not suppressed" "$?" "0"

echo "REPEAT_AFTER=0 lets it through again"
REPEAT_AFTER=0 should_alert "$KEY"; t "expired cooldown passes" "$?" "0"

echo "json_str escapes for the API payload"
t "quotes escaped" "$(json_str 'say "hi"')" '"say \"hi\""'
t "newline escaped"  "$(json_str "$(printf 'a\nb')")" '"a\nb"'

# The alert path itself. It has no second chance: if send_email is wrong, the
# watchdog is silent exactly when it matters, and nothing else in this file
# would notice. So stub curl, keep what it was asked to send, and check the
# request really is the shape ZeptoMail accepts.
echo "env_value reads the app env without sourcing it"
STUB_MAIL="$(mktemp -d)"
PATH="$STUB_MAIL:$PATH"
ENVF="$STUB_MAIL/app.env"

printf 'OTHER=x\nZEPTOMAIL_TOKEN="Zoho-enczapikey abc123"\n' > "$ENVF"
t "quotes stripped"            "$(env_value ZEPTOMAIL_TOKEN "$ENVF")" "Zoho-enczapikey abc123"
printf 'ZEPTOMAIL_TOKEN=plain\r\n' > "$ENVF"
t "a CRLF file cannot poison the token" "$(env_value ZEPTOMAIL_TOKEN "$ENVF")" "plain"
printf 'export ZEPTOMAIL_TOKEN=exported\n' > "$ENVF"
t "export prefix handled"      "$(env_value ZEPTOMAIL_TOKEN "$ENVF")" "exported"
printf 'NOT_ZEPTOMAIL_TOKEN=wrong\nZEPTOMAIL_TOKEN=right\n' > "$ENVF"
t "a longer key is not mistaken for it" "$(env_value ZEPTOMAIL_TOKEN "$ENVF")" "right"
t "a missing file is empty, not an error" "$(env_value ZEPTOMAIL_TOKEN /nope/nope)" ""

echo "send_email speaks ZeptoMail and reads the status"
CURL_BODY_FILE="$STUB_MAIL/body"; CURL_HDR_FILE="$STUB_MAIL/hdr"
LOGGER_FILE="$STUB_MAIL/syslog"
export CURL_BODY_FILE CURL_HDR_FILE LOGGER_FILE CURL_RESP CURL_CODE
cat > "$STUB_MAIL/curl" <<'STUB'
#!/usr/bin/env bash
prev=""
for a in "$@"; do
  case "$prev" in
    -d) printf '%s' "$a" > "$CURL_BODY_FILE" ;;
    -H) printf '%s\n' "$a" >> "$CURL_HDR_FILE" ;;
  esac
  prev="$a"
done
printf '%s\n%s' "$CURL_RESP" "$CURL_CODE"
STUB
cat > "$STUB_MAIL/logger" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$LOGGER_FILE"
STUB
chmod +x "$STUB_MAIL/curl" "$STUB_MAIL/logger"

ALERT_TO="me@example.com"
ALERT_FROM="FlockInsight Watchdog <alerts@flockinsight.com>"
ZEPTOMAIL_API_URL="https://api.zeptomail.com/v1.1/email"
ZEPTOMAIL_TOKEN="testtoken"
CURL_RESP='{"request_id":"abc"}'; CURL_CODE=201
: > "$CURL_HDR_FILE"; : > "$LOGGER_FILE"

send_email "subject here" "line one
line two"; rc=$?
t "a 2xx is success"        "$rc" "0"
t "address split from name" "$(grep -c '"address":"alerts@flockinsight.com"' "$CURL_BODY_FILE")" "1"
t "display name kept"       "$(grep -c '"name":"FlockInsight Watchdog"' "$CURL_BODY_FILE")" "1"
t "recipient nested as zepto wants" \
  "$(grep -c '"to":\[{"email_address":{"address":"me@example.com"}}\]' "$CURL_BODY_FILE")" "1"
t "newlines escaped, not stripped" "$(grep -cF 'line one\nline two' "$CURL_BODY_FILE")" "1"
t "html body carries the breaks too" "$(grep -c '<pre>' "$CURL_BODY_FILE")" "1"
t "auth scheme added once"  "$(grep -c '^Authorization: Zoho-enczapikey testtoken$' "$CURL_HDR_FILE")" "1"

: > "$CURL_HDR_FILE"
ZEPTOMAIL_TOKEN="Zoho-enczapikey pasted-from-console"
send_email "s" "b"
t "a token that carries its own prefix is not doubled" \
  "$(grep -c '^Authorization: Zoho-enczapikey pasted-from-console$' "$CURL_HDR_FILE")" "1"

CURL_CODE=401; CURL_RESP='{"error":{"code":"TM_3201"}}'
send_email "s" "b"; rc=$?
t "a 401 is a failure, not a success" "$rc" "1"
t "and it is logged where it will be seen" \
  "$(grep -c 'ALERT SEND FAILED (HTTP 401)' "$LOGGER_FILE")" "1"

ZEPTOMAIL_TOKEN=""; CURL_CODE=201
send_email "s" "b"; rc=$?
t "no token is a failure, not a quiet no-op" "$rc" "1"

echo "a failed send can be re-armed"
t "stamp path derives from the key" "$(basename "$(stamp_path 'DISK-MEMORY-')")" "DISK-MEMORY-"
should_alert "RETRY-" >/dev/null
printf '0' > "$(stamp_path 'RETRY-')"
should_alert "RETRY-"; t "a cleared stamp retries at once" "$?" "0"

# The other checks need a real box, but this one's whole point is what it does
# when rclone fails — the state you cannot reproduce by hand on a server where
# backups are working. So stub rclone and walk it through all four outcomes.
echo "check_offsite_backup reacts to every rclone outcome"
sed -n '/^check_offsite_backup()/,/^}/p' "$SRC" > /tmp/wd-offsite.sh
# shellcheck disable=SC1091
. /tmp/wd-offsite.sh

STUB_DIR="$(mktemp -d)"
PATH="$STUB_DIR:$PATH"
cat > "$STUB_DIR/rclone" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  lsf)
    if [ -n "${STUB_LSF_ERR:-}" ]; then echo "$STUB_LSF_ERR" >&2; exit 3; fi
    [ -n "${STUB_LSF:-}" ] && echo "$STUB_LSF" ;;
  about)
    printf '%s' "${STUB_ABOUT:-}" ;;
esac
exit 0
STUB
chmod +x "$STUB_DIR/rclone"

OFFSITE_REMOTE="gdrive:flockinsight-backups"
OFFSITE_MAX_AGE_H=36
OFFSITE_MIN_FREE_PCT=20
STUB_LSF=""; STUB_LSF_ERR=""; STUB_ABOUT=""
export STUB_LSF STUB_LSF_ERR STUB_ABOUT

ROOMY='{"total":5368709120,"used":50139136,"free":5318569984}'
FULL='{"total":5368709120,"used":5100000000,"free":268709120}'
FRESH="flockinsight_20260913_020002.dump.enc"

offsite() { FIRING=""; FINDINGS=""; check_offsite_backup; }
fired() { printf '%s' "$FIRING" | tr -d '\n'; }

STUB_LSF_ERR="failed to get token: oauth2: token expired"; STUB_LSF=""; STUB_ABOUT="$ROOMY"
offsite
t "unreachable remote alerts"   "$(fired)" "OFFSITE"
t "  and quotes rclone's reason" "$(printf '%s' "$FINDINGS" | grep -c 'token expired')" "1"

STUB_LSF_ERR=""; STUB_LSF=""; STUB_ABOUT="$ROOMY"
offsite
t "reachable but nothing recent alerts" "$(fired)" "OFFSITE"

STUB_LSF="$FRESH"; STUB_ABOUT="$ROOMY"
offsite
t "fresh upload with room is silent" "$(fired)" ""

STUB_LSF="$FRESH"; STUB_ABOUT="$FULL"
offsite
t "fresh upload but 5% left alerts" "$(fired)" "OFFSITE"

STUB_LSF="$FRESH"; STUB_ABOUT=""
offsite
t "backend with no quota is not a problem" "$(fired)" ""

OFFSITE_REMOTE=""
offsite
t "empty remote disables the check" "$(fired)" ""

exit $fail
