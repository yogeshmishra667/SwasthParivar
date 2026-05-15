# Deploy: DigitalOcean Droplet (Bangalore)

> Concrete, copy-pasteable steps to go from "credit applied" to
> `https://swasthparivar.com` is live. Solo-dev runbook for Phase 1.
>
> Pairs with `apps/server/docker-compose.prod.yml`. Read this top-to-
> bottom the first time; on subsequent deploys you'll only need section
> 8 (Redeploy).

## Why this setup

One $20/mo droplet runs Postgres + TimescaleDB + Redis + the server
container, behind nginx with Let's Encrypt HTTPS. TimescaleDB rules
out most managed-Postgres providers (the schema uses hypertables for
`glucose_readings`); self-hosting on a Droplet sidesteps the
extension constraint and costs nothing for ~10 months on the
GitHub Education $200 credit.

## Costs at Phase 1

| Item                                    | Monthly                                    | Notes                                                                       |
| --------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| DO Droplet (Regular 4GB / 2 vCPU, blr1) | $20                                        | Education credit covers ~10 months. Bangalore region = ~30ms India latency. |
| DO snapshot backups (weekly)            | $0.40                                      | Optional but recommended.                                                   |
| Namecheap domain (from Education pack)  | $0                                         | One-year free; ~$10/yr thereafter.                                          |
| GHCR image hosting                      | $0                                         | Free for public images; private free for personal accounts.                 |
| Sentry free tier (5k events/mo)         | $0                                         | Enough for Phase 1.                                                         |
| PostHog free tier (1M events/mo)        | $0                                         | Generous.                                                                   |
| **Total Phase 1**                       | **~$0** (credit) → **~$20/mo** post-credit |                                                                             |

## Section 1 — Prerequisites

- [ ] GitHub Education Pack activated, DigitalOcean $200 credit applied
- [ ] Domain registered (Namecheap from the Education pack, or whatever
      you already own). Let's say `swasthparivar.com`.
- [ ] Sentry project created (Node SDK type for backend; React Native
      for mobile later). DSNs in hand.
- [ ] PostHog project created. API key in hand.
- [ ] A 32+ char `ADMIN_API_TOKEN` generated: `openssl rand -base64 48`.
- [ ] WhatsApp Business / MSG91 / Expo / R2 credentials as far as you
      need them (these are optional in dev/test; required only for the
      features that use them).

## Section 2 — Droplet provisioning

DO Control Panel → **Create Droplet**:

| Setting        | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Image          | Ubuntu 24.04 LTS x64                                   |
| Region         | **Bangalore (`blr1`)**                                 |
| Plan           | **Regular Intel, 4 GB / 2 vCPU / 80 GB SSD ($20/mo)**  |
| Authentication | **SSH keys only** (paste your `~/.ssh/id_ed25519.pub`) |
| Hostname       | `swasth-prod-1`                                        |
| Backups        | **Enable** (+$2.40/mo for weekly snapshot; worth it)   |
| VPC            | Default; firewall added separately below               |

Create. Wait ~60 seconds for IP assignment. Note the public IPv4.

## Section 3 — Initial server setup

From your laptop:

```bash
# Replace with your droplet IP and your laptop's SSH public key.
DROPLET_IP=143.110.xxx.xxx

ssh root@$DROPLET_IP <<'EOF'
  set -eu

  # 1. Create non-root user, give sudo, mirror SSH keys.
  adduser --disabled-password --gecos "" swasth
  usermod -aG sudo swasth
  mkdir -p /home/swasth/.ssh
  cp /root/.ssh/authorized_keys /home/swasth/.ssh/
  chown -R swasth:swasth /home/swasth/.ssh
  chmod 700 /home/swasth/.ssh
  chmod 600 /home/swasth/.ssh/authorized_keys

  # 2. Lock down SSH — keys only, no root login, no passwords.
  sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload sshd

  # 3. Patch + firewall.
  apt-get update && apt-get upgrade -y
  apt-get install -y ufw fail2ban unattended-upgrades
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable

  # 4. Auto-apply security updates.
  dpkg-reconfigure -plow unattended-upgrades
EOF

# From here on, use `ssh swasth@$DROPLET_IP`. Root login is closed.
```

## Section 4 — Docker install (via the official script)

```bash
ssh swasth@$DROPLET_IP <<'EOF'
  set -eu
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker swasth
  # Compose plugin ships with docker-ce on Ubuntu 24.04; verify:
  docker compose version
EOF

# Log out + back in so the docker group takes effect:
ssh swasth@$DROPLET_IP "docker run --rm hello-world"
```

## Section 5 — App directory + secrets

```bash
ssh swasth@$DROPLET_IP <<'EOF'
  set -eu
  mkdir -p ~/swasth/{data/postgres,data/redis,logs}
EOF

# Copy your prod env template up. Edit it locally first.
scp apps/server/docker-compose.prod.yml swasth@$DROPLET_IP:~/swasth/docker-compose.yml
```

Create `~/swasth/.env` on the droplet (do NOT commit this — generate
real secrets):

```bash
ssh swasth@$DROPLET_IP "cat > ~/swasth/.env" <<'EOF'
# --- runtime ---
NODE_ENV=production
PORT=4000
TRUST_PROXY=1            # behind nginx — trust 1 hop

# --- data layer (matches docker-compose.yml service names) ---
DATABASE_URL=postgresql://swasth:CHANGE_ME_STRONG_PASSWORD@postgres:5432/swasth
REDIS_URL=redis://redis:6379
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD   # used by the postgres container

# --- secrets (generate with: openssl rand -base64 48) ---
JWT_SECRET=CHANGE_ME_32_PLUS_CHARS
JWT_REFRESH_SECRET=CHANGE_ME_32_PLUS_CHARS
OTP_SECRET=CHANGE_ME_32_PLUS_CHARS
ADMIN_API_TOKEN=CHANGE_ME_32_PLUS_CHARS

# --- observability (required in prod per env.ts fail-fast) ---
SENTRY_DSN=https://your-key@oXXXXXX.ingest.sentry.io/XXXXXX
POSTHOG_API_KEY=phc_your_project_key

# --- providers (set when you wire them) ---
WHATSAPP_BUSINESS_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
MSG91_API_KEY=
MSG91_SENDER_ID=
EXPO_ACCESS_TOKEN=

# --- storage (set when prescription OCR ships, Phase 4) ---
R2_ACCOUNT_ID=
R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_BUCKET=

# --- payments (Phase 4) ---
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
EOF

ssh swasth@$DROPLET_IP "chmod 600 ~/swasth/.env"
```

`chmod 600` is critical — only `swasth` can read it. Anything looser
and `docker exec` from another container would be a leak path.

## Section 6 — GHCR auth (pull the server image)

```bash
# On the droplet, log in to GitHub Container Registry. Use a fine-grained
# Personal Access Token with `read:packages` scope ONLY (no write).
# Generate at https://github.com/settings/tokens?type=beta
ssh swasth@$DROPLET_IP
  echo "ghp_YOUR_FINE_GRAINED_TOKEN" | docker login ghcr.io -u yogeshmishra667 --password-stdin
  exit
```

Token storage: docker writes it to `~/.docker/config.json`. Lock it:
`chmod 600 ~/.docker/config.json`.

## Section 7 — First deploy

```bash
ssh swasth@$DROPLET_IP <<'EOF'
  set -eu
  cd ~/swasth

  # 1. Pull data-layer images + start them first (need the DB up before
  #    we run prisma migrate deploy).
  docker compose pull postgres redis
  docker compose up -d postgres redis

  # 2. Wait for Postgres to be ready.
  until docker compose exec -T postgres pg_isready -U swasth >/dev/null 2>&1; do
    sleep 1
  done

  # 3. Create the TimescaleDB extension (one-time per database).
  docker compose exec -T postgres psql -U swasth -d swasth -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

  # 4. Pull and start the server image — CI publishes this on push to main
  #    (see Section 9 for the publish workflow). For the very first deploy,
  #    you may need to manually push from your laptop:
  #      docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t ghcr.io/yogeshmishra667/swasth-server:bootstrap -f apps/server/Dockerfile .
  #      docker push ghcr.io/yogeshmishra667/swasth-server:bootstrap
  docker compose pull server
  docker compose up -d server

  # 5. Run prisma migrate deploy from inside the running container.
  docker compose exec server pnpm --filter @swasth/server prisma:deploy

  # 6. Create the hypertable (idempotent; safe to re-run).
  docker compose exec -T postgres psql -U swasth -d swasth \
    -c "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);"

  # 7. Probe /health.
  docker compose exec server curl -fsS http://127.0.0.1:4000/health
EOF
```

If `/health` returns `{"status":"ok"}` you're 90% there.

## Section 8 — nginx + Let's Encrypt (HTTPS)

```bash
ssh swasth@$DROPLET_IP <<'EOF'
  set -eu
  sudo apt-get install -y nginx certbot python3-certbot-nginx

  # Reverse-proxy config for swasthparivar.com → localhost:4000.
  sudo tee /etc/nginx/sites-available/swasth >/dev/null <<'NGINX'
    server {
      listen 80;
      server_name swasthparivar.com api.swasthparivar.com;

      # Health check passthrough (used by uptime monitors).
      location = /health {
        proxy_pass http://127.0.0.1:4000/health;
        access_log off;
      }

      location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
      }
    }
NGINX

  sudo ln -sf /etc/nginx/sites-available/swasth /etc/nginx/sites-enabled/swasth
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl reload nginx
EOF
```

Point `swasthparivar.com` + `api.swasthparivar.com` at the droplet's
IP in your DNS (Namecheap → Advanced DNS → A record). Wait for
propagation (`dig api.swasthparivar.com` should return your IP).

Then on the droplet:

```bash
ssh swasth@$DROPLET_IP "sudo certbot --nginx -d swasthparivar.com -d api.swasthparivar.com"
```

certbot auto-edits the nginx config to add HTTPS + sets up an auto-
renewal timer. Verify:

```bash
curl -fsS https://api.swasthparivar.com/health
# Expect: {"status":"ok","time":"..."}
```

## Section 9 — Subsequent deploys

Once CI publishes images to GHCR on every green main (set up
separately — small follow-up workflow), redeploy is:

```bash
ssh swasth@$DROPLET_IP <<'EOF'
  cd ~/swasth
  docker compose pull server
  docker compose up -d server                # restarts only the server
  docker compose exec server pnpm --filter @swasth/server prisma:deploy
  curl -fsS http://127.0.0.1:4000/health
EOF
```

Three commands, ~10 seconds of downtime, zero state loss.

For schema changes: `docker compose exec server pnpm --filter @swasth/server prisma:deploy` between `pull` and `up -d`.

## Section 10 — Backups (Phase 1 minimum)

Two layers:

1. **DO snapshot backups** (enabled in Section 2) — weekly automatic.
   Restorable to a new droplet in ~15 min. Good for "the host
   exploded" scenarios.
2. **Daily Postgres dump to a separate volume.** Cheap and easy:

```bash
ssh swasth@$DROPLET_IP <<'EOF'
  mkdir -p ~/swasth/backups
  cat > ~/swasth/backup.sh <<'SH'
#!/usr/bin/env bash
set -eu
cd ~/swasth
DATE=$(date +%F)
docker compose exec -T postgres pg_dump -U swasth -Fc swasth > backups/swasth-$DATE.dump
# Keep last 14 days, delete older.
find backups -name 'swasth-*.dump' -mtime +14 -delete
SH
  chmod +x ~/swasth/backup.sh

  # Daily 03:30 IST (= 22:00 UTC the previous day).
  (crontab -l 2>/dev/null; echo "0 22 * * * /home/swasth/swasth/backup.sh >> /home/swasth/swasth/logs/backup.log 2>&1") | crontab -
EOF
```

Restore a dump:

```bash
docker compose exec -T postgres pg_restore -U swasth -d swasth --clean --if-exists < backups/swasth-2026-05-14.dump
```

For Phase 2+ when data is real, look at `pgBackRest` or off-host backups
to R2/S3. Phase 1 in-host dumps are enough.

## Section 11 — Uptime monitoring

Cheapest credible option: **Betterstack Uptime** (free tier — 10
monitors, 3-min interval). Add `https://api.swasthparivar.com/health`
as a monitor; route alerts to email + WhatsApp.

Don't probe `/health/deep` from the uptime monitor — it touches the
DB and Redis on every check. The simple `/health` is `200 OK` as long
as the Node process is alive; that's what an external monitor wants.

## Section 12 — Common troubleshooting

| Symptom                                                                        | First thing to check                                                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up -d server` → restart loop                                   | `docker compose logs server                                                                                                                                    | tail -50`. 90% chance it's a missing env var (the audit's fail-fast guard) — read the error message, fix `.env`, restart. |
| `/health` works, `/health/deep` returns 503                                    | The deep check tells you which dependency failed in its JSON body. Likely Postgres not running (`docker compose ps`) or wrong `DATABASE_URL`.                  |
| `prisma migrate deploy` says "no migrations to apply" but schema doesn't match | A migration was committed but never marked applied. `docker compose exec server pnpm --filter @swasth/server exec prisma migrate status` shows the divergence. |
| nginx says `502 Bad Gateway`                                                   | Server container is down or not on port 4000. `docker compose ps`, then `docker compose logs server`.                                                          |
| Let's Encrypt renewal failed                                                   | `sudo certbot renew --dry-run`. Usually DNS or firewall blocking port 80.                                                                                      |
| Suddenly slow under load                                                       | `docker stats` for container CPU/RAM. If Postgres is hot, EXPLAIN ANALYZE the slow query — TimescaleDB respects normal indexes.                                |

## Section 13 — Going from this droplet to "real" infrastructure

When traffic justifies it (rough triggers: > 1k DAU, or > 1 GB Postgres
data, or > 1 second p95 latency on simple reads):

1. **Split Postgres off** to a bigger droplet or Timescale Cloud
   (managed Timescale). Update `DATABASE_URL` in `.env`, restart.
2. **Add a replica** for read traffic if the dashboard queries become
   the bottleneck.
3. **Move to k8s / Fly Machines** only if you actually need rolling
   deploys or multi-region. For Phase 1–3 a single droplet is plenty.

The Dockerfile + docker-compose pattern in this runbook ports to any
of those without rewriting code.

## Audit checklist before going live

Mirrors `docs/SETUP.md` P0 + P1 items, filtered to what blocks
go-live:

- [ ] All `.env` `CHANGE_ME_*` values replaced
- [ ] `SENTRY_DSN`, `POSTHOG_API_KEY`, `ADMIN_API_TOKEN` set (fail-
      fast guard will reject startup otherwise)
- [ ] HTTPS cert installed; `curl https://api.swasthparivar.com/health`
      returns 200
- [ ] DNS A record points at droplet IP
- [ ] Backup cron is in `crontab -l`
- [ ] Uptime monitor wired to `/health`
- [ ] First "real" reading saved via the mobile app
- [ ] Sentry dashboard received a test event (trigger a deliberate
      500 from a debug route, verify it lands)
- [ ] PostHog dashboard received `reading_logged` from the test save
