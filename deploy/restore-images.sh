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