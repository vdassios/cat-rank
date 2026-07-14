# Cat Ranking Website — Plan (V4, deployment-hardened)

> Single source of truth. **Supersedes V3** (kept as history). V4 fixes seven
> first-deploy-fatal bugs and several security/operational gaps found in V3's
> deployment layer. Self-contained: every deploy artifact, schema, and code
> sample needed to build the site is below.

## Changes vs V3 (delta)

**Fatal-on-first-deploy fixes:**
1. Base image `node:22-alpine` → **`node:22-bookworm-slim`** — `onnxruntime-node`
   ships glibc-only binaries (fails to load on musl) and `better-sqlite3` has no
   musl prebuilds; the Alpine builder also had no compiler toolchain, so `npm ci`
   failed outright.
2. `apk add litestream` does not exist (Litestream is in no distro repo) —
   the binary is now **`COPY`d from the pinned `litestream/litestream` image**.
3. Self-healing restore could never work: the app mounted the DB at
   `/app/data/cats.db` while `litestream.yml` declared `/data/cats.db`, and the
   app container lacked the `LITESTREAM_*` env vars the config expands. Paths
   and env are now aligned (`/app/data` everywhere).
4. Compose file moved **from `deploy/` to the repo root** — relative mounts
   (`./data`, `./deploy/litestream.yml`) resolved against `deploy/`, and every
   `docker compose` command in CI/cron ran from the repo root where no compose
   file existed.
5. TLS chicken-and-egg: nginx crash-looped on missing certs, so the `--webroot`
   first issuance had nothing serving port 80. Initial cert is now issued with
   **`--standalone` before first `compose up`**; renewals use `--webroot`
   explicitly (a standalone renewal would collide with nginx on port 80).
6. Added **`.dockerignore`** — without it, `COPY . .` dragged host
   `node_modules/` (macOS binaries, overwriting the container's `npm ci`
   output), `.env`, `data/`, and `.git` into the image.
7. `backup-images.sh` was bash, but the `rclone/rclone` image has no bash —
   now **POSIX `sh`**.

**Security fixes:**
- Client IP is taken **only from `X-Real-IP`** (nginx sets it to
  `$remote_addr`, overwriting anything the client sent). V3 took the *first*
  hop of `X-Forwarded-For`, which nginx *appends* to — a spoofed
  `X-Forwarded-For` header fully controlled `clientIp`, defeating the
  `ip_ua_hash` vote dedupe and app rate limiting. The pointless
  `set_real_ip_from` block is removed (nginx **is** the edge).
- nginx now `include`s **`mime.types`** (V3's hand-written conf served
  `/uploads/*.webp` as `application/octet-stream` under `nosniff`).
- Added **HSTS**; `http2 on;` replaces the deprecated `listen … http2` syntax.
- The ONNX model moved **out of `public/`** to top-level `models/` — Astro
  copies `public/` verbatim into `dist/client/`, so V3 published the 14 MB
  model to the internet and duplicated it in image layers.
- `/health` is rate-limited in nginx (it writes to the DB on every hit).
- `add_header` in a location block drops inherited server-level headers
  (nginx inheritance rule) — `nosniff` is re-declared in the `/uploads/` and
  `/htmx.min.js` locations.

**Operational fixes:**
- `depends_on` inverted: **litestream waits for the app to be healthy**
  (health ⇒ DB writable ⇒ restore finished). V3 had the app wait on litestream,
  letting the replicator start against a missing/half-restored DB.
- Deploy order is now **pull → migrate → up** (V3 booted the new code against
  the old schema, then migrated). Migrations must be additive/backward-
  compatible since the old container serves during the migrate step.
- **Rollback**: CI pins `IMAGE_TAG=<git sha>` in `/opt/cat-ranking/.env` on
  each deploy; rollback = set an old sha and `docker compose up -d app`.
- All sidecar images **pinned** (litestream, rclone, nginx, certbot).
- Log rotation is a compose artifact (`x-logging` anchor), not prose.
- Added `deploy/restore-images.sh` — V3's runbook restore command wrote into a
  volume that compose mounts read-only.
- Upload route must delete the cat row if `processImage()` fails (no orphans).
- New **Task 12 (host setup)** owns provisioning/hardening/bootstrap
  (`deploy/provision.sh` + `deploy/FIRST_DEPLOY.md`) — previously prose only.

---

## Design principles

- **Mobile-first** — layouts designed for mobile, scaled up.
- **Minimal JavaScript** — HTMX for interactions, Preact islands only where
  necessary (~60 lines custom JS total).
- **Simple, cheap, self-hosted** — single Hetzner CX22 VPS, ~€5/mo, no cloud lock-in.
- **Defense in depth** — layered security and anti-abuse.
- **Reproducible** — the running environment is fully described by the repo; a
  fresh box reaches a known-good state from `docker compose up` alone.

---

## Locked decisions

| Topic | Decision |
|---|---|
| Runtime | Docker Compose (**file at repo root**), `restart: always` |
| Base image | `node:22-bookworm-slim` (glibc — `onnxruntime-node` has no musl build) |
| CI/CD | GitHub Actions → build image → push to GHCR → ssh: pull → **migrate → up** |
| Rollback | `IMAGE_TAG` pinned in `.env` by CI; rollback = old sha + `up -d` |
| Native deps | Compiled in multi-stage Dockerfile (never copied from macOS; `.dockerignore` enforces) |
| ONNX delivery | Baked into image layer from **`models/`** (not `public/` — Astro would publish it), SHA-256 verified in CI |
| HTMX delivery | `public/htmx.min.js`, pinned + SRI — Astro build copies it into `dist/client/` |
| Litestream binary | `COPY --from=litestream/litestream:0.3.13` (not in any distro repo) |
| Uploads path | `/var/lib/cat-ranking/uploads` (named volume, outside the build) |
| Uploads serving | nginx serves `/uploads/*` **directly from disk volume** (Node never in the byte path) |
| Reverse proxy | nginx (Docker, pinned `1.27-alpine`) |
| TLS | Initial cert `certbot --standalone` (pre-compose); renewals `certbot renew --webroot` every 12h |
| DB backup | Litestream → R2, continuous WAL, `wal_autocheckpoint=0` |
| Image backup | `rclone copy` with `--backup-dir` archival — **never `sync`** |
| Backup verification | Nightly `litestream restore` + `PRAGMA integrity_check` + dead-man ping |
| Self-healing | App entrypoint litestream-restores DB if missing; litestream replicates only after app is healthy |
| Client IP | **`X-Real-IP` only** (nginx-controlled); `X-Forwarded-For` is never trusted |
| Anti-abuse | Signed cookie + IP+UA hash (dual dedupe) |
| Rate limiting | nginx `limit_req_zone` + app fallback; `/health` included |
| CSRF | `SameSite=Lax` cookie **+ Origin/Referer allowlist check** |
| CSP | Strict `Content-Security-Policy`, no inline, no CDN; + HSTS |
| ONNX concurrency | App-level semaphore (max 2 concurrent inferences) |
| Health check | Verifies DB **writable** + uploads dir present (not just connected) |
| Host hardening | Task 12: `deploy/provision.sh` (firewall 22/80/443, SSH key-only, fail2ban, unattended-upgrades) |
| Monitoring | UptimeRobot + healthchecks.io dead-man's-switch |
| Comment model | 1 comment per user per cat |
| Like model | One-way likes (no unlike) |
| Originals | Discarded immediately after processing |

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Astro (SSR) with `@astrojs/node` adapter (standalone) |
| Islands | Preact (`@astrojs/preact`) — used sparingly |
| Interactions | HTMX (self-hosted `/htmx.min.js`, pinned + SRI, 14KB) — likes, pagination, form submits, modal loads, comment posting |
| DB | SQLite + `better-sqlite3` + `drizzle-orm` (WAL mode, `wal_autocheckpoint=0`) |
| Image pipeline | Sharp (auto-rotate via EXIF → resize → WebP, strips metadata, pixel-limit on) |
| Image validation | ONNX Runtime + MobileNetV2 quantized (~14MB model) — hard-rejects non-cats |
| Image storage | Named volume `/var/lib/cat-ranking/uploads` |
| Auth | Signed UUID cookie (`user_token`, HMAC) — `HttpOnly; Secure; SameSite=Lax`. No accounts (initially) |
| Anti-abuse | nginx + app per-IP rate limiting + `IP+UA` hash secondary vote-dedupe key |
| Deployment | Hetzner CX22 VPS (2 vCPUs x86, 4GB RAM, 40GB SSD, 20TB transfer) |

> **Native modules** (`better-sqlite3`, `sharp`, `onnxruntime-node`) compile or
> unpack their prebuilds inside the Docker image on **Debian (glibc)**. Never
> copy `node_modules/` from macOS — `.dockerignore` guarantees the build
> context can't leak it. Pin the Node version in the Dockerfile and CI. CX22 is
> x86; if ever switching to an ARM (CAX) instance, re-verify ARM64 prebuilds
> for all three (and that `onnxruntime-node` supports linux/arm64 glibc).

---

## Architecture

```
                 Internet (HTTPS)
                       │
                       ▼
            ┌────────────────────┐
            │  nginx (Docker)    │  TLS termination, gzip, mime.types,
            │  :80 / :443        │  rate-limit zones, security headers + CSP + HSTS,
            └─────────┬──────────┘  client_max_body_size 10M
       /uploads/*  ───┤  serves image bytes straight from the uploads volume
       /htmx.min.js ──┤  (in dist/client via astro build, proxied/cached)
       everything  ───┤  reverse proxy → app:3000  (sets X-Real-IP)
                      ▼
            ┌────────────────────┐
            │  app (Docker)      │  Astro node server, self-healing entrypoint
            │  :3000             │  (litestream restore), ONNX model baked in,
            └─────────┬──────────┘  inference semaphore
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   SQLite (WAL)   uploads vol   ONNX model (in image)
   /app/data      /var/lib/...
        │
        ▼
   ┌──────────────────────────────────────────────────┐
   │ litestream sidecar → R2  (continuous, <1s RPO;    │
   │   starts only after app is HEALTHY = restored)    │
   │ rclone sidecar     → R2  (daily copy + archive,   │
   │                          ≤24h RPO)                │
   │ healthchecks.io dead-man's-switch (backup +       │
   │                          restore verify)          │
   └──────────────────────────────────────────────────┘
```

---

## Why the contested choices

### Docker over systemd-native
- **Reproducibility:** the entire runtime (nginx, certbot, litestream, rclone,
  app + native deps) is pinned in images — no host drift.
- **Recovery:** a fresh CX22 + `git clone` + `.env` + `docker compose up -d`
  reaches a known state. Native builds re-compile on the host each deploy and
  depend on host package versions.
- **Cost of choice:** image builds are slower than `git pull`; mitigated by
  building in CI and pulling a prebuilt image (see CI/CD).

### Debian slim over Alpine
- `onnxruntime-node` ships **glibc-only** native binaries; there is no musl
  build. On Alpine it fails at require-time.
- `better-sqlite3` has no musl prebuilds → compiles from source, which needs
  `python3/make/g++` in the builder anyway.
- `node:22-bookworm-slim` is ~25 MB larger than alpine — irrelevant next to a
  14 MB model and `onnxruntime-node` itself, and everything Just Works.

### Model baked into the image (not git, not runtime download, not `public/`)
- Bundling 14MB in git permanently bloats history.
- Downloading at boot adds a runtime network dependency + first-boot latency.
- Putting it in `public/` (V3) publishes it at a URL and duplicates it in the
  image (Astro copies `public/` into `dist/client/`).
- **V4:** CI fetches + SHA-256-verifies into **`models/`** (gitignored,
  non-public); the Dockerfile `COPY`s it to `dist/models/`. Reproducible,
  layer-cached, offline at runtime, zero git bloat, never served.

### Uploads served from disk
- nginx `alias` to the uploads volume means Node never streams image bytes.
- HTMX ships via `public/` → `dist/client/` (Astro copies it; no extra
  Dockerfile step, no phantom volume mounted into nginx).

---

## Deployment & backups

### Components & cost

| Component | Where | Cost |
|---|---|---|
| App server | Hetzner CX22 | ~€4.00/mo |
| IPv4 address | Hetzner | ~€0.50/mo |
| DB backup | Litestream → Cloudflare R2 | $0 (free tier) |
| Image backup | rclone copy → Cloudflare R2 | $0 (free tier) |
| Uptime monitoring | UptimeRobot | $0 (free tier) |
| Backup verification | healthchecks.io | $0 (free tier) |
| Container registry | GHCR (public image) | $0 |
| **Total** | | **~€4.50–5/mo** |

> GHCR note: the plan assumes a **public** image (free, no VPS login). If the
> repo/image is private, the VPS additionally needs a one-time
> `docker login ghcr.io` with a read-only PAT (see `deploy/FIRST_DEPLOY.md`).

### `docker-compose.yml` (repo root)

Lives at the **repo root** so every `docker compose …` in CI, cron, and the
runbook works from `/opt/cat-ranking`, and all relative mounts resolve there.

```yaml
x-logging: &logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

services:
  app:
    # CI builds and pushes this, then pins IMAGE_TAG=<git sha> in .env.
    # Rollback: set IMAGE_TAG to an old sha in .env, `docker compose up -d app`.
    image: ghcr.io/OWNER/cat-ranking:${IMAGE_TAG:-latest}
    # Local-dev alternative (never enable together with image:):
    # build: { context: ., dockerfile: deploy/Dockerfile }
    restart: always
    logging: *logging
    expose:
      - "3000"
    volumes:
      - ./data:/app/data
      - uploads:/var/lib/cat-ranking/uploads
      - ./deploy/litestream.yml:/etc/litestream.yml:ro
    environment:
      - NODE_ENV=production
      - HOST=0.0.0.0
      - PORT=3000
      - DATABASE_PATH=/app/data/cats.db
      - UPLOAD_DIR=/var/lib/cat-ranking/uploads
      - ALLOWED_ORIGIN=${ALLOWED_ORIGIN}
      - HMAC_SECRET=${HMAC_SECRET}
      # entrypoint.sh runs `litestream restore`, and litestream.yml expands
      # ${LITESTREAM_*} — so the app container needs them too (mapped from R2_*).
      - LITESTREAM_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
      - LITESTREAM_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  litestream:
    image: litestream/litestream:0.3.13
    restart: always
    logging: *logging
    volumes:
      # Same in-container path as the app: litestream.yml keys replicas by
      # absolute DB path, so both containers must agree on /app/data/cats.db.
      - ./data:/app/data
      - ./deploy/litestream.yml:/etc/litestream.yml:ro
    environment:
      - LITESTREAM_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
      - LITESTREAM_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
    command: ["replicate"]
    depends_on:
      app:
        # App health requires a writable DB, i.e. the entrypoint restore is
        # done. Never start replicating a missing/half-restored database.
        condition: service_healthy

  nginx:
    image: nginx:1.27-alpine
    restart: always
    logging: *logging
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/nginx.conf:/etc/nginx/nginx.conf:ro
      - uploads:/var/www/uploads:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - app

  certbot:
    image: certbot/certbot:v2.11.0
    restart: always
    logging: *logging
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    # Initial issuance uses --standalone BEFORE the stack runs (FIRST_DEPLOY).
    # Renewals MUST override to webroot: nginx owns port 80 from then on, so a
    # standalone renewal (the recorded authenticator) would fail to bind.
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew --webroot -w /var/www/certbot; sleep 12h & wait $${!}; done;'"

  backup-images:
    image: rclone/rclone:1.67
    restart: always
    logging: *logging
    volumes:
      - uploads:/data:ro
      - ./deploy/backup-images.sh:/backup-images.sh:ro
    environment:
      - RCLONE_CONFIG_R2_TYPE=s3
      - RCLONE_CONFIG_R2_PROVIDER=Cloudflare
      - RCLONE_CONFIG_R2_ENDPOINT=${R2_ENDPOINT}
      - RCLONE_CONFIG_R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
      - RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
      - HEALTHCHECK_IMAGES_URL=${HEALTHCHECK_IMAGES_URL}
    entrypoint: "/bin/sh -c 'while :; do /backup-images.sh; sleep 86400; done'"

volumes:
  uploads:
```

### `.dockerignore` (repo root)

Without this, `COPY . .` copies host `node_modules/` (macOS binaries) **over**
the container's `npm ci` output, plus secrets and runtime data. `models/` and
`drizzle/` must **stay in** the context (the image needs both).

```
.git
.github
.astro
node_modules
dist
data
certbot
public/uploads
.env
.env.*
tasks
*.md
.DS_Store
```

### `deploy/Dockerfile`

```dockerfile
# Debian (glibc), NOT alpine: onnxruntime-node has no musl build and
# better-sqlite3 has no musl prebuilds.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Toolchain for native modules that compile from source
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Litestream is not in any distro repo — copy the static binary from the
# pinned official image (same version as the sidecar).
COPY --from=litestream/litestream:0.3.13 /usr/local/bin/litestream /usr/local/bin/litestream

# Built app + production deps (dist/client already contains public/ assets,
# including htmx.min.js — astro build copies them; no separate COPY needed)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# Migration SQL — read at runtime by dist/scripts/migrate.mjs (./drizzle/migrations)
COPY --from=builder /app/drizzle ./drizzle

# ONNX model — fetched + SHA-256 verified into ./models by CI
# (scripts/fetch-model.sh) before the image build. Never in git, never in
# public/ (Astro would publish it).
COPY models/mobilenetv2-cat.onnx ./dist/models/

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/server/entry.mjs"]
```

### `deploy/entrypoint.sh`

```bash
#!/bin/sh
set -e

DB_PATH="${DATABASE_PATH:-/app/data/cats.db}"
DB_DIR=$(dirname "$DB_PATH")
mkdir -p "$DB_DIR" "${UPLOAD_DIR:-/var/lib/cat-ranking/uploads}"

# Requires /etc/litestream.yml (mounted) + LITESTREAM_* env (compose maps them
# from R2_*). The config's DB path must equal $DB_PATH — both /app/data/cats.db.
if [ ! -f "$DB_PATH" ]; then
  echo "Database not found, attempting Litestream restore..."
  litestream restore -if-db-not-exists -if-replica-exists "$DB_PATH" \
    || echo "No replica found, starting fresh"
fi

exec "$@"
```

### `deploy/nginx.conf`

```nginx
events { worker_connections 1024; }

http {
  # Without this every response defaults to application/octet-stream —
  # /uploads/*.webp would be blocked/ignored under nosniff.
  include /etc/nginx/mime.types;
  default_type application/octet-stream;

  upstream app { server app:3000; }

  # --- Rate-limit zones ---
  # nginx is the internet-facing edge: $remote_addr IS the real client.
  # (No set_real_ip_from here — that would only matter behind a CDN, and
  # trusting X-Forwarded-For at the edge lets clients spoof their IP.)
  limit_req_zone $binary_remote_addr zone=upload:10m  rate=1r/m;
  limit_req_zone $binary_remote_addr zone=api:10m     rate=10r/s;
  limit_req_zone $binary_remote_addr zone=like:10m    rate=5r/m;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  # --- HTTP: ACME challenge + redirect to HTTPS ---
  server {
    listen 80;
    server_name yourdomain.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
  }

  # --- HTTPS ---
  server {
    listen 443 ssl;
    http2 on;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # Security headers + CSP (HTMX self-hosted → strict script-src)
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy
      "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;

    # Static uploads — served straight from disk (Node never sees the bytes).
    # NB: add_header in a location REPLACES all inherited add_headers, so
    # nosniff is re-declared here.
    location /uploads/ {
      alias /var/www/uploads/;
      expires 7d;
      add_header Cache-Control "public, immutable" always;
      add_header X-Content-Type-Options nosniff always;
    }

    # Self-hosted HTMX (in dist/client via astro build; long cache)
    location = /htmx.min.js {
      proxy_pass http://app;
      add_header Cache-Control "public, max-age=31536000, immutable" always;
      add_header X-Content-Type-Options nosniff always;
    }

    # Health — rate-limited: it is unauthenticated and writes to the DB
    # (WAL churn → Litestream R2 PUTs) on every hit.
    location = /health {
      limit_req zone=api burst=5 nodelay;
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Upload endpoint — strict rate limit + body cap
    location = /api/cats {
      if ($request_method = POST) { limit_req zone=upload burst=5 nodelay; }
      client_max_body_size 10M;
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Like endpoint — strict rate limit
    location ~ ^/api/cats/[0-9]+/like$ {
      limit_req zone=like burst=3 nodelay;
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Comment POST — rate limited
    location ~ ^/api/cats/[0-9]+/comments$ {
      if ($request_method = POST) { limit_req zone=api burst=10 nodelay; }
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Rest of the API
    location /api/ {
      limit_req zone=api burst=20 nodelay;
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}
```

> **Client-IP rule (app side):** the app trusts **only `X-Real-IP`** — nginx
> always sets it to `$remote_addr`, so a client can't influence it.
> `X-Forwarded-For` is deliberately not forwarded/trusted: nginx's
> `$proxy_add_x_forwarded_for` *appends* to whatever the client sent, so its
> first hop is attacker-controlled.

### `deploy/litestream.yml`

```yaml
dbs:
  - path: /app/data/cats.db      # must equal DATABASE_PATH in BOTH containers
    replicas:
      - type: s3
        bucket: cat-ranking
        path: db
        endpoint: https://<accountid>.r2.cloudflarestorage.com
        region: auto
        access-key-id: ${LITESTREAM_ACCESS_KEY_ID}
        secret-access-key: ${LITESTREAM_SECRET_ACCESS_KEY}
        sync-interval: 1s
        snapshot-interval: 6h
        retention: 168h            # 7 days of point-in-time recovery
        retention-check-interval: 1h
```

> The app sets `wal_autocheckpoint=0` so **Litestream owns checkpointing**.
> `better-sqlite3`'s default autocheckpoint can truncate WAL frames before
> Litestream ships them, causing gappy/corrupt replication. Retention lets an
> accidental `DELETE`/`DROP` (which replicates in ~1s) still be restored to a
> prior point.
>
> **Failure mode to know:** with `wal_autocheckpoint=0`, if the litestream
> sidecar dies and stays down, **nothing checkpoints** — the WAL grows without
> bound until the disk fills. Mitigations: `restart: always`, the
> healthchecks.io dead-man pings, and a disk-usage glance in the monthly checks
> (see FIRST_DEPLOY). This is accepted, not fixed — do not "fix" it by
> re-enabling autocheckpoint.

### `scripts/fetch-model.sh` (run in CI before the image build)

```bash
#!/usr/bin/env bash
# Download + SHA-256 verify the ONNX cat-validation model into the build context.
# Idempotent: skips download if a valid cached copy already exists.
# NB: target is models/ (non-public). Never put the model in public/ — Astro
# copies public/ into dist/client and would serve it to the internet.
set -euo pipefail

MODEL_DIR="models"
MODEL_PATH="$MODEL_DIR/mobilenetv2-cat.onnx"
MODEL_URL="${MODEL_URL:?set MODEL_URL}"
MODEL_SHA256="${MODEL_SHA256:?set MODEL_SHA256}"

mkdir -p "$MODEL_DIR"

verify() {
  [ -f "$MODEL_PATH" ] && \
    echo "${MODEL_SHA256}  ${MODEL_PATH}" | sha256sum --check --status
}

if verify; then echo "model: cached + checksum OK"; exit 0; fi

echo "model: downloading from $MODEL_URL"
tmp="$(mktemp "${MODEL_DIR}/.model.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
curl -fSL --retry 3 -o "$tmp" "$MODEL_URL"
echo "${MODEL_SHA256}  ${tmp}" | sha256sum --check --status \
  || { echo "model: checksum mismatch, refusing" >&2; exit 1; }
mv -f "$tmp" "$MODEL_PATH"
trap - EXIT
echo "model: installed + verified at $MODEL_PATH"
```

### `deploy/backup-images.sh`

```sh
#!/bin/sh
# Daily append-only image backup to R2. NEVER `rclone sync`.
# POSIX sh — this runs inside rclone/rclone (Alpine), which has no bash.
set -eu

SRC="/data"                              # uploads volume (ro) in the container
DST="R2:cat-ranking/uploads"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HC_URL="${HEALTHCHECK_IMAGES_URL:-}"     # dead-man's-switch ping (optional)

# copy = additive; --backup-dir preserves overwritten/removed files so a local
# wipe can never destroy the remote backup.
rclone copy "$SRC" "$DST" \
  --backup-dir "R2:cat-ranking/uploads-archive/$STAMP" \
  --transfers 8 --checkers 16 --log-level INFO

if [ -n "$HC_URL" ]; then
  wget -q -T 10 -O /dev/null "$HC_URL" || true
fi
echo "image backup complete: $STAMP"
```

> `wget` (busybox) instead of `curl` — the rclone image has neither bash nor
> curl, but busybox wget is present.

### `deploy/restore-images.sh` (disaster recovery — run on the host)

The compose file mounts the uploads volume **read-only** into the backup
container, so restore needs a one-off rw mount:

```sh
#!/bin/sh
# Restore the uploads volume from R2. Run from the repo root on the VPS.
set -eu
cd "$(dirname "$0")/.."

# Load R2_* from .env (compose-style KEY=VALUE lines)
set -a; . ./.env; set +a

# Compose names the volume <project>_uploads; project defaults to the dir name.
VOLUME="${UPLOADS_VOLUME:-$(basename "$PWD")_uploads}"

docker run --rm \
  -v "$VOLUME:/data" \
  -e RCLONE_CONFIG_R2_TYPE=s3 \
  -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  -e "RCLONE_CONFIG_R2_ENDPOINT=$R2_ENDPOINT" \
  -e "RCLONE_CONFIG_R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID" \
  -e "RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY" \
  rclone/rclone:1.67 copy R2:cat-ranking/uploads /data \
  --transfers 8 --checkers 16 --log-level INFO

echo "uploads volume restored into $VOLUME"
```

### `deploy/verify-backup.sh` (host cron, nightly)

```bash
#!/usr/bin/env bash
# Nightly backup verification: restore DB from R2 to a temp path + integrity check.
# Runs on the HOST (bash + sqlite3 required — provision.sh installs them).
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HC_URL="${HEALTHCHECK_RESTORE_URL:-}"    # dead-man's-switch ping (optional)

# --no-deps: don't drag the app service up via depends_on
docker compose run --rm --no-deps -v "$TMP:/restore" litestream \
  restore -o /restore/cats.db /app/data/cats.db

result="$(sqlite3 "$TMP/cats.db" 'PRAGMA integrity_check;')"
[ "$result" = "ok" ] || { echo "RESTORE VERIFY FAILED: $result" >&2; exit 1; }
sqlite3 "$TMP/cats.db" 'SELECT count(*) FROM cats;' >/dev/null   # sanity

[ -n "$HC_URL" ] && curl -fsS -m 10 "$HC_URL" >/dev/null || true
echo "restore verify OK"
```

Crontab (installed by `deploy/provision.sh`, Task 12):

```cron
30 4 * * *  cd /opt/cat-ranking && ./deploy/verify-backup.sh
```

### Initial SSL certificate (first deploy only)

nginx can't start without the cert files, so the first issuance must not rely
on nginx: use **standalone** mode while port 80 is still free (i.e. **before**
the first `docker compose up`). Renewals afterwards use webroot (see the
certbot service entrypoint).

```bash
# From /opt/cat-ranking, BEFORE the stack has ever started:
docker run --rm -p 80:80 \
  -v ./certbot/conf:/etc/letsencrypt \
  -v ./certbot/www:/var/www/certbot \
  certbot/certbot:v2.11.0 certonly --standalone \
  -d yourdomain.com \
  --email your@email.com \
  --agree-tos --no-eff-email

docker compose up -d
```

### R2 free-tier notes

- Free tier: ~10 GB storage, ~1M Class A (write) ops/mo, ~10M Class B (read) ops/mo.
- Litestream issues frequent PUTs (Class A) only when there are DB writes — watch
  the **ops** limits, not just storage. R2's real win is **zero egress**.
  (The Docker healthcheck hits `/health` every 30s and each hit writes the DB —
  that's ~90k writes/mo of baseline WAL churn, comfortably inside the limit but
  the reason `/health` is also rate-limited at nginx.)
- Both targets share one bucket: `cat-ranking/db/` and `cat-ranking/uploads/`.

### IPv6

Docker doesn't publish ports on IPv6 by default. Either don't publish an AAAA
record for the domain (simplest), or explicitly enable IPv6 in the Docker
daemon + compose network. Publishing an AAAA record without doing the latter
makes the site unreachable for v6-preferring clients.

---

## CI/CD (GitHub Actions → GHCR → ssh: pull → migrate → up)

```yaml
name: deploy
on: { push: { branches: [main] } }

jobs:
  build:
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }   # pin: must match the Dockerfile
      - run: npm ci
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test            # dedupe txn + validation guards (see Testing)
      - run: ./scripts/fetch-model.sh   # curl + sha256sum --check → models/ (in build context)
        env:
          MODEL_URL: ${{ secrets.MODEL_URL }}
          MODEL_SHA256: ${{ secrets.MODEL_SHA256 }}
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: deploy/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.sha }}
            ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            set -euo pipefail
            cd /opt/cat-ranking
            git pull --ff-only          # compose file + nginx.conf + scripts only

            # Pin the exact image for reproducibility + rollback:
            # rollback = set an old sha here and `docker compose up -d app`.
            if grep -q '^IMAGE_TAG=' .env; then
              sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${{ github.sha }}|" .env
            else
              echo "IMAGE_TAG=${{ github.sha }}" >> .env
            fi

            docker compose pull app

            # Migrate BEFORE the new code serves traffic. The old container is
            # still running here, so migrations must be additive/backward-
            # compatible (no drops/renames in the same deploy as the code that
            # stops using them).
            docker compose run --rm --no-deps app node dist/scripts/migrate.mjs

            docker compose up -d

            # Health gate with retries (no sleep-and-hope)
            for i in $(seq 1 10); do
              if docker compose exec -T app curl -fsS http://localhost:3000/health; then
                echo "deploy healthy"; exit 0
              fi
              sleep 2
            done
            echo "deploy health check FAILED" >&2
            exit 1
```

> Migrations run as an explicit deploy step, not implicitly on boot, so a bad
> migration fails the deploy loudly instead of crash-looping the app — and they
> run **before** `up -d` so the new code never boots against an old schema.

### Rollback

```bash
cd /opt/cat-ranking
sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=<known-good-sha>|' .env
docker compose up -d app
```

Schema rollbacks are not automated — keep migrations additive so old code runs
against new schema, and roll forward to fix.

---

## Host provisioning & hardening (Task 12 — `deploy/provision.sh` + `deploy/FIRST_DEPLOY.md`)

One idempotent script + one ordered checklist replace V3's prose. The script
installs/configures:

- Docker Engine + compose plugin.
- **Firewall:** UFW (or Hetzner Cloud Firewall) — allow only 22, 80, 443 inbound.
- **SSH:** key-only (`PasswordAuthentication no`), non-root deploy user.
- **fail2ban:** ban repeated SSH auth failures.
- **unattended-upgrades:** automatic security patches.
- **Host packages:** `sqlite3` (verify-backup.sh needs it), `git`, `curl`.
- **Cron:** the nightly `verify-backup.sh` entry.
- Clone to `/opt/cat-ranking`.

`FIRST_DEPLOY.md` covers the ordered bootstrap: DNS A record (no AAAA — see
IPv6 note) → run `provision.sh` → `cp .env.example .env && chmod 600 .env` +
fill secrets → GHCR `docker login` if the image is private → **initial cert via
`certbot --standalone`** → `docker compose up -d` → run migrations → register
UptimeRobot + two healthchecks.io checks → perform one restore drill.

- **Secrets:** `HMAC_SECRET` + R2 keys live in `/opt/cat-ranking/.env` (mode
  0600). Back them up out-of-band — losing `HMAC_SECRET` invalidates all
  existing cookies (acceptable; users just re-issue tokens). CI appends/updates
  `IMAGE_TAG` in this same file on every deploy.

---

## Image pipeline

### Guards (enforced before ONNX, fail fast)

| Check | Limit | Action |
|---|---|---|
| File size | ≤ 10 MB (nginx edge + app) | Reject "File too large (max 10MB)" |
| Magic bytes | `ffd8ff` (JPEG), `89504e47` (PNG), `52494646`+`WEBP` | Reject "Unsupported format" |
| Extension | `.jpg`, `.jpeg`, `.png`, `.webp` | Reject "Unsupported file type" |
| SVG | Forbidden (XSS risk) | Reject "SVG files not allowed" |
| Decompression bomb | Sharp `limitInputPixels` (default on) | Reject oversized canvases |

### Magic byte validation

```ts
const MAGIC: Record<string, string> = {
  'ffd8ff': 'image/jpeg',
  '89504e47': 'image/png',
  '52494646': 'image/webp',
};

function detectMime(buf: Buffer): string | null {
  const hex = buf.subarray(0, 4).toString('hex');
  for (const [magic, mime] of Object.entries(MAGIC)) {
    if (hex.startsWith(magic)) {
      // WEBP: bytes 8-11 must be "WEBP"
      if (mime === 'image/webp' && buf.subarray(8, 12).toString('hex') !== '57454250') return null;
      return mime;
    }
  }
  return null;
}
```

### ONNX validation with a concurrency cap

ONNX inference is ~200ms of CPU per upload. Two vCPUs means an upload burst can
starve request handling even under nginx rate limits. Bound it:

```ts
// Max 2 concurrent inferences — protects the event loop and both vCPUs.
const sem = new Semaphore(2);

export async function validateCat(buf: Buffer): Promise<boolean> {
  return sem.run(async () => {
    const input = await toTensor224(buf);      // resize to 224×224 temp
    const probs = await session.run(input);
    return sumCatClasses(probs) >= THRESHOLD;  // sum ~5 ImageNet cat classes
  });
}
```

- Model file: `models/mobilenetv2-cat.onnx` in dev, `dist/models/` in the image
  — `isCat.ts` resolves whichever exists.
- Start with a **permissive** aggregate threshold (~0.15–0.25) and tighten using
  real data. Expect some false rejections (kittens, close-ups, odd angles, dark
  cats). Hard-reject is the chosen behavior.
- Abstracted behind `validateCat(image: Buffer): Promise<boolean>` so a future
  custom binary classifier swaps in cleanly.

### Output specs

| Output | Spec | ~Size |
|---|---|---|
| Thumbnail | 300px width, WebP 80% | 15–25 KB |
| Full | 1200px max side, WebP 85% | 60–120 KB |
| Validation temp | 224×224 (MobileNet input) | discarded |
| Original | Discarded immediately after validation | — |

- Sharp `.rotate()` honors EXIF orientation (otherwise sideways images).
- Sharp strips EXIF/GPS metadata by default (privacy) — do **not** `withMetadata()`.
- Filenames from DB ID, never user input (path-traversal safe):
  `{id}_thumb.webp`, `{id}_full.webp`.

### Upload flow

```
receive file
    │
    ▼
size + MIME(magic) + extension + SVG guard ──invalid──► reject 400
    │
    ▼
validateCat() (semaphore-bounded, ~200ms)
    │
    ├── below threshold ──► delete temp, reject "We couldn't verify this is a cat"
    │
    └── cat detected ──► INSERT into cats (placeholder paths) → get id
                            │
                            ▼
                         Sharp: rotate → thumbnail (300px) + full (1200px) → WebP
                            → save both to /var/lib/cat-ranking/uploads
                            │
                            ├── on FAILURE ──► DELETE the cat row (no orphans), 500
                            ▼
                         UPDATE row with real paths → HX-Redirect: /
```

### Future: binary cat classifier

When a custom model is ready: collect rejected uploads + misclassifications from
prod, label 1000+ as cat/not-cat, fine-tune MobileNetV3-Small or EfficientNet-B0,
export to ONNX, swap the `validateCat()` implementation.

---

## Schema

```sql
cats
├── id              INTEGER PRIMARY KEY AUTOINCREMENT
├── name            TEXT NOT NULL              -- length-capped, escaped on render
├── thumbnail_path  TEXT NOT NULL
├── image_path      TEXT NOT NULL
├── likes_count     INTEGER DEFAULT 0          -- denormalized; kept in sync in txn
├── created_at      TEXT DEFAULT (datetime('now'))

CREATE INDEX idx_cats_likes   ON cats(likes_count DESC);   -- hero + leaderboard
CREATE INDEX idx_cats_created ON cats(created_at DESC);    -- grid pagination

votes
├── id              INTEGER PRIMARY KEY AUTOINCREMENT
├── cat_id          INTEGER NOT NULL REFERENCES cats(id)
├── user_token      TEXT NOT NULL
├── ip_ua_hash      TEXT NOT NULL              -- SHA-256(IP + '|' + User-Agent)
├── created_at      TEXT DEFAULT (datetime('now'))
├── UNIQUE(cat_id, user_token)                 -- one like per signed token
├── UNIQUE(cat_id, ip_ua_hash)                 -- raises cost of cookie-clearing

CREATE INDEX idx_votes_cat ON votes(cat_id);

comments
├── id              INTEGER PRIMARY KEY AUTOINCREMENT
├── cat_id          INTEGER NOT NULL REFERENCES cats(id)
├── user_token      TEXT NOT NULL
├── text            TEXT NOT NULL              -- 500 char max, sanitized
├── created_at      TEXT DEFAULT (datetime('now'))
├── UNIQUE(cat_id, user_token)                 -- one comment per user per cat

CREATE INDEX idx_comments_cat ON comments(cat_id, created_at);
```

### Likes transaction (idempotent on double-tap/retry)

```ts
db.transaction(() => {
  const ipUaHash = createHash('sha256').update(`${ip}|${userAgent}`).digest('hex').slice(0, 32);
  try {
    db.insert(votes).values({ catId, userToken, ipUaHash }).run();
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') return { success: false, reason: 'already_liked' };
    throw e;
  }
  db.update(cats).set({ likesCount: sql`likes_count + 1` }).where(eq(cats.id, catId)).run();
  return { success: true };
})();
```

### Ordering tiebreak

Equal `likes_count` → break by `id ASC` (oldest first) for a deterministic
hero/leaderboard.

---

## Auth & anti-abuse

### Signed cookie

```ts
import { sign, unsign } from 'cookie-signature';
import crypto from 'node:crypto';

const HMAC_SECRET = process.env.HMAC_SECRET!;

export function issueToken(): string { return crypto.randomUUID(); }
export function signToken(token: string): string { return sign(token, HMAC_SECRET); }
export function verifyToken(signed: string): string | false { return unsign(signed, HMAC_SECRET); }
```

Cookie attributes:
- `HttpOnly` — JS cannot read it
- `Secure` — HTTPS only
- `SameSite=Lax` — CSRF mitigation
- `Path=/` — all routes
- `Max-Age=31536000` — 1 year

### Client IP resolution (middleware)

```ts
// nginx sets X-Real-IP to $remote_addr on EVERY proxied request, overwriting
// anything the client sent — it is the only trustworthy source.
// NEVER read X-Forwarded-For: nginx appends to the client-supplied value, so
// its first hop is attacker-controlled (spoofable dedupe + rate limits).
const clientIp = request.headers.get('x-real-ip')
  ?? /* dev fallback: */ connectionRemoteAddress;
```

### IP+UA hash (secondary dedupe key)

```ts
export function createIpUaHash(ip: string, userAgent: string): string {
  return createHash('sha256').update(`${ip}|${userAgent}`).digest('hex').slice(0, 32);
}
```

To manipulate votes an attacker must simultaneously: (1) clear cookies (new
`user_token`), (2) change IP (VPN/Tor — header spoofing won't do, see above),
and (3) change User-Agent. Each barrier raises the cost.

### Origin/Referer check (CSRF defense-in-depth)

```ts
// On every state-changing POST, in addition to SameSite=Lax.
export function checkOrigin(req: Request): boolean {
  const origin = req.headers.get('origin') ?? req.headers.get('referer');
  if (!origin) return false;
  return new URL(origin).origin === process.env.ALLOWED_ORIGIN;
}
```

### Robust health check

```ts
// GET /health  (rate-limited at nginx — it writes the DB on every hit)
try {
  db.prepare('CREATE TABLE IF NOT EXISTS _health(t INTEGER)').run();
  db.prepare('INSERT INTO _health(t) VALUES (?)').run(Date.now());
  db.prepare('DELETE FROM _health').run();
  fs.accessSync(process.env.UPLOAD_DIR!, fs.constants.W_OK);
  return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
} catch {
  return new Response('unhealthy', { status: 503 });
}
```

---

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Main page shell (hero + grid + sidebar) |
| `/api/cats` | GET | Grid HTML fragment (cards + sentinel). Params `page`, `limit`. Top cat excluded. `created_at DESC` |
| `/api/cats` | POST | Multipart upload (`hx-encoding="multipart/form-data"`). Guards → validateCat → insert → Sharp (row deleted on failure) → `HX-Redirect: /` |
| `/api/submit-form` | GET | Submit modal content (form fragment) |
| `/api/cats/[id]` | GET | Modal fragment: full image, like button state, first 10 comments + sentinel, comment form or "already commented" |
| `/api/cats/[id]/like` | POST | Rate-limited. Record vote (txn), return updated like button HTML. Idempotent on repeat |
| `/api/cats/[id]/comments` | GET | Next page of comments + sentinel. `?page=N`, 10/page, `created_at ASC` |
| `/api/cats/[id]/comments` | POST | Rate-limited. Validate (≤500 chars, non-empty, not already commented), sanitize, insert, return updated list + replace form with "comment posted" |
| `/health` | GET | 200 only if DB writable + uploads dir present |

### Cross-cutting concerns

- All state-changing POSTs rely on `SameSite=Lax` cookie **and** the Origin check.
- Rate limiting and vote dedupe keyed on the real client IP from **`X-Real-IP`**
  (nginx-controlled) — never `X-Forwarded-For`.
- Multipart uploads via `hx-encoding="multipart/form-data"`.
- Redirects via `HX-Redirect` header (not HTTP 302).

---

## Security considerations

| Concern | Mitigation |
|---|---|
| XSS via image metadata | Sharp strips EXIF by default |
| XSS via SVG | Reject SVG uploads |
| XSS via comments | Server-side HTML-tag strip + Astro auto-escape + strict CSP |
| Inline-script injection | CSP `script-src 'self'` (HTMX self-hosted, no inline) |
| Path traversal | Use DB ID as filename |
| **IP spoofing (dedupe/rate-limit bypass)** | App trusts only nginx-set `X-Real-IP`; XFF never read |
| DoS via upload size | nginx `client_max_body_size 10M` (edge) + app |
| DoS via rapid uploads | nginx rate limit + app per-IP + IP/UA dedupe |
| DoS via ONNX CPU | Inference semaphore (max 2 concurrent) |
| DoS via `/health` DB writes | nginx rate limit on `/health` |
| Decompression bomb | Sharp `limitInputPixels` |
| CSRF | `SameSite=Lax` cookie + Origin/Referer check |
| Cookie tampering | HMAC signature |
| Vote manipulation | Dual dedupe (token + IP/UA) |
| Downgrade attacks | HSTS (1 year) |
| Supply chain (HTMX) | Self-hosted, pinned + SRI; CSP blocks CDNs |
| Supply chain (model) | SHA-256 verified in CI; never served (`models/`, not `public/`) |
| Secret/data leakage into image | `.dockerignore` excludes `.env*`, `data/`, `.git` |
| Host compromise | Firewall, SSH key-only, fail2ban, unattended-upgrades (provision.sh) |
| Secret loss | HMAC + R2 keys in 0600 `.env`, backed up out-of-band |

---

## UI Layout (mobile-first)

```
┌──────────────────────────┐
│   ╔══════════════════╗   │
│   ║  TOP RATED CAT   ║   │  ← hero: highest likes_count
│   ║  name · ★42      ║   │    excluded from grid
│   ║  [full-res img]  ║   │
│   ╚══════════════════╝   │
│      [ + SUBMIT ]        │  ← opens submit modal (hero only)
├──────────────────────────┤
│  ┌────┐ ┌────┐ ┌────┐   │  ← responsive auto-fill grid
│  │ ★5 │ │ ★8 │ │ ★3 │   │    repeat(auto-fill, minmax(150px, 1fr))
│  └────┘ └────┘ └────┘   │    newest first, 12/page
│           ...           │    infinite scroll via HTMX sentinel
├──────────────────────────┤
│ ☰ ─────── swipe ──────  │  ← toggles sidebar overlay
└──────────────────────────┘
```

Grid tiles show thumb + ★count and open the detail modal; the like button
lives in the modal (per the component contract — tiles stay tap-to-open).

### Sidebar (overlay from right)

- Content: SSR top 10 by `likes_count DESC`, tiebreak `id ASC` (thumbnail + name + likes).
- Open: ☰ button OR swipe left from right edge. Close: swipe right or tap backdrop.
- Animation: CSS `transform: translateX()`.
- Swipe detection: ~25 lines vanilla touch events.
- **Note:** right-edge swipe can collide with the browser back-gesture on mobile
  — test and adjust the activation zone.

### Modal — submit form

- Open: Submit button → `hx-get="/api/submit-form"` into `<dialog>`; `dialog.showModal()`.
- Image preview + frontend validation: Preact island (~30 lines).
- Close: `dialog.close()` on cancel/backdrop or after successful submit.

### Modal — cat detail (click tile image)

- Open: `hx-get="/api/cats/[id]"` into `<dialog>`.
- Like button: shared component, HTMX POST to `/api/cats/[id]/like`.
- Comments: infinite scroll within scrollable area (10/page).
- Comment form: HTMX POST; if already commented, shows "You commented on this cat".
- Close: `dialog.close()`.

### Comment sanitization

- Server-side strip tags (`text.replace(/<[^>]*>/g, '')`), trim, max 500 chars.
- Astro auto-escapes on render (defense in depth).
- `UNIQUE(cat_id, user_token)` enforces one comment per user per cat.
- Cat `name` is likewise length-capped and escaped on render.

---

## Interactions summary

| Element | Tech | Custom JS |
|---|---|---|
| Grid responsive columns | CSS `auto-fill` | 0 |
| Grid infinite scroll | HTMX `hx-trigger="revealed"` | 0 |
| Like button (modal) | HTMX POST | 0 |
| Modal open (detail/submit) | HTMX `hx-get` | 0 |
| Modal close | Vanilla `dialog.close()` | ~5 |
| Submit image preview | Preact island | ~30 |
| Comment infinite scroll | HTMX `hx-trigger="revealed"` | 0 |
| Comment form (post/error) | HTMX POST | 0 |
| Sidebar toggle (☰) | CSS / HTMX | 0 |
| Sidebar swipe gesture | Vanilla touch events | ~25 |
| Sidebar animation | CSS transition | 0 |

**Total custom JS: ~60 lines.**

---

## Testing strategy

CI runs `npm test`; high-value targets (fast unit/integration on in-memory
SQLite, no ONNX/network):

- **Dedupe transaction:** double like (same token) → count increments once; same
  IP/UA, new token → still rejected; distinct user → increments.
- **Validation guards:** oversized file, bad magic bytes, SVG, mismatched
  extension all reject *before* ONNX is invoked.
- **`validateCat()`** with a stub session: above/below threshold behavior.
- **Comment rules:** >500 chars rejected; HTML stripped; second comment by same
  user on same cat rejected.
- **Origin check:** POST with a foreign Origin → 403.

---

## File structure

```
docker-compose.yml               ← REPO ROOT (relative mounts resolve here)
.dockerignore
src/
├── db/
│   ├── connection.ts            better-sqlite3 + drizzle; WAL, wal_autocheckpoint=0
│   └── schema.ts                cats, votes, comments, indexes
├── lib/
│   ├── auth.ts                  signed cookie (HMAC) + ip_ua_hash
│   ├── csrf.ts                  Origin/Referer allowlist check
│   ├── semaphore.ts             concurrency limiter for ONNX
│   └── rateLimit.ts             per-IP token bucket; keyed on X-Real-IP
├── validation/
│   ├── isCat.ts                 ONNX inference wrapper (validateCat, tunable threshold)
│   ├── imagenet-labels.json     class index → label
│   └── mime.ts                  magic-byte detection
├── middleware.ts                user_token cookie (sign/verify), X-Real-IP resolve
├── pages/
│   ├── index.astro              shell (hero + grid + sidebar)
│   ├── health.ts                GET /health → 200 if DB writable + uploads dir OK
│   └── api/
│       ├── submit-form.ts       GET modal content
│       └── cats/
│           ├── index.ts         GET grid | POST upload
│           └── [id]/
│               ├── index.ts     GET detail modal
│               ├── like.ts      POST vote (txn) → updated button
│               └── comments.ts  GET paged | POST add
├── components/
│   ├── Hero.astro  CatGrid.astro  CatCard.astro  LikeButton.astro
│   ├── Sentinel.astro  CatModal.astro  CommentList.astro  CommentItem.astro
│   ├── CommentForm.astro  SubmitForm.tsx (Preact)  Leaderboard.astro  Sidebar.astro
├── scripts/
│   └── ui.ts                    client JS (~60 lines, served at /ui.js)
public/
└── htmx.min.js                  self-hosted, pinned + SRI (astro copies → dist/client)
models/                          mobilenetv2-cat.onnx (fetched in CI, gitignored, NOT public/)
scripts/
├── migrate.ts                   drizzle migrations (built → dist/scripts/migrate.mjs)
└── fetch-model.sh               CI: curl + sha256sum → models/
deploy/
├── Dockerfile
├── nginx.conf
├── litestream.yml
├── entrypoint.sh
├── backup-images.sh             POSIX sh (rclone image has no bash)
├── restore-images.sh            disaster recovery (rw one-off mount)
├── verify-backup.sh
├── provision.sh                 Task 12: host setup, idempotent
└── FIRST_DEPLOY.md              Task 12: ordered bootstrap checklist
drizzle/migrations/
.github/workflows/deploy.yml     CI: build → GHCR → ssh pull + migrate + up
.env.example
package.json  tsconfig.json  astro.config.mjs  drizzle.config.ts
# runtime (NOT in build): ./data/{cats.db,-wal,-shm}, ./certbot/, uploads volume
```

---

## Dependencies

```json
{
  "dependencies": {
    "astro": "^5.x",
    "@astrojs/preact": "^4.x",
    "@astrojs/node": "^9.x",
    "preact": "^10.x",
    "drizzle-orm": "^0.x",
    "better-sqlite3": "^11.x",
    "sharp": "^0.x",
    "onnxruntime-node": "^1.x",
    "cookie-signature": "^1.x"
  },
  "devDependencies": {
    "drizzle-kit": "^0.x",
    "@types/better-sqlite3": "^7.x"
  }
}
```

External binaries (via pinned Docker images): `nginx:1.27-alpine`,
`certbot/certbot:v2.11.0`, `litestream/litestream:0.3.13`, `rclone/rclone:1.67`.

---

## Recovery runbook (~15 min)

1. Provision new Hetzner CX22 (same region); run `deploy/provision.sh`
   (Docker, firewall, SSH hardening, sqlite3, cron).
2. `git clone` repo to `/opt/cat-ranking`; copy `.env` from out-of-band backup
   (HMAC secret, R2 keys; `IMAGE_TAG` optional — defaults to `latest`).
3. Issue SSL cert (`certbot --standalone` one-liner above — before compose up).
4. `docker compose up -d` — entrypoint litestream-restores the DB if missing;
   litestream starts replicating only once the app is healthy.
5. Images: `./deploy/restore-images.sh` (rw one-off; the compose backup service
   mounts the volume read-only and cannot restore).
6. Verify: `curl https://yourdomain.com/health`.
7. **Reconcile:** the image backup is ≤24h behind the DB — cats uploaded after
   the last image backup will have rows but missing files. Either delete those
   rows or accept the broken tiles until re-upload.

> Single VPS = single point of failure. Accepted: RPO ~1s (DB) / ≤24h (images),
> manual RTO ~15 min. Acceptable for a hobby project; revisit if it grows.

---

## Implementation phases

### Phase 1 — Scaffold
- [ ] Astro SSR + Node adapter; add Preact integration
- [ ] `deploy/` dir: Dockerfile, nginx.conf, entrypoint.sh; `docker-compose.yml` at root
- [ ] `.dockerignore`; `scripts/fetch-model.sh` → `models/`
- [ ] Bundle HTMX (v2.0.4) with SRI; `.env.example`

### Phase 2 — Database
- [ ] better-sqlite3 + drizzle; WAL + `wal_autocheckpoint=0`
- [ ] Schema with dual UNIQUE on votes; indexes
- [ ] drizzle migrations + `scripts/migrate.ts`

### Phase 3 — Auth & security
- [ ] Signed cookie middleware; IP+UA hash
- [ ] Client IP from `X-Real-IP` only
- [ ] CSRF: SameSite + Origin check; CSP + HSTS in nginx

### Phase 4 — Image pipeline
- [ ] Magic-byte + size + extension + SVG guards
- [ ] ONNX validation behind `validateCat()` + semaphore (model in `models/`)
- [ ] Sharp rotate → thumb + full → WebP → uploads volume

### Phase 5 — API routes
- [ ] GET/POST `/api/cats` (orphan-row cleanup on processImage failure)
- [ ] GET `/api/submit-form`; GET `/api/cats/[id]`; POST `/api/cats/[id]/like`
- [ ] GET/POST `/api/cats/[id]/comments`; GET `/health`

### Phase 6 — UI components
- [ ] Hero, CatGrid, CatCard, LikeButton, Sentinel
- [ ] CatModal, CommentList, CommentItem, CommentForm
- [ ] SubmitForm (Preact), Leaderboard, Sidebar

### Phase 7 — CI/CD & deploy (Task 12 artifacts)
- [ ] GitHub Actions: lint/typecheck/test → build → GHCR; deploy = pull → migrate → up → health gate
- [ ] Provision CX22 via `deploy/provision.sh`; DNS (A only)
- [ ] `FIRST_DEPLOY.md` checklist: .env, GHCR access, standalone cert, `up -d`
- [ ] Litestream + rclone backups live; verify-backup cron (installed by provision.sh)
- [ ] UptimeRobot + healthchecks.io; test the restore runbook incl. `restore-images.sh`

---

## Cost breakdown

| Item | Monthly |
|---|---|
| Hetzner CX22 | €4.00 |
| IPv4 address | €0.50 |
| Cloudflare R2 | $0 |
| UptimeRobot | $0 |
| healthchecks.io | $0 |
| GHCR (public image) | $0 |
| **Total** | **~€4.50–5** |

---

## Open decisions / Future

- Admin route to delete inappropriate comments/cats (password-protected, later).
- User accounts / proper auth (later; would supersede the cookie+IP scheme).
- Keep originals in R2 only (cheap insurance for future re-encoding) — optional.
- Custom binary cat classifier (collect rejects, label 1000+, fine-tune
  MobileNetV3-Small/EfficientNet-B0, export ONNX, swap behind `validateCat()`).
- R2 object versioning for additional backup safety.
- Structured request logging / basic metrics if traffic grows.
- Sidebar overlay mechanics (slide vs push) — decide at implementation.
- Comment ordering — start oldest-first (chronological).
- **Offset pagination duplicates:** new uploads shift `created_at DESC` pages,
  so infinite scroll can show a tile twice. Cursor pagination (`id <
  lastSeenId`) fixes it; deliberately deferred (contract churn > benefit at
  hobby scale).
- **Grid like button:** V3 prose mentioned likes on grid tiles; the component
  contract renders count-only tiles (like button in the modal). The contract is
  authoritative — revisit only if engagement needs it.
- Behind-CDN mode (Cloudflare proxy) would need `set_real_ip_from` with CF
  ranges + `CF-Connecting-IP` — out of scope until needed.
