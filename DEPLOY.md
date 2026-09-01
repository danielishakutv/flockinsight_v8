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

**Push to `production`.** That is the whole thing — see
[Zero-downtime deploys](#zero-downtime-deploys) below.

To deploy by hand from the box (same script, same safety):
```bash
bash ~/apps/flockinsight/releases/<newest>/deploy/deploy.sh
```

> **Do not** run the old `git pull && pnpm build && pm2 restart` sequence any
> more. `pnpm build` rewrites `.next` underneath the running server, and
> `next start` reads route chunks off disk on demand — so for the whole length
> of the build the live site 500s on any route that is not already in memory.
> That, not the restart, is why deploying used to take the site down.

---

## Zero-downtime deploys

Pushing to `production` runs
[`.github/workflows/deploy-production.yml`](.github/workflows/deploy-production.yml),
which SSHes in and runs [`deploy/deploy.sh`](deploy/deploy.sh). Nothing the
public touches changes until a fully built release has proved it works.

```
~/apps/flockinsight/
├── shared/            .env and ecosystem.config.cjs — outlive every release
├── releases/
│   ├── 20260901-143000-d4a6718/   ← built here while the old one serves
│   └── .trash/                    ← superseded releases, never auto-deleted
├── current -> releases/20260901-143000-d4a6718
└── repo.git           mirror, so a deploy fetches instead of re-cloning
```

Each deploy: fetch → unpack a new release directory → `pnpm install` →
`pnpm db:migrate` → `pnpm build` → **boot it on port 3987 and check
`/api/health`** → swap the `current` symlink in one atomic `mv` → `pm2 reload`
→ verify on the live port → roll back if it does not answer.

Two workers in **cluster mode** are what make the reload seamless: PM2 waits
for a replacement worker to be listening before retiring the old one, so there
is never a moment with nothing on the port. In fork mode `reload` is only a
restart, and Apache answers 502 while Next boots.

### One-time server migration

Run once, on the VPS. It renames your current install aside (nothing is
deleted) and builds the first release without touching PM2:

```bash
cd ~/apps/flockinsight
bash deploy/setup-releases.sh
```

Look over what it staged, then cut over — this is the only outage, a single
Next.js boot:

```bash
CONFIRM_CUTOVER=yes bash ~/apps/flockinsight/releases/<newest>/deploy/setup-releases.sh
```

Your previous install stays at `~/apps/flockinsight.pre-releases.<date>` until
you remove it yourself.

### GitHub secrets

Repository → Settings → Secrets and variables → Actions:

| Secret | What it is |
| --- | --- |
| `SSH_HOST` | the VPS IP or hostname |
| `SSH_USER` | the Linux user that owns `~/apps/flockinsight` — **not** root |
| `SSH_KEY` | private half of a key made only for deploys (`ssh-keygen -t ed25519 -C flockinsight-deploy`); put the public half in that user's `~/.ssh/authorized_keys` |
| `SSH_PORT` | optional, defaults to `22` |
| `APP_ROOT` | e.g. `/home/LINUXUSER/apps/flockinsight` |
| `PUBLIC_URL` | e.g. `https://flockinsight.yourdomain.com` — checked from outside after the deploy |
| `SSH_KNOWN_HOSTS` | optional but worth setting: `ssh-keyscan -H your.vps.ip`. Without it the runner trusts whatever key answers. |

GitHub's runners have rotating IPs, so port 22 has to be reachable from the
internet. Keep fail2ban's escalating bans on, and give the deploy key
`command=`/`from=` restrictions in `authorized_keys` if you want it tighter.

### Turning it on

Do this last, after the migration and the secrets — a push to `production`
deploys immediately, and the workflow only exists on branches that contain it:

```bash
git checkout -b production main && git push -u origin production
```

From then on, `git push origin main:production` releases whatever `main` has.

### The two things that still need care

**Migrations must be additive.** They run before the swap, and during the
rolling reload the old and new workers both talk to the new schema. Adding
columns, tables and indexes is safe. A rename, a drop, or a `NOT NULL` without
a default breaks the workers still serving the old build — and breaks rollback.
Add the new shape, deploy, backfill, and only remove the old shape a release
later.

**Two workers means two in-memory caches.** `revalidateTag("float")` in the
platform-health cron only clears the worker that handled it; the other keeps
its copy until the TTL lapses. Today that is four `unstable_cache` calls, all
superadmin-only with 60-300s TTLs, so the worst case is a slightly stale
number on `/superadmin`. If church-facing data ever gets cached this way, it
needs a shared cache handler first.

## Troubleshooting
- **502 / "bad gateway"** → app not running or wrong PORT. `pm2 logs flockinsight`.
- **Login refreshes / fails** → `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must be the
  exact `https://` domain. They are baked in at build time, so edit
  `shared/.env` and deploy again — restarting alone will not pick them up.
- **DB connect error** → check `DATABASE_URL` and that the role/db exist.
- **Build runs out of memory** → the deploy already passes
  `--max-old-space-size=1024`; raise it with `NODE_OPTIONS` in `shared/.env`.
- **"Failed to find Server Action"** → `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is
  missing from `shared/.env`, or differs from the one the release was built
  with. Next generates a throwaway key per build without it.
- **A deploy failed but the site is fine** → that is the design: the release is
  smoke-tested on port 3987 and the symlink only moves if it answers. Read the
  Action log, then `tail` the `smoke.log` in the failed release directory.
- **A deploy rolled back** → the new build booted in isolation but did not
  answer on the live port. `pm2 logs flockinsight`, and check nothing else has
  taken port 3001.
- **PM2 still serving the old release after a deploy** → it has pinned a
  resolved path instead of the `current` symlink. Fix with a short restart:
  `pm2 delete flockinsight && pm2 start ~/apps/flockinsight/shared/ecosystem.config.cjs && pm2 save`.
