# Task 04 — Image processing

**Goal:** Sharp pipeline that turns an uploaded image buffer into a thumbnail +
full WebP pair on disk and returns their public paths.

**Prereqs:** 00. **Read first:** `CONTRACTS.md` §5 (images), §9 (filenames),
master plan § Image pipeline → Output specs.

## Files you create

- `src/lib/images.ts`

## `src/lib/images.ts`

Implement `processImage(buf, id)` per CONTRACTS §5:

1. Read `UPLOAD_DIR = process.env.UPLOAD_DIR` (default `./data/uploads`); create
   it if missing.
2. Build two outputs from `buf` using Sharp, **calling `.rotate()` first** so
   EXIF orientation is honored, and **without** `withMetadata()` (strip
   EXIF/GPS — privacy):
   - **thumbnail:** resize to width 300 (no enlargement), WebP quality 80 →
     `{id}_thumb.webp`
   - **full:** resize so the longest side ≤ 1200 (no enlargement), WebP quality
     85 → `{id}_full.webp`
3. Write both into `UPLOAD_DIR`. Filenames use the numeric `id` only (never user
   input).
4. Keep Sharp's default `limitInputPixels` ON (decompression-bomb protection).
   Do not disable it.
5. Return:
   ```ts
   { thumbnailPath: `/uploads/${id}_thumb.webp`, imagePath: `/uploads/${id}_full.webp` }
   ```

> Note the path asymmetry: files are written to `UPLOAD_DIR` on disk, but the
> returned paths are the public `/uploads/...` URLs nginx serves. Both are
> required by Task 05 / the schema.

## Constraints

- No validation here (size/MIME/cat detection live in Tasks 03 + 05). Assume
  `buf` is already a validated raster image.
- Only Sharp + Node `fs`/`path`. Signature fixed.

## Acceptance check

Write a throwaway script (delete after) that calls `processImage(buf, 999)` with
a real JPEG buffer and confirms:
```
UPLOAD_DIR=./data/uploads node <script>
ls ./data/uploads/999_thumb.webp ./data/uploads/999_full.webp
```
- both files exist and are valid WebP (e.g. `file` reports RIFF/WEBP),
- thumbnail width is 300, full longest side ≤ 1200,
- returned object matches the contract.

Report dimensions and that metadata was stripped. Clean up the test files.
