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