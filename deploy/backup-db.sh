#!/usr/bin/env bash
# FlockInsight — encrypted PostgreSQL backup with rotation + optional off-site.
# Run on the VPS (cron, e.g. every 6 hours). Backs up ALL churches (one DB).
#
# Setup (once):
#   sudo mkdir -p /var/backups/flockinsight && sudo chown "$USER" /var/backups/flockinsight
#   openssl rand -base64 48 > ~/.flockinsight-backup.key && chmod 600 ~/.flockinsight-backup.key
#   # keep a copy of that key somewhere safe & off-server — without it, backups can't be restored.
#
# Optional off-site (recommended): configure an rclone remote and set RCLONE_REMOTE below.
set -euo pipefail

# ───── config (override via env) ─────
DB_NAME="${DB_NAME:-flockinsight}"
DB_USER="${DB_USER:-flockinsight}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/flockinsight}"
KEY_FILE="${KEY_FILE:-$HOME/.flockinsight-backup.key}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"        # local retention; off-site keeps long-term
RCLONE_REMOTE="${RCLONE_REMOTE:-}"            # e.g. "b2:flockinsight-backups" or "contabo:bucket/path"
# PGPASSWORD should be exported by the caller/cron, or use a ~/.pgpass file.

ts="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/flockinsight_${ts}.dump.enc"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if [[ ! -f "$KEY_FILE" ]]; then
  echo "ERROR: encryption key not found at $KEY_FILE" >&2
  exit 1
fi

echo "[$(date)] Dumping $DB_NAME …"
# Custom format (-Fc) = compressed + supports selective/parallel restore.
pg_dump -Fc -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" > "$tmp"

echo "[$(date)] Encrypting → $out"
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$tmp" -out "$out" -pass "file:$KEY_FILE"
chmod 600 "$out"
size="$(du -h "$out" | cut -f1)"
echo "[$(date)] Backup OK ($size)"

# ───── local rotation ─────
find "$BACKUP_DIR" -name 'flockinsight_*.dump.enc' -type f -mtime "+$RETENTION_DAYS" -print -delete \
  | sed 's/^/[rotate] removed /' || true

# ───── off-site copy (optional but recommended) ─────
if [[ -n "$RCLONE_REMOTE" ]] && command -v rclone >/dev/null 2>&1; then
  echo "[$(date)] Off-site sync → $RCLONE_REMOTE"
  rclone copy "$out" "$RCLONE_REMOTE" --no-traverse
else
  [[ -n "$RCLONE_REMOTE" ]] && echo "WARN: rclone not installed; skipped off-site" >&2
fi

echo "[$(date)] Done."
