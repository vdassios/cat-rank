# Task 10 — Backup & restore scripts

**Goal:** the three backup/restore shell scripts (daily image backup, one-off
image restore, nightly restore verification).

**Prereqs:** 00. **Read first:** master plan `CAT_RANKING_PLAN_V4.md`
§ Deployment & backups → `deploy/backup-images.sh`, `deploy/restore-images.sh`
and `deploy/verify-backup.sh`; `CONTRACTS.md` §3. (V4, not V3 — V4 changed
shells and paths.)

## Files you create (verbatim from the V4 master plan unless noted)

- `deploy/backup-images.sh` — copy from V4. Daily **append-only**
  `rclone copy` with `--backup-dir R2:cat-ranking/uploads-archive/<stamp>`.
  Pings `HEALTHCHECK_IMAGES_URL` on success. `chmod +x`.
  **Must be POSIX `sh` (`#!/bin/sh`, `set -eu`)** — it runs inside the
  `rclone/rclone` (Alpine) container, which has **no bash and no curl**; the
  health ping uses busybox `wget`.
- `deploy/restore-images.sh` — copy from V4. Disaster-recovery restore of the
  uploads volume from R2 via a **one-off `docker run` with a read-write volume
  mount** — the compose service mounts the volume `:ro`, so restore cannot go
  through it. Runs on the host from the repo root; sources `R2_*` from `.env`.
  `chmod +x`.
- `deploy/verify-backup.sh` — copy from V4. Restores the DB to a temp path via
  `docker compose run --rm --no-deps litestream restore -o … /app/data/cats.db`
  (**`/app/data/…`**, matching litestream.yml; **`--no-deps`** so the run
  doesn't recreate the app via `depends_on`), runs `PRAGMA integrity_check`, a
  sanity `SELECT count(*)`, pings `HEALTHCHECK_RESTORE_URL` on success.
  Runs on the **host** (bash + sqlite3 — installed by Task 12's provision
  script). `chmod +x`.

## Hard rules (do not deviate)

- **Never `rclone sync`** — only `rclone copy` (+ `--backup-dir`). `sync` would
  propagate a local wipe to the backup and destroy it. This is the single most
  important rule in this task.
- `backup-images.sh`: `#!/bin/sh` + `set -eu` (container has no bash).
  `verify-backup.sh`: bash is fine (runs on the host).
- Env var names exactly per CONTRACTS §3 (`HEALTHCHECK_IMAGES_URL`,
  `HEALTHCHECK_RESTORE_URL`); treat them as optional (skip the ping if unset).
- The image-backup source inside the rclone container is the uploads volume
  mounted at `/data` (read-only); match the compose mount in Task 08.

## Constraints

- No real bucket credentials or URLs in the files — they come from env.
- Scripts have shebangs and are executable.

## Acceptance check

```
sh -n deploy/backup-images.sh && sh -n deploy/restore-images.sh
bash -n deploy/verify-backup.sh
test -x deploy/backup-images.sh && test -x deploy/restore-images.sh && test -x deploy/verify-backup.sh
grep -n "rclone sync" deploy/*.sh                 # MUST return nothing
grep -n "rclone copy" deploy/backup-images.sh     # MUST match
head -1 deploy/backup-images.sh                   # MUST be #!/bin/sh (no bash)
grep -n "no-deps" deploy/verify-backup.sh         # MUST match
grep -n "/app/data/cats.db" deploy/verify-backup.sh   # MUST match
```
Report: all three parse, are executable, use `copy` not `sync`, and
`backup-images.sh` is pure POSIX sh.
