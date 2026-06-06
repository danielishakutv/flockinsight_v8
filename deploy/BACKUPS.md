# FlockInsight — Backups & Restore

One PostgreSQL database holds **all churches**, so backing it up backs up
everyone. Strategy: encrypted `pg_dump` every 6 hours, short local retention,
long-term retention off-site.

> **Docker setup (flockinsight.com server):** Postgres runs in the
> `flockinsight-db` container and the host has no `pg_dump`. Set
> `DB_CONTAINER=flockinsight-db` and the scripts run `pg_dump`/`pg_restore`
> via `docker exec` — no host Postgres client or `~/.pgpass` needed.

## One-time setup (on the VPS)

```bash
# 1) backup dir
sudo mkdir -p /var/backups/flockinsight && sudo chown "$USER" /var/backups/flockinsight

# 2) encryption key — KEEP A COPY OFF THE SERVER (without it, backups are useless)
openssl rand -base64 48 > ~/.flockinsight-backup.key && chmod 600 ~/.flockinsight-backup.key

# 3) DB password for non-interactive dumps (avoid putting it in cron):
echo "localhost:5432:flockinsight:flockinsight:YOUR_DB_PASSWORD" >> ~/.pgpass
chmod 600 ~/.pgpass

# 4) make scripts executable
chmod +x ~/apps/flockinsight/deploy/backup-db.sh ~/apps/flockinsight/deploy/restore-db.sh

# 5) test a backup
~/apps/flockinsight/deploy/backup-db.sh
ls -lh /var/backups/flockinsight
```

## Schedule (every 6 hours) — cron
```bash
crontab -e
# add (Docker DB — note DB_CONTAINER):
0 */6 * * * DB_CONTAINER=flockinsight-db /home/flockinsight/app/deploy/backup-db.sh >> /var/log/flockinsight-backup.log 2>&1
```

## Off-site (strongly recommended — survives VPS loss)
Install rclone, configure a remote (Backblaze B2, Contabo Object Storage, or
another server), then set `RCLONE_REMOTE`:
```bash
sudo apt install rclone        # or: curl https://rclone.org/install.sh | sudo bash
rclone config                  # create a remote, e.g. named "b2"
# then run backups with the remote set (add to the cron line's environment):
RCLONE_REMOTE="b2:flockinsight-backups" ~/apps/flockinsight/deploy/backup-db.sh
```
Set a lifecycle/retention policy on the bucket for long-term (weekly/monthly) copies.
Also store the **encryption key** and **.env** somewhere safe off-server.

## Restore
```bash
# newest backup:
~/apps/flockinsight/deploy/restore-db.sh latest
# a specific file:
~/apps/flockinsight/deploy/restore-db.sh /var/backups/flockinsight/flockinsight_YYYYMMDD_HHMMSS.dump.enc
```
It takes a **safety dump** of the current DB first, then restores. After a restore,
`pm2 restart flockinsight`.

## Test your restores (do this monthly)
Restore into a scratch DB to verify backups are good without touching production:
```bash
sudo -u postgres psql -c "CREATE DATABASE flockinsight_restore_test OWNER flockinsight;"
KEY_FILE=~/.flockinsight-backup.key \
  openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$(ls -1t /var/backups/flockinsight/*.dump.enc | head -1)" \
  -pass file:~/.flockinsight-backup.key | \
  pg_restore --no-owner -d flockinsight_restore_test
sudo -u postgres psql -d flockinsight_restore_test -c "SELECT count(*) FROM church;"
sudo -u postgres psql -c "DROP DATABASE flockinsight_restore_test;"
```

## Notes
- **Tiered retention:** local keeps `RETENTION_DAYS` (default 14); off-site keeps long-term.
- **Per-church export / point-in-time recovery (WAL)** can be added later if needed.
- Encrypted with AES-256 (openssl, pbkdf2). Guard the key file.
