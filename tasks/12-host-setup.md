# Task 12 — Host setup & first deploy

**Goal:** make the VPS bootstrap executable instead of prose: an idempotent
provisioning script plus an ordered first-deploy checklist. Everything the
master plan's Phase 7 needs that is *not* a container artifact lives here.

**Prereqs:** 08, 09, 10 (this task references their artifacts by name; it does
not modify them). **Read first:** master plan `CAT_RANKING_PLAN_V4.md`
§ Host provisioning & hardening, § Initial SSL certificate, § Recovery runbook;
`CONTRACTS.md` §3.

## Files you create

- `deploy/provision.sh` — idempotent host provisioning (safe to re-run).
  Target OS: Ubuntu 24.04 LTS on a Hetzner CX22. `chmod +x`.
- `deploy/FIRST_DEPLOY.md` — ordered, copy-pasteable first-deploy checklist.

## `deploy/provision.sh` — what it must do (idempotently)

1. **Packages:** Docker Engine + compose plugin (official Docker apt repo),
   `git`, `curl`, `sqlite3` (verify-backup.sh runs `sqlite3` on the host),
   `fail2ban`, `unattended-upgrades`, `ufw`.
2. **Firewall (UFW):** default deny incoming; allow `22/tcp`, `80/tcp`,
   `443/tcp`; enable non-interactively (`ufw --force enable`).
3. **SSH hardening:** `PasswordAuthentication no`, `PermitRootLogin
   prohibit-password` in a drop-in under `/etc/ssh/sshd_config.d/`; reload sshd.
   Do NOT lock out the current session (apply only if an authorized key exists
   for the deploy user).
4. **Deploy user:** create `deploy` (no password, `docker` group) if missing;
   install the provided public key to `authorized_keys` (accept it as `$1` or
   an env var; skip with a warning if absent).
5. **fail2ban:** enable the sshd jail (default config is fine).
6. **unattended-upgrades:** enable security updates.
7. **Repo:** clone the repository to `/opt/cat-ranking` if missing (remote URL
   as `$2`/env var; `git pull --ff-only` if it exists), owned by `deploy`.
8. **Cron:** install the nightly verify job for the deploy user if not present:
   `30 4 * * * cd /opt/cat-ranking && ./deploy/verify-backup.sh`
9. Print a summary of what was done vs. already in place.

Idempotency rule: every step checks before it changes (re-running on a
configured host must be a no-op plus the summary).

## `deploy/FIRST_DEPLOY.md` — ordered checklist (each item copy-pasteable)

1. **DNS:** A record → VPS IPv4. **No AAAA record** — Docker doesn't publish
   ports on IPv6 by default; a AAAA record would blackhole v6-preferring
   clients (master plan § IPv6).
2. Run `deploy/provision.sh` (as root, passing the deploy key + repo URL).
3. `cd /opt/cat-ranking && cp .env.example .env && chmod 600 .env`; fill in
   `ALLOWED_ORIGIN`, `HMAC_SECRET` (`openssl rand -hex 32`), `R2_*`,
   `HEALTHCHECK_*`. Note that CI manages the `IMAGE_TAG` line automatically.
   Remind: back up `.env` out-of-band (losing `HMAC_SECRET` invalidates all
   cookies; losing R2 keys breaks backups).
4. **GHCR access:** if the image is private, `docker login ghcr.io` with a
   read-only PAT; if public, skip. Repo access for `git pull` (public repo or
   a read-only deploy key) — state both options.
5. **Initial TLS cert — BEFORE the stack ever starts** (nginx can't boot
   without cert files, and nothing else may hold port 80):
   the `certbot certonly --standalone` one-liner from the master plan
   (§ Initial SSL certificate). Renewals are automatic afterwards via the
   compose certbot service (webroot).
6. `docker compose up -d`, then run migrations:
   `docker compose run --rm --no-deps app node dist/scripts/migrate.mjs`.
7. Verify: `curl -fsS https://yourdomain.com/health` → `{"status":"ok"}`.
8. **Monitoring:** create the UptimeRobot check on `https://…/health` and TWO
   healthchecks.io checks (images backup: period 1 day; restore verify:
   period 1 day); paste their ping URLs into `.env`
   (`HEALTHCHECK_IMAGES_URL`, `HEALTHCHECK_RESTORE_URL`) and
   `docker compose up -d` again to reload env.
9. **Restore drill (do not skip):** run `./deploy/verify-backup.sh` once by
   hand; run `./deploy/restore-images.sh` against a scratch volume or confirm
   its dry logic; confirm both healthchecks.io checks received pings.
10. **Ongoing:** deploys are automatic on push to `main`. Rollback = edit
    `IMAGE_TAG` in `.env` to a known-good sha, `docker compose up -d app`.
    Monthly: glance at disk usage (`df -h`) — with `wal_autocheckpoint=0`, a
    dead litestream sidecar means an ever-growing WAL (master plan § litestream
    failure mode).

## Constraints

- No real secrets, hostnames, or IPs — placeholders only.
- `provision.sh` must not restart Docker/ssh in a way that kills a running
  deploy; guard state-changing steps behind checks.
- Do not modify compose/nginx/backup files (Tasks 08/10 own them); reference
  them by path only.

## Acceptance check

```
bash -n deploy/provision.sh
test -x deploy/provision.sh
```
Then confirm `FIRST_DEPLOY.md` covers, in order: DNS(A-only) → provision →
`.env` → registry/repo access → standalone cert → `up -d` + migrate → health →
monitoring registration → restore drill → rollback note. Report the checklist
coverage and that the script parses.
