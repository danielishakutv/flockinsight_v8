# Deploying FlockInsight (Contabo VPS · Virtualmin · Node + PostgreSQL + Apache proxy)

FlockInsight is a Next.js (Node) app on PostgreSQL. Apache reverse-proxies your
domain to the Node process (managed by PM2). Your existing PHP/MySQL sites are
untouched.

Replace placeholders: `flockinsight.yourdomain.com`, `LINUXUSER`, the DB
password, and `PORT` (3001 by default — pick one not used by your other apps).

---

## 1. DNS
Point an **A record** for `flockinsight.yourdomain.com` → your VPS IP.
(If the domain is already a Virtualmin virtual server, it's done.)

## 2. PostgreSQL: create role + database
```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE flockinsight WITH LOGIN PASSWORD 'CHANGE_DB_PASSWORD';
CREATE DATABASE flockinsight OWNER flockinsight;
GRANT ALL PRIVILEGES ON DATABASE flockinsight TO flockinsight;
SQL
```

## 3. Get the code
```bash
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/danielishakutv/flockinsight_v8.git flockinsight
cd flockinsight
```

## 4. Environment
```bash
cp .env.production.example .env
# generate a secret:
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
nano .env     # fill DATABASE_URL password, BETTER_AUTH_SECRET, the two URLs, PORT
```

## 5. Install, migrate, build
```bash
pnpm install --prod=false
pnpm db:migrate          # creates the tables (do NOT run db:seed in prod)
pnpm build
```

## 6. Run with PM2
```bash
# edit cwd + PORT in ecosystem.config.cjs to match (path = $(pwd), e.g. /home/LINUXUSER/apps/flockinsight)
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # run the line it prints (once) so it survives reboots
# quick check:
curl -I http://127.0.0.1:3001
```

## 7. Apache reverse proxy (Virtualmin)
1. Enable modules once: `sudo a2enmod proxy proxy_http headers && sudo systemctl reload apache2`
2. In **Virtualmin → select the domain → Services → Configure Website → Edit Directives**,
   add the contents of [`deploy/apache-reverse-proxy.conf`](deploy/apache-reverse-proxy.conf)
   to **both** the `:80` and `:443` VirtualHost blocks (set the right PORT).
3. Save & apply. Virtualmin will reload Apache.

## 8. SSL (Let's Encrypt)
Virtualmin → the domain → **Server Configuration → SSL Certificate → Let's Encrypt → Request**.
After it's issued, `https://flockinsight.yourdomain.com` should load the app.

## 9. First run
Visit `https://flockinsight.yourdomain.com/signup` and create your church account.
(That becomes the owner; no seed/demo data is loaded in production.)

## 10. Make yourself platform superadmin
After signing up, grant your account the platform admin role (for `/superadmin`):
```bash
sudo -u postgres psql -d flockinsight \
  -c "UPDATE \"user\" SET is_super_admin = true WHERE email = 'you@yourdomain.com';"
```
Then visit `https://flockinsight.yourdomain.com/superadmin`.

## 11. Backups (do this before inviting churches)
Follow [`deploy/BACKUPS.md`](deploy/BACKUPS.md): create the key, add the cron job
(every 6h), and configure an off-site remote.

## 12. Email (password reset + verification)
Set `SMTP_*` in `.env` (your Virtualmin Postfix or a provider), then
`pnpm build && pm2 restart flockinsight`. Set `REQUIRE_EMAIL_VERIFICATION=true`
once email delivery is confirmed working.

---

## Updating later (deploy a new version)
```bash
cd ~/apps/flockinsight
git pull
pnpm install --prod=false
pnpm db:migrate        # apply any new migrations
pnpm build
pm2 restart flockinsight
```

## Troubleshooting
- **502 / "bad gateway"** → app not running or wrong PORT. `pm2 logs flockinsight`.
- **Login refreshes / fails** → `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must be the
  exact `https://` domain; rebuild after changing (`pnpm build && pm2 restart flockinsight`).
- **DB connect error** → check `DATABASE_URL` and that the role/db exist.
- **Build runs out of memory** → `NODE_OPTIONS=--max-old-space-size=1024 pnpm build`.
