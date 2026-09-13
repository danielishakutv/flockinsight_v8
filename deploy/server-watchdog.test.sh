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

exit $fail
