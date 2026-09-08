# Server incident 2026-08-25 — site-wide Cloudflare 522

**Status: RESOLVED.** All sites verified 200 from outside. Load 188 → 0.9.

---

## What happened

A distributed **SMTP AUTH brute-force from `213.176.26.0/24`** (2,397 events in
2 hours across 15+ rotating IPs) opened TLS connections to smtps/submission,
started AUTH, then hung. Each hung connection pinned an `smtpd` process **and its
TCP buffers**. Postfix's `default_process_limit` is 100 — and exactly 100 `smtpd`
were stuck.

Those pinned buffers pushed kernel `tcp_mem` to its ceiling (283,060 pages vs a
max of 282,690). **Once `tcp_mem` is exhausted the kernel cannot allocate buffers
for new connections**, so TLS handshakes never send a ServerHello and Cloudflare
times out → **522 on every site on the box**.

FlockInsight was healthy the whole time (200 in 26ms on `127.0.0.1:3005`). So
were the other apps. They were all collateral damage.

> **The trap:** Apache looked guilty — 98 spinning threads, `mod_fcgid` kill
> failures. It was a *victim* of the same starvation. Restarting it changed
> nothing; load stayed at 145. I said Apache was the cause before I had the
> evidence, and that was wrong.

---

## ✅ Done — nothing needed from you

| Fix | Detail |
|---|---|
| Attack subnet blocked | `213.176.26.0/24` via **firewalld permanent** rich rule, verified in the nft packet path |
| `eth0` bound to `public` zone | it was in "no zone", so rules were ambiguous |
| Hung processes cleared | 100 `smtpd` → 0; Apache's 98 spinning threads → 0 |
| **4GB swap** | box had **zero** swap on 12GB RAM. In `/etc/fstab`, `vm.swappiness=10` |
| Postfix rate limits | auth 15/min, conns 40/min, 15 concurrent per IP, timeout 300→120s. **localhost + docker exempt**, so app mail is unaffected |
| fail2ban rebuilt | was `bantime=600` (attackers returned every 10 min). Now escalating bans to 4 weeks + new `[recidive]` jail. 7 jails active |
| Apache workers recycle | `MaxConnectionsPerChild` 0 → 10000 |
| Hourly `drop_caches` disabled | commented out in `/etc/cron.d/sync` — it was flushing page cache every hour and hurting performance |
| **Watchdog installed** | `/usr/local/sbin/server-watchdog.sh`, every 5 min. Emails you on tcp_mem ≥80%, load ≥40, ≥60 smtpd, missing swap, new kernel TCP-OOM, or a failing site check. Rate-limited to 1/hour/condition. **Delivery tested — working.** |
| Runbook on the box | `/root/SERVER-RUNBOOK.md` |

Every file I edited has a timestamped `.bak` next to it. Nothing was deleted.

---

## ⚠️ Needs you — mail is broken to Gmail

**Gmail rejects every message from this server.** This is separate from the
outage and has been true for a while:

```
550-5.7.26 sender is unauthenticated. DKIM = did not pass.
SPF [mail.dinki.africa] with ip: [77.237.243.210] = did not pass
```

`opendkim` is installed, active and signing — but **the public key was never
published in DNS**. `mail._domainkey.dinki.africa` returns NXDOMAIN, and
`dinki.africa` has no SPF and no DMARC record at all.

Because of this I wired the watchdog to send via the **Resend API** instead of
SMTP, so your alerts work tonight regardless.

### DNS records to add (in Cloudflare — not SSH)

**1. SPF for `dinki.africa`** — TXT record on `dinki.africa`:
```
v=spf1 a mx ip4:77.237.243.210 ~all
```

**2. DMARC** — TXT record on `_dmarc.dinki.africa`:
```
v=DMARC1; p=none; rua=mailto:postmaster@dinki.africa
```

**3. DKIM** — TXT record on `mail._domainkey.dinki.africa`:
```
v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwCZ+XIlN1a0xjwaIXo5MGYykifqoEeWwc+ghwKkoGuejllxR3sWIt7iNh8y/jZ90X5Wx1SLObtuK5FzC53tTIg/XBKPlaJsPAGQjfPePi6tbcDpNCC59HqW6k1JKCl6sS7BliFhQVgeDgPZ4+DgaH1oU2r85xBHzXZRY69FkwtO278HJVawvM5ygh+ynvnUh4R6zKqnGGiUUVJSsOVogValjt3UojY1Yns+y26BO8fw1GvAw9hodSZT6I3yRMhE6IRBvQ0K1By8WaOLKoNbW+//s336n7oTF5mymEODKUav3+bF079sHyqft3aueovpDCZQagFbPAzyCmaIna//oqQIDAQAB
```

**4. Toko Academy SPF** — `tokoacademy.org` lists `ip4:144.91.105.22` but **not**
this server, so Toko mail sent from here fails SPF. Replace its SPF TXT with:
```
v=spf1 a mx ip4:144.91.105.22 ip4:77.237.243.210 include:zeptomail.net include:zohomail.com ~all
```

### Then verify (SSH — paste this)

```bash
ssh root@77.237.243.210
dig +short TXT mail._domainkey.dinki.africa
dig +short TXT dinki.africa
echo "spf/dkim check" | mail -s "auth test" talk2ishakudaniel@gmail.com
sleep 10 && journalctl -u postfix* --since "2 min ago" | grep "status="
# want: status=sent    (NOT status=bounced)
```

---

## Other things worth your attention

**`info@tokoacademy.org` does not exist** — mail to it bounces "User unknown in
virtual alias table". Only `tokoacademy@`, `webmaster@`, `hostmaster@`,
`postmaster@`, `abuse@` are defined. If you publish `info@` anywhere, add it:
```bash
echo "info@tokoacademy.org	tokoacademy@tokoacademy.org" >> /etc/postfix/virtual
postmap /etc/postfix/virtual && systemctl reload postfix
```

**`casi360.com` and `accessmedia.ng` serve the self-signed `*.accessmedia.ng`
cert at origin** — their SSL vhosts aren't loading. This works *only* because
Cloudflare isn't on Full (strict). Worth fixing, then tightening Cloudflare.

**Socket leaks** — `next-server v14.2.35` (the `fremo` PM2 app) held 73
CLOSE-WAIT sockets and 25h of CPU over 7 days; usermin's `perl` held 41.

**`mod_fcgid`** logs 20–37 hung-CGI SIGKILLs per hour. Secondary, but it means
CGI processes routinely hang.

---

## Quick health check any time

```bash
ssh root@77.237.243.210 'echo "load: $(cut -d" " -f1-3 /proc/loadavg)"; \
P=$(awk "/^TCP:/{print \$NF}" /proc/net/sockstat); \
M=$(sysctl -n net.ipv4.tcp_mem | awk "{print \$3}"); \
echo "tcp:   $P / $M ($(( P*100/M ))%)"; \
echo "swap:  $(free -h | grep Swap:)"; \
echo "smtpd: $(pgrep -c smtpd)"; \
tail -3 /var/log/server-watchdog.log'
```
