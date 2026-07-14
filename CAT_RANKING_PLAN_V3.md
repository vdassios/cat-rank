# Cat Ranking Website — Plan (V3, comprehensive)

> Single source of truth. Synthesis of the Docker-reproducibility plan and the
> operational-rigor plan, plus fixes for gaps in both. Self-contained: every
> deploy artifact, schema, and code sample needed to build the site is below.

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
| Runtime | Docker Compose, `restart: always` |
| CI/CD | GitHub Actions → build image → push to GHCR → ssh `docker compose pull && up -d` |
| Native deps | Compiled in multi-stage Dockerfile (never copied from macOS) |
| ONNX delivery | **Baked into image layer**, SHA-256 verified at build (not in git, not fetched at runtime) |
| HTMX delivery | **Baked into image** (`dist/client/htmx.min.js`), pinned + SRI |
| Uploads path | `/var/lib/cat-ranking/uploads` (named volume, outside the build) |
| Uploads serving | nginx serves `/uploads/*` **directly from disk volume** (Node never in the byte path) |
| Reverse proxy | nginx (Docker) |
| TLS | certbot container, auto-renew every 12h |
| DB backup | Litestream → R2, continuous WAL, `wal_autocheckpoint=0` |
| Image backup | `rclone copy` with `--backup-dir` archival — **never `sync`** |
| Backup verification | Nightly `litestream restore` + `PRAGMA integrity_check` + dead-man ping |
| Self-healing | Entrypoint litestream-restores DB if missing |
| Anti-abuse | Signed cookie + IP+UA hash (dual dedupe) |
| Rate limiting | nginx `limit_req_zone` + app fallback |
| CSRF | `SameSite=Lax` cookie **+ Origin/Referer allowlist check** |
| CSP | Strict `Content-Security-Policy`, no inline, no CDN |
| ONNX concurrency | App-level semaphore (max 2 concurrent inferences) |
| Health check | Verifies DB **writable** + uploads dir present (not just connected) |
| Host hardening | Firewall (22/80/443), SSH key-only, fail2ban, unattended-upgrades, log rotation |
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

> **Native modules** (`better-sqlite3`, `sharp`, `onnxruntime-node`) compile
> inside the Docker image on Linux. Never copy `node_modules/` from macOS. Pin
> the Node version in the Dockerfile and CI. CX22 is x86; if ever switching to an
> ARM (CAX) instance, re-verify ARM64 prebuilds.

---

## Architecture

```
                 Internet (HTTPS)
                       │
                       ▼
            ┌────────────────────┐
            │  nginx (Docker)    │  TLS termination, gzip/brotli,
            │  :80 / :443        │  rate-limit zones, security headers + CSP,
            └─────────┬──────────┘  client_max_body_size 10M
       /uploads/*  ───┤  serves image bytes straight from the uploads volume
       /htmx.min.js ──┤  (baked into app build, proxied/cached)
       everything  ───┤  reverse proxy → app:3000
                      ▼
            ┌────────────────────┐
            │  app (Docker)      │  Astro node server, self-healing entrypoint,
            │  :3000             │  ONNX model + htmx baked in, inference semaphore
            └─────────┬──────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   SQLite (WAL)   uploads vol   ONNX model (in image)
   /app/data      /var/lib/...
        │
        ▼
   ┌─────────────────────────────────────────────┐
   │ litestream sidecar → R2  (continuous, <1s RPO)│
   │ rclone sidecar     → R2  (daily copy + archive,│
   │                          ≤24h RPO)             │
   │ healthchecks.io dead-man's-switch (backup +    │
   │                          restore verify)       │
   └─────────────────────────────────────────────┘
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

### Model baked into the image (not git, not runtime download)
- Bundling 14MB in git permanently bloats history.
- Downloading at boot adds a runtime network dependency + first-boot latency.
- **V3:** the Dockerfile `COPY`s the model from a build context fetched +
  SHA-256-verified in CI (`scripts/fetch-model.sh`). Reproducible, layer-cached,
  offline at runtime, zero git bloat.

### Uploads served from disk
- nginx `alias` to the uploads volume means Node never streams image bytes.
- HTMX is baked into `dist/client` (no phantom empty volume mounted into nginx).

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

### `deploy/docker-compose.yml`

```yaml
services:
  app:
    # CI builds and pushes this; the VPS pulls it. For local dev use `build: .`.
    image: ghcr.io/OWNER/cat-ranking:latest
    restart: always
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
      - R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
      - R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      - litestream

  litestream:
    image: litestream/litestream:latest
    restart: always
    volumes:
      - ./data:/data
      - ./deploy/litestream.yml:/etc/litestream.yml:ro
    environment:
      - LITESTREAM_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
      - LITESTREAM_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
    command: ["replicate"]

  nginx:
    image: nginx:alpine
    restart: always
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
    image: certbot/certbot
    restart: always
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done;'"

  backup-images:
    image: rclone/rclone:latest
    restart: always
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

### `deploy/Dockerfile`

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache curl litestream

# Built app + production deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# Migration SQL — read at runtime by dist/scripts/migrate.mjs (./drizzle/migrations)
COPY --from=builder /app/drizzle ./drizzle

# ONNX model — fetched + SHA-256 verified into ./public/models by CI
# (scripts/fetch-model.sh) before the image build. Never committed to git.
COPY public/models/mobilenetv2-cat.onnx ./dist/models/

# Self-hosted HTMX, pinned + SRI
COPY public/htmx.min.js ./dist/client/htmx.min.js

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
  upstream app { server app:3000; }

  # --- Rate-limit zones (keyed on real client IP) ---
  limit_req_zone $binary_remote_addr zone=upload:10m  rate=1r/m;
  limit_req_zone $binary_remote_addr zone=api:10m     rate=10r/s;
  limit_req_zone $binary_remote_addr zone=like:10m    rate=5r/m;

  # --- Real IP resolution (behind Docker network / proxy) ---
  set_real_ip_from 10.0.0.0/8;
  set_real_ip_from 172.16.0.0/12;
  real_ip_header X-Forwarded-For;
  real_ip_recursive on;

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
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # Security headers + CSP (HTMX self-hosted → strict script-src)
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy
      "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;

    # Static uploads — served straight from disk (Node never sees the bytes)
    location /uploads/ {
      alias /var/www/uploads/;
      expires 7d;
      add_header Cache-Control "public, immutable";
    }

    # Self-hosted HTMX (baked into app build; long cache)
    location = /htmx.min.js {
      proxy_pass http://app;
      add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Upload endpoint — strict rate limit + body cap
    location = /api/cats {
      if ($request_method = POST) { limit_req zone=upload burst=5 nodelay; }
      client_max_body_size 10M;
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Like endpoint — strict rate limit
    location ~ ^/api/cats/[0-9]+/like$ {
      limit_req zone=like burst=3 nodelay;
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Comment POST — rate limited
    location ~ ^/api/cats/[0-9]+/comments$ {
      if ($request_method = POST) { limit_req zone=api burst=10 nodelay; }
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Rest of the API
    location /api/ {
      limit_req zone=api burst=20 nodelay;
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
      proxy_pass http://app;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}
```

### `deploy/litestream.yml`

```yaml
dbs:
  - path: /data/cats.db
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

### `scripts/fetch-model.sh` (run in CI before the image build)

```bash
#!/usr/bin/env bash
# Download + SHA-256 verify the ONNX cat-validation model into the build context.
# Idempotent: skips download if a valid cached copy already exists.
set -euo pipefail

MODEL_DIR="public/models"
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

```bash
#!/usr/bin/env bash
# Daily append-only image backup to R2. NEVER `rclone sync`.
set -euo pipefail

SRC="/data"                              # uploads volume (ro) in the container
DST="R2:cat-ranking/uploads"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HC_URL="${HEALTHCHECK_IMAGES_URL:-}"     # dead-man's-switch ping (optional)

# copy = additive; --backup-dir preserves overwritten/removed files so a local
# wipe can never destroy the remote backup.
rclone copy "$SRC" "$DST" \
  --backup-dir "R2:cat-ranking/uploads-archive/$STAMP" \
  --transfers 8 --checkers 16 --log-level INFO

[ -n "$HC_URL" ] && curl -fsS -m 10 "$HC_URL" >/dev/null || true
echo "image backup complete: $STAMP"
```

### `deploy/verify-backup.sh` (host cron, nightly)

```bash
#!/usr/bin/env bash
# Nightly backup verification: restore DB from R2 to a temp path + integrity check.
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HC_URL="${HEALTHCHECK_RESTORE_URL:-}"    # dead-man's-switch ping (optional)

docker compose run --rm -v "$TMP:/restore" litestream \
  restore -o /restore/cats.db /data/cats.db

result="$(sqlite3 "$TMP/cats.db" 'PRAGMA integrity_check;')"
[ "$result" = "ok" ] || { echo "RESTORE VERIFY FAILED: $result" >&2; exit 1; }
sqlite3 "$TMP/cats.db" 'SELECT count(*) FROM cats;' >/dev/null   # sanity

[ -n "$HC_URL" ] && curl -fsS -m 10 "$HC_URL" >/dev/null || true
echo "restore verify OK"
```

Crontab:

```cron
30 4 * * *  cd /opt/cat-ranking && ./deploy/verify-backup.sh
```

### Initial SSL certificate (first deploy only)

```bash
docker run -it --rm \
  -v ./certbot/conf:/etc/letsencrypt \
  -v ./certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot \
  -w /var/www/certbot \
  -d yourdomain.com \
  --email your@email.com \
  --agree-tos --no-eff-email

docker compose up -d
```

### R2 free-tier notes

- Free tier: ~10 GB storage, ~1M Class A (write) ops/mo, ~10M Class B (read) ops/mo.
- Litestream issues frequent PUTs (Class A) only when there are DB writes — watch
  the **ops** limits, not just storage. R2's real win is **zero egress**.
- Both targets share one bucket: `cat-ranking/db/` and `cat-ranking/uploads/`.

---

## CI/CD (GitHub Actions → GHCR → ssh pull)

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
      - run: ./scripts/fetch-model.sh   # curl + sha256sum --check → build context
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
            docker compose pull app
            docker compose up -d
            docker compose run --rm app node dist/scripts/migrate.mjs   # drizzle
            sleep 3
            docker compose exec -T app curl -fsS http://localhost:3000/health
```

> Migrations run as an explicit deploy step, not implicitly on boot, so a bad
> migration fails the deploy loudly instead of crash-looping the app.

---

## Host hardening (one-time, on the VPS)

- **Firewall:** Hetzner Cloud Firewall (or UFW) — allow only 22, 80, 443 inbound.
- **SSH:** key-only (`PasswordAuthentication no`), non-root deploy user with
  `sudo` for `docker compose` only.
- **fail2ban:** ban repeated SSH auth failures.
- **unattended-upgrades:** automatic security patches.
- **Log rotation:** Docker `json-file` driver with `max-size`/`max-file`, or
  `logrotate` for app logs.
- **Secrets:** `HMAC_SECRET` + R2 keys live in `/opt/cat-ranking/.env` (mode
  0600). Back them up out-of-band — losing `HMAC_SECRET` invalidates all
  existing cookies (acceptable; users just re-issue tokens).

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
    └── cat detected ──► Sharp: rotate → thumbnail (300px) + full (1200px) → WebP
                            → save both to /var/lib/cat-ranking/uploads
                            │
                            ▼
                         INSERT into cats (in txn) → HX-Redirect: /
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

### IP+UA hash (secondary dedupe key)

```ts
export function createIpUaHash(ip: string, userAgent: string): string {
  return createHash('sha256').update(`${ip}|${userAgent}`).digest('hex').slice(0, 32);
}
```

To manipulate votes an attacker must simultaneously: (1) clear cookies (new
`user_token`), (2) change IP (VPN/Tor), and (3) change User-Agent. Each barrier
raises the cost.

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
// GET /health
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
| `/api/cats` | POST | Multipart upload (`hx-encoding="multipart/form-data"`). Guards → validateCat → Sharp → insert → `HX-Redirect: /` |
| `/api/submit-form` | GET | Submit modal content (form fragment) |
| `/api/cats/[id]` | GET | Modal fragment: full image, like button state, first 10 comments + sentinel, comment form or "already commented" |
| `/api/cats/[id]/like` | POST | Rate-limited. Record vote (txn), return updated like button HTML. Idempotent on repeat |
| `/api/cats/[id]/comments` | GET | Next page of comments + sentinel. `?page=N`, 10/page, `created_at ASC` |
| `/api/cats/[id]/comments` | POST | Rate-limited. Validate (≤500 chars, non-empty, not already commented), sanitize, insert, return updated list + replace form with "comment posted" |
| `/health` | GET | 200 only if DB writable + uploads dir present |

### Cross-cutting concerns

- All state-changing POSTs rely on `SameSite=Lax` cookie **and** the Origin check.
- Rate limiting keyed on real client IP (`X-Forwarded-For`/`X-Real-IP`) — the
  socket address is the proxy behind nginx.
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
| DoS via upload size | nginx `client_max_body_size 10M` (edge) + app |
| DoS via rapid uploads | nginx rate limit + app per-IP + IP/UA dedupe |
| DoS via ONNX CPU | Inference semaphore (max 2 concurrent) |
| Decompression bomb | Sharp `limitInputPixels` |
| CSRF | `SameSite=Lax` cookie + Origin/Referer check |
| Cookie tampering | HMAC signature |
| Vote manipulation | Dual dedupe (token + IP/UA) |
| Supply chain (HTMX) | Self-hosted, pinned + SRI; CSP blocks CDNs |
| Host compromise | Firewall, SSH key-only, fail2ban, unattended-upgrades |
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
| Like button (grid + modal) | HTMX POST | 0 |
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
src/
├── db/
│   ├── connection.ts            better-sqlite3 + drizzle; WAL, wal_autocheckpoint=0
│   └── schema.ts                cats, votes, comments, indexes
├── lib/
│   ├── auth.ts                  signed cookie (HMAC) + ip_ua_hash
│   ├── csrf.ts                  Origin/Referer allowlist check
│   ├── semaphore.ts             concurrency limiter for ONNX
│   └── rateLimit.ts             per-IP token bucket; reads X-Forwarded-For
├── validation/
│   ├── isCat.ts                 ONNX inference wrapper (validateCat, tunable threshold)
│   ├── imagenet-labels.json     class index → label
│   └── mime.ts                  magic-byte detection
├── middleware.ts                user_token cookie (sign/verify), real-IP resolve
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
│   └── migrate.ts               drizzle migrations (built → dist/scripts/migrate.mjs)
public/
├── htmx.min.js                  self-hosted, pinned + SRI
└── models/                      mobilenetv2-cat.onnx (fetched in CI, gitignored)
scripts/
└── fetch-model.sh               CI: curl + sha256sum → build context
deploy/
├── docker-compose.yml
├── Dockerfile
├── nginx.conf
├── litestream.yml
├── entrypoint.sh
├── backup-images.sh
└── verify-backup.sh
drizzle/migrations/
.github/workflows/deploy.yml     CI: build → GHCR → ssh pull + migrate
.env.example
package.json  tsconfig.json  astro.config.mjs  drizzle.config.ts
# runtime (NOT in build): ./data/{cats.db,-wal,-shm}, uploads volume
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

External binaries (via Docker images): `nginx`, `certbot`, `litestream`, `rclone`.

---

## Recovery runbook (~15 min)

1. Provision new Hetzner CX22 (same region); install Docker + compose.
2. Apply host hardening (firewall, SSH key-only).
3. `git clone` repo to `/opt/cat-ranking`; copy `.env` (HMAC secret, R2 keys).
4. Issue SSL cert (certbot one-liner above).
5. `docker compose up -d` — entrypoint litestream-restores the DB if missing.
6. Images: `docker compose run --rm backup-images rclone copy R2:cat-ranking/uploads/ /data/`
   (or restore into the uploads volume directly).
7. Verify: `curl https://yourdomain.com/health`.

> Single VPS = single point of failure. Accepted: RPO ~1s (DB) / ≤24h (images),
> manual RTO ~15 min. Acceptable for a hobby project; revisit if it grows.

---

## Implementation phases

### Phase 1 — Scaffold
- [ ] Astro SSR + Node adapter; add Preact integration
- [ ] `deploy/` dir: Dockerfile, docker-compose.yml, nginx.conf, entrypoint.sh
- [ ] `scripts/fetch-model.sh`; download + checksum MobileNetV2 ONNX
- [ ] Bundle HTMX (v2.0.4) with SRI; `.env.example`

### Phase 2 — Database
- [ ] better-sqlite3 + drizzle; WAL + `wal_autocheckpoint=0`
- [ ] Schema with dual UNIQUE on votes; indexes
- [ ] drizzle migrations + `scripts/migrate.ts`

### Phase 3 — Auth & security
- [ ] Signed cookie middleware; IP+UA hash
- [ ] Real IP resolution from headers
- [ ] CSRF: SameSite + Origin check; CSP header in nginx

### Phase 4 — Image pipeline
- [ ] Magic-byte + size + extension + SVG guards
- [ ] ONNX validation behind `validateCat()` + semaphore
- [ ] Sharp rotate → thumb + full → WebP → uploads volume

### Phase 5 — API routes
- [ ] GET/POST `/api/cats`; GET `/api/submit-form`
- [ ] GET `/api/cats/[id]`; POST `/api/cats/[id]/like`
- [ ] GET/POST `/api/cats/[id]/comments`; GET `/health`

### Phase 6 — UI components
- [ ] Hero, CatGrid, CatCard, LikeButton, Sentinel
- [ ] CatModal, CommentList, CommentItem, CommentForm
- [ ] SubmitForm (Preact), Leaderboard, Sidebar

### Phase 7 — CI/CD & deploy
- [ ] GitHub Actions: lint/typecheck/test → build → GHCR
- [ ] Provision CX22; host hardening; DNS
- [ ] Initial certbot; `docker compose up -d`; run migrations
- [ ] Litestream + rclone backups live; verify-backup cron
- [ ] UptimeRobot + healthchecks.io; test the restore runbook

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
```
