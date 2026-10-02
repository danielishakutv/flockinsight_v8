#!/usr/bin/env bash
# FlockInsight — back up the media files that are NOT in the database.
#
# Video and audio live on this server's own disk (Cloudinary will not store a
# single asset over 100 MB, and an hour of a service is several times that).
# `backup-db.sh` dumps Postgres, which holds the media ROWS — the titles, sizes,
# durations and which meeting each belongs to — but not one byte of the files
# themselves.
#
# So without this, a restored backup gives a church a complete, tidy media
# library in which every recording is a broken link. That is the worst shape a
# backup can take, because it looks like it worked.
#
# Incremental: rsync with --link-dest hard-links anything unchanged since the
# previous run, so ten daily snapshots of 40 GB of recordings cost about 40 GB,
# not 400. Recordings are write-once, so almost nothing is ever copied twice.
#
# Setup (once):
#   sudo mkdir -p /var/backups/flockinsight-media
#   sudo chmod 700 /var/backups/flockinsight-media
#
# Schedule (daily, after the database dump):
#   crontab -e
#   30 3 * * * /home/flockinsight/app/current/deploy/backup-media.sh >> /var/log/flockinsight-media-backup.log 2>&1
#
# Restore: copy a snapshot back over MEDIA_ROOT. The directory layout IS the
# storage key, so nothing needs rewriting:
#   rsync -a /var/backups/flockinsight-media/2026-10-02/ /home/flockinsight/app/shared/media/

set -Eeuo pipefail

MEDIA_ROOT="${MEDIA_ROOT:-/home/flockinsight/app/shared/media}"
BACKUP_ROOT="${MEDIA_BACKUP_ROOT:-/var/backups/flockinsight-media}"
KEEP="${MEDIA_BACKUP_KEEP:-10}"

log() { printf '%s  %s\n' "$(date '+%F %T')" "$*"; }
die() { log "FAILED: $*"; exit 1; }

[ -d "$MEDIA_ROOT" ] || die "MEDIA_ROOT does not exist: $MEDIA_ROOT"
command -v rsync >/dev/null || die "rsync is not installed"

mkdir -p "$BACKUP_ROOT"

# Seconds included: two runs in the same minute would otherwise share a
# directory, and the second would rsync INTO the first with --link-dest pointing
# at itself — quietly merging two snapshots into one. Caught in testing.
stamp="$(date +%F-%H%M%S)"
dest="$BACKUP_ROOT/$stamp"
[ -e "$dest" ] && die "a snapshot named $stamp already exists — refusing to write into it"
# The most recent previous snapshot, for hard-linking.
previous="$(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d | sort | tail -1)"

link_arg=()
if [ -n "$previous" ] && [ -d "$previous" ]; then
  link_arg=(--link-dest="$previous")
  log "incremental against $(basename "$previous")"
else
  log "first snapshot — this one copies everything"
fi

log "backing up $MEDIA_ROOT -> $dest"

#
# NO --delete, anywhere, ever.
#
# This writes into a fresh timestamped directory each run, so there is nothing
# to prune and nothing that could reach back into a previous snapshot or into
# the live media. Partial uploads under .tmp are skipped because they are not
# files yet; everything else is taken exactly as it is.
#
rsync -a --exclude='.tmp/' "${link_arg[@]}" "$MEDIA_ROOT/" "$dest.incomplete/" \
  || die "rsync failed — leaving $dest.incomplete in place for inspection"

# Renamed only on success, so a half-finished snapshot is never mistaken for a
# good one by the next run's --link-dest or by a person restoring in a hurry.
mv "$dest.incomplete" "$dest"

bytes="$(du -sb "$dest" 2>/dev/null | cut -f1 || echo 0)"
files="$(find "$dest" -type f | wc -l)"
log "snapshot complete: $files files, $(numfmt --to=iec "$bytes" 2>/dev/null || echo "$bytes bytes")"

#
# Rotation. Old snapshots are MOVED to a .trash directory rather than deleted,
# and the trash is left for a human. Disk is cheap; a backup you deleted on the
# day you needed it is not.
#
count="$(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d ! -name '.trash' ! -name '*.incomplete' | wc -l)"
if [ "$count" -gt "$KEEP" ]; then
  mkdir -p "$BACKUP_ROOT/.trash"
  find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d ! -name '.trash' ! -name '*.incomplete' \
    | sort | head -n "$(( count - KEEP ))" \
    | while read -r old; do
        log "rotating out $(basename "$old") -> .trash (not deleted)"
        mv "$old" "$BACKUP_ROOT/.trash/"
      done
  log "NOTE: $BACKUP_ROOT/.trash holds rotated snapshots. Empty it yourself when you are sure."
fi

# A plain, greppable line for the watchdog to look for.
log "MEDIA_BACKUP_OK $stamp"
