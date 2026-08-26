#!/usr/bin/env bash
# Download + SHA-256 verify the ONNX cat-validation model into the build context.
# Idempotent: skips download if a valid cached copy already exists.
# NB: target is models/ (non-public). Never put the model in the static-assets
# directory — Astro copies that into the client bundle and would serve the
# model to the internet.
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