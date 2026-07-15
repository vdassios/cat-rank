# Task 08 — Deploy artifacts

**Goal:** the Docker/runtime files. These are transcribed from the master plan
`CAT_RANKING_PLAN_V4.md` § Deployment & backups — copy them as written, with
the small adjustments noted. (V4, not V3 — V4 fixed deploy-fatal bugs; do not
copy any artifact from V3.)

**Prereqs:** 00. **Read first:** master plan `CAT_RANKING_PLAN_V4.md`
§ Deployment & backups; `CONTRACTS.md` §1, §2, §3.

## Files you create (verbatim from the V4 master plan unless noted)

- `docker-compose.yml` — **at the repo root, NOT in `deploy/`**. Relative
  mounts (`./data`, `./deploy/litestream.yml`, `./certbot/*`) resolve against
  the compose file's directory, and all CI/cron commands run bare
  `docker compose` from `/opt/cat-ranking` — both only work with the file at
  the root. Replace `OWNER` in the image tag with the real GitHub owner/repo
  (leave a clear `TODO:` if unknown).
- `deploy/Dockerfile` — copy from V4: **`node:22-bookworm-slim`** in both
  stages (never Alpine — `onnxruntime-node` has no musl build, `better-sqlite3`
  has no musl prebuilds), builder installs `python3 make g++`, runtime installs
  `curl ca-certificates`, litestream binary via
  `COPY --from=litestream/litestream:0.3.13`, model
  `COPY models/mobilenetv2-cat.onnx ./dist/models/`, healthcheck, entrypoint.
  Keep the `COPY --from=builder /app/drizzle ./drizzle` line — the
  in-container migration step reads `./drizzle/migrations` at runtime.
  There is **no** separate htmx COPY — `astro build` already places
  `public/htmx.min.js` in `dist/client/`.
- `deploy/nginx.conf` — copy from V4. Keep `server_name yourdomain.com` as a
  placeholder. Must contain: `include /etc/nginx/mime.types;`, all rate-limit
  zones **including the `= /health` location**, the security headers **with
  HSTS**, `http2 on;` (not the deprecated `listen ... http2`), the `/uploads/`
  disk alias and `/htmx.min.js` cache rule (both re-declare `nosniff` — nginx
  `add_header` in a location drops inherited headers), and `X-Real-IP`
  proxy headers. There is **no** `set_real_ip_from` block and no
  `X-Forwarded-For` forwarding — the app must only ever trust `X-Real-IP`.
- `deploy/litestream.yml` — copy from V4: DB path **`/app/data/cats.db`**
  (must equal the app's `DATABASE_PATH`; both containers mount `./data` at
  `/app/data`), `sync-interval 1s`, `retention 168h`, `snapshot-interval 6h`.
- `deploy/entrypoint.sh` — copy from V4; `chmod +x`. Restores DB via Litestream
  if missing, ensures `DATABASE_PATH` dir and `UPLOAD_DIR` exist, then `exec "$@"`.

> `backup-images.sh`, `restore-images.sh`, and `verify-backup.sh` are
> **Task 10**. `scripts/fetch-model.sh` and the CI workflow are **Task 09**.
> `provision.sh` / `FIRST_DEPLOY.md` are **Task 12**. `.dockerignore` is
> **Task 00**.

## Compose invariants (verify while copying — these fixed real bugs)

- `image: ghcr.io/OWNER/cat-ranking:${IMAGE_TAG:-latest}` (rollback support;
  CI pins `IMAGE_TAG` in the VPS `.env`).
- The **app** service also gets `LITESTREAM_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}`
  and `LITESTREAM_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}` — its entrypoint
  runs `litestream restore` and `litestream.yml` expands `${LITESTREAM_*}`.
- **litestream `depends_on: app: condition: service_healthy`** — never the
  reverse. App health ⇒ DB writable ⇒ restore finished; the replicator must
  not start against a missing/half-restored DB.
- App **and** litestream mount `./data:/app/data` (same in-container path —
  litestream keys replicas by absolute DB path).
- Every service has the `logging: *logging` block from the `x-logging` anchor
  (json-file, max-size 10m, max-file 3).
- All images pinned per CONTRACTS §1 — no `:latest` anywhere.
- certbot entrypoint renews with `--webroot -w /var/www/certbot` (initial cert
  is issued standalone before the stack first starts — Task 12's checklist;
  a standalone _renewal_ would collide with nginx on port 80).
- For local builds a developer can swap `image:` for
  `build: { context: ., dockerfile: deploy/Dockerfile }` — add this as a
  commented alternative, do not enable both.

## Constraints

- Do not invent new services or change ports (80/443 nginx, 3000 app expose).
- Do not embed real secrets. Placeholders only (`yourdomain.com`, `<accountid>`).
- Shell scripts must start with a shebang and be executable.

## Acceptance check

```
docker compose config                                    # parses from repo root, no errors
docker compose config | grep -A2 'litestream.yml'        # resolves to <root>/deploy/litestream.yml
docker compose config | grep '/app/data'                 # BOTH app and litestream mount ./data:/app/data
docker compose config | grep -c 'max-size'               # one logging block per service (5)
sh -n deploy/entrypoint.sh                               # shell syntax OK
test -x deploy/entrypoint.sh
grep -q 'include /etc/nginx/mime.types' deploy/nginx.conf
grep -q 'Strict-Transport-Security' deploy/nginx.conf
grep -q 'bookworm-slim' deploy/Dockerfile
! grep -q 'alpine' deploy/Dockerfile
! grep -q 'set_real_ip_from' deploy/nginx.conf
! grep -qi 'X-Forwarded-For' deploy/nginx.conf
```

(If Docker isn't available in your environment, `docker compose config` is
optional; at minimum confirm YAML validity, that every `${VAR}` used appears in
CONTRACTS §3 or has a fixed value, and that the grep checks pass.) Report what
you verified.
