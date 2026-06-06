#!/usr/bin/env bash
# FlockInsight — restore an encrypted PostgreSQL backup.
# Usage:
#   ./restore-db.sh latest               # restore the newest local backup
#   ./restore-db.sh /path/to/file.dump.enc
#   ./restore-db.sh latest --yes         # skip confirmation
#
# SAFETY: takes a pre-restore safety dump of the CURRENT database first.
set -euo pipefail

DB_NAME="${DB_NAME:-flockinsight}"
DB_USER="${DB_USER:-flockinsight}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/flockinsight}"
KEY_FILE="${KEY_FILE:-$HOME/.flockinsight-backup.key}"
DB_CONTAINER="${DB_CONTAINER:-}"   # set to e.g. "flockinsight-db" if Postgres is in Docker

target="${1:-latest}"
assume_yes=false
[[ "${2:-}" == "--yes" ]] && assume_yes=true

if [[ "$target" == "latest" ]]; then
  target="$(ls -1t "$BACKUP_DIR"/flockinsight_*.dump.enc 2>/dev/null | head -1 || true)"
fi
[[ -z "$target" || ! -f "$target" ]] && { echo "ERROR: backup file not found: $target" >&2; exit 1; }
[[ -f "$KEY_FILE" ]] || { echo "ERROR: key not found at $KEY_FILE" >&2; exit 1; }

echo "About to RESTORE '$DB_NAME' from:"
echo "  $target"
echo "This OVERWRITES current data in '$DB_NAME'."
if [[ "$assume_yes" != true ]]; then
  read -r -p "Type 'RESTORE' to continue: " confirm
  [[ "$confirm" == "RESTORE" ]] || { echo "Aborted."; exit 1; }
fi

# 1) safety dump of current state
safety="$BACKUP_DIR/pre-restore_$(date +%Y%m%d_%H%M%S).dump"
echo "[$(date)] Safety dump → $safety"
if [[ -n "$DB_CONTAINER" ]]; then
  docker exec "$DB_CONTAINER" pg_dump -Fc -U "$DB_USER" "$DB_NAME" > "$safety" || \
    echo "WARN: safety dump failed (continuing)" >&2
else
  pg_dump -Fc -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" > "$safety" || \
    echo "WARN: safety dump failed (continuing)" >&2
fi

# 2) decrypt + restore (clean existing objects first)
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
echo "[$(date)] Decrypting …"
openssl enc -d -aes-256-cbc -pbkdf2 -in "$target" -out "$tmp" -pass "file:$KEY_FILE"

echo "[$(date)] Restoring …"
if [[ -n "$DB_CONTAINER" ]]; then
  docker exec -i "$DB_CONTAINER" pg_restore --clean --if-exists --no-owner -U "$DB_USER" -d "$DB_NAME" < "$tmp"
else
  pg_restore --clean --if-exists --no-owner -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$tmp"
fi

echo "[$(date)] Restore complete. (Safety dump kept at $safety)"
