#!/usr/bin/env bash
# FlockInsight encrypted database backup with count-based retention.
# Install on the VPS and run from cron (e.g. daily at 02:00):
#   0 2 * * * DATABASE_URL=... /home/flockinsight/app/scripts/backup.sh >> /var/log/flockinsight-backup.log 2>&1
#
# Keeps the newest $BACKUP_KEEP (default 15) backups locally and removes older
# ones. Whole-database dump → every table (incl. new billing/SMS/notification
# tables) is captured automatically.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/flockinsight}"
KEY_FILE="${BACKUP_KEY_FILE:-/root/.flockinsight-backup.key}"
KEEP="${BACKUP_KEEP:-15}"
: "${DATABASE_URL:?Set DATABASE_URL}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive:flockinsight-backups}"

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d_%H%M%S)"
out="$BACKUP_DIR/flockinsight_${ts}.dump.enc"

# Dump (custom format, no owner) and encrypt with AES-256.
pg_dump --format=custom --no-owner "$DATABASE_URL" \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "file:${KEY_FILE}" -out "$out"
echo "[backup] wrote $out ($(du -h "$out" | cut -f1))"

# Off-site copy (optional; non-fatal if rclone/remote not set up).
if command -v rclone >/dev/null 2>&1; then
  rclone copy "$out" "$RCLONE_REMOTE" && echo "[backup] copied off-site" \
    || echo "[backup] rclone copy failed (non-fatal)"
fi

# Retention: keep newest $KEEP, delete older — but ONLY files matching the
# strict backup name, inside BACKUP_DIR (never anything else).
ls -1t "$BACKUP_DIR"/flockinsight_*.dump.enc 2>/dev/null | tail -n +"$((KEEP + 1))" \
  | while read -r old; do
      base="$(basename "$old")"
      if [[ "$base" =~ ^flockinsight_[0-9]{8}_[0-9]{6}\.dump\.enc$ ]]; then
        rm -f -- "$old" && echo "[backup] pruned $base"
      fi
    done

echo "[backup] done — keeping newest $KEEP"
