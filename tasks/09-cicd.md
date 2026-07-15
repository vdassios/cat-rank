# Task 09 — CI/CD & model fetch

**Goal:** the GitHub Actions pipeline (build → GHCR → ssh deploy) and the model
fetch+verify script it calls.

**Prereqs:** 00. **Read first:** master plan `CAT_RANKING_PLAN_V4.md` § CI/CD
and `scripts/fetch-model.sh`; `CONTRACTS.md` §1, §3. (V4, not V3 — V4 changed
the deploy ordering and the model path.)

## Files you create (verbatim from the V4 master plan unless noted)

- `scripts/fetch-model.sh` — copy from V4. Downloads the ONNX model to
  **`models/mobilenetv2-cat.onnx`** (top-level `models/`, NOT `public/` —
  CONTRACTS §1), verifies `MODEL_SHA256`, idempotent. `chmod +x`.
- `.github/workflows/deploy.yml` — copy from V4. Two jobs:
  - **build:** checkout → setup-node 22 → `npm ci` → lint/typecheck →
    `npm test` → `./scripts/fetch-model.sh` (with `MODEL_URL`/`MODEL_SHA256`
    secrets) → docker build/push to `ghcr.io/${{ github.repository }}` tags
    `:${{ github.sha }}` and `:latest`, with gha cache.
  - **deploy:** ssh to the VPS, then **in this exact order**:
    1. `git pull --ff-only`
    2. pin `IMAGE_TAG=${{ github.sha }}` in `/opt/cat-ranking/.env`
       (sed-replace the line, or append if absent) — this is the rollback
       mechanism: rollback = old sha in `.env` + `docker compose up -d app`.
    3. `docker compose pull app`
    4. `docker compose run --rm --no-deps app node dist/scripts/migrate.mjs`
       — migrations run **before** `up -d` so the new code never boots against
       an old schema. (The old container still serves during this step, so
       migrations must be additive/backward-compatible.)
    5. `docker compose up -d`
    6. health gate with **retries** (no bare `sleep`): loop up to 10× —
       `docker compose exec -T app curl -fsS http://localhost:3000/health`,
       2s apart; exit non-zero if it never passes.

## Required secrets (document in the workflow as comments)

`MODEL_URL`, `MODEL_SHA256`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
(`GITHUB_TOKEN` is automatic). These live in GitHub Actions secrets, **not** in
the repo or `.env`.

## Constraints

- Node version pinned to `22` to match the Dockerfile (CONTRACTS §1).
- The Dockerfile path is `deploy/Dockerfile`; set `file:` accordingly in
  build-push-action. The build `context: .` must include `models/` — the
  `.dockerignore` (Task 00) deliberately does not exclude it; do not "clean it
  up" into the ignore list.
- Compose commands run bare (`docker compose ...`) from `/opt/cat-ranking` —
  the compose file lives at the repo root (Task 08), so no `-f` flag.
- Do not commit the model; it is gitignored and fetched at build time only.
- `npm test` must run before the image is built (gate the build on tests).

## Acceptance check

```
sh -n scripts/fetch-model.sh
test -x scripts/fetch-model.sh
grep -q 'MODEL_DIR="models"' scripts/fetch-model.sh      # not public/models
# YAML lint (any available): python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"
# Ordering: migrate must appear BEFORE `docker compose up -d` in the deploy script
```

Report: scripts parse, workflow YAML is valid, the secret names match the list
above, and migrate precedes `up -d` in the deploy script.
