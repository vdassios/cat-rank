# Task 03 — Image validation

**Goal:** magic-byte MIME detection and the ONNX cat classifier wrapper
(`validateCat`), semaphore-bounded.

**Prereqs:** 00. **Read first:** `CONTRACTS.md` §5 (mime/isCat), §9.
**Depends on interface:** `src/lib/semaphore.ts` (Task 02) — import it, do not
reimplement.

## Files you create

- `src/validation/mime.ts`
- `src/validation/isCat.ts`
- `src/validation/imagenet-labels.json`

## `src/validation/mime.ts`

- `detectMime(buf)` per CONTRACTS §5: inspect first 4 bytes.
  - `ffd8ff` → `image/jpeg`
  - `89504e47` → `image/png`
  - `52494646` → must also have bytes 8–11 == `57454250` (`WEBP`) → `image/webp`
  - else → `null`
- Exact hex table as above. No other formats.

## `src/validation/imagenet-labels.json`

- JSON array (or index→label map) of the 1000 ImageNet class labels. Provide the
  standard ImageNet-1k label list. The cat classes used for scoring are the
  Egyptian cat / tabby / tiger cat / Persian cat / Siamese cat indices —
  document which indices you sum in a comment in `isCat.ts`.

## `src/validation/isCat.ts`

- Load `models/mobilenetv2-cat.onnx` via `onnxruntime-node` once at
  module init (lazy/singleton session). In production the model is at
  `dist/models/mobilenetv2-cat.onnx`; resolve a path that works both in dev
  (`models/`) and built (`dist/models/`) — check both. **Never load from or
  place the model in `public/`** — Astro copies `public/` into `dist/client/`
  and would serve the model file to the internet (CONTRACTS §1).
- `validateCat(buf)`:
  1. Use Sharp to resize to 224×224, convert to the tensor layout MobileNetV2
     expects (RGB, normalized; document the exact preprocessing constants).
  2. Run inference inside a module-level `new Semaphore(2)` (`run()`), importing
     `Semaphore` from `../lib/semaphore`.
  3. Softmax the logits if needed, sum probabilities across the ~5 cat class
     indices, return `sum >= CAT_THRESHOLD`.
- Export `const CAT_THRESHOLD = 0.20;` and reference it (tunable later).

> If the real ONNX model is not present during your run, still implement fully
> and make the module import-safe (don't crash at import if the file is missing;
> fail only when `validateCat` is actually called without a model). Note this in
> your report.

## Constraints

- `validateCat` and `detectMime` signatures are fixed (CONTRACTS §5).
- Do not enforce file size / extension here — that lives in the upload route
  (Task 05). This task is MIME + cat-detection only.

## Acceptance check

```
npm run build
```
- `detectMime` returns correct types for crafted JPEG/PNG/WEBP byte prefixes and
  `null` for random bytes and for a `RIFF` buffer that is not `WEBP`.
- `isCat.ts` imports without throwing even if the model file is absent.

Report both, plus the cat class indices you summed and the preprocessing
constants you used.
