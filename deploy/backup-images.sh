#!/bin/sh
# Daily append-only image backup to R2. NEVER use `sync` — copy is additive.
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