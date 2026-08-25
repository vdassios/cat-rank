#!/usr/bin/env bash
# Nightly backup verification: restore DB from R2 to a temp path + integrity check.
# Runs on the HOST (bash + sqlite3 required — provision.sh installs them).
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HC_URL="${HEALTHCHECK_RESTORE_URL:-}"

# --no-deps: don't drag the app service up via depends_on
docker compose run --rm --no-deps -v "$TMP:/restore" litestream \
  restore -o /restore/cats.db /app/data/cats.db

result="$(sqlite3 "$TMP/cats.db" 'PRAGMA integrity_check;')"
[ "$result" = "ok" ] || { echo "RESTORE VERIFY FAILED: $result" >&2; exit 1; }
sqlite3 "$TMP/cats.db" 'SELECT count(*) FROM cats;' >/dev/null

[ -n "$HC_URL" ] && curl -fsS -m 10 "$HC_URL" >/dev/null || true
echo "restore verify OK"