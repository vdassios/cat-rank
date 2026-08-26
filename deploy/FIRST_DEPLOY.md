# First deploy — ordered checklist

Run these in order on a fresh Ubuntu 24.04 VPS. Every command is copy-pasteable;
replace the `your-…` placeholders with real values.

## 1. DNS — A record only

- Create an **A** record for `yourdomain.com` → the VPS IPv4.
- **No AAAA record.** Docker doesn't publish ports on IPv6 by default; an AAAA
  record would blackhole v6-preferring clients.

## 2. Provision the host

Run `deploy/provision.sh` as root, passing the deploy user's login public key and
the repo URL:

```bash
./deploy/provision.sh "ssh-ed25519 AAAAC3… deploy@yourdomain.com" \
  "https://github.com/yourorg/cat-ranking.git"
```

- Use an **HTTPS** URL for a public repo (no outbound auth needed).
- For a **private** repo, use `git@github.com:yourorg/cat-ranking.git` and also
  set `DEPLOY_REPO_KEY` to a read-only deploy key (contents of the private key) —
  see step 4.

Installs Docker + compose plugin, `git`/`curl`/`sqlite3`, `fail2ban`,
`unattended-upgrades`, and `ufw`; hardens SSH; creates the `deploy` user; clones
the repo to `/opt/cat-ranking` (as `deploy`); and installs the nightly
`verify-backup.sh` cron. Idempotent and convergent — safe to re-run.

## 3. Environment

```bash
cd /opt/cat-ranking
cp .env.example .env && chmod 600 .env && chown deploy:deploy .env
```

`.env` **must be owned by `deploy`** — the CI deploy workflow connects as `deploy`
and edits the `IMAGE_TAG` line on every deploy.

Fill in:

- `ALLOWED_ORIGIN=https://yourdomain.com`
- `HMAC_SECRET` — `openssl rand -hex 32`
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`
- `HEALTHCHECK_IMAGES_URL`, `HEALTHCHECK_RESTORE_URL` (leave empty for now; see
  step 8)

CI manages the `IMAGE_TAG` line on every deploy — do not set it by hand.

**Back up `.env` out-of-band.** Losing `HMAC_SECRET` invalidates all cookies;
losing the R2 keys breaks DB and image backups.

## 4. Registry & repo access

- **GHCR:** if the image is private, `docker login ghcr.io` with a read-only PAT
  (scoped to `read:packages`). If public, skip.
- **Repo (for `git pull` by CI):**
  - **Public repo:** the HTTPS clone URL from step 2 is all you need.
  - **Private repo:** install a read-only deploy key for the `deploy` user (this
    is separate from the login key — a login key only authorizes inbound SSH, it
    cannot authenticate outbound `git`). Either re-run `provision.sh` with
    `DEPLOY_REPO_KEY` set, or do it manually:

    ```bash
    install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
    printf '%s\n' "$DEPLOY_REPO_KEY" > /home/deploy/.ssh/id_ed25519
    chown deploy:deploy /home/deploy/.ssh/id_ed25519 && chmod 600 /home/deploy/.ssh/id_ed25519
    ssh-keyscan -t ed25519 github.com >> /home/deploy/.ssh/known_hosts
    chown deploy:deploy /home/deploy/.ssh/known_hosts
    ```

## 5. Initial TLS certificate — before the stack ever starts

nginx can't boot without cert files, and nothing else may hold port 80, so issue
the first cert with `certbot --standalone` **before** `docker compose up`:

```bash
cd /opt/cat-ranking
docker run --rm -p 80:80 \
  -v ./certbot/conf:/etc/letsencrypt \
  -v ./certbot/www:/var/www/certbot \
  certbot/certbot:v2.11.0 certonly --standalone \
  -d yourdomain.com \
  --email your@email.com \
  --agree-tos --no-eff-email
```

Renewals are automatic afterwards via the compose certbot service (webroot).

## 6. Start the stack + migrate

```bash
cd /opt/cat-ranking
docker compose up -d
docker compose run --rm --no-deps app node dist/scripts/migrate.mjs
```

## 7. Verify

```bash
curl -fsS https://yourdomain.com/health
# → {"status":"ok"}
```

## 8. Monitoring

- Create an UptimeRobot check on `https://yourdomain.com/health`.
- Create **two** healthchecks.io checks — one for the daily image backup, one for
  the nightly restore verify (period: 1 day each). Paste their ping URLs into
  `.env` as `HEALTHCHECK_IMAGES_URL` and `HEALTHCHECK_RESTORE_URL`, then:

```bash
cd /opt/cat-ranking
docker compose up -d
```

The verify cron and the manual drill below both source `.env`, so
`HEALTHCHECK_RESTORE_URL` is exported into `verify-backup.sh`'s environment.

## 9. Restore drill (do not skip)

Restore the DB to a temp path and integrity-check it (sources `.env` so the
restore ping fires):

```bash
cd /opt/cat-ranking
set -a && . ./.env && set +a
./deploy/verify-backup.sh
```

Restore the image backup into a **scratch volume** — never the live
`cat-ranking_uploads` — to confirm the rclone restore path without touching
production data:

```bash
cd /opt/cat-ranking
UPLOADS_VOLUME=cat-ranking_uploads_restoretest ./deploy/restore-images.sh
```

Then confirm both healthchecks.io checks received pings.

## 10. Ongoing

- Deploys are automatic on push to `main`.
- **Rollback:** edit `IMAGE_TAG` in `.env` to a known-good sha, then
  `docker compose up -d app`.
- **Monthly:** check `df -h` — with `wal_autocheckpoint=0`, a dead litestream
  sidecar means an ever-growing WAL.
