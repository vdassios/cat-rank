# Task SEED — Sample data (dev only)

**Goal:** a small, idempotent seed script that inserts 3 sample cats (with
placeholder WebP images that are actually served in dev) and a few likes, so
Tasks 05–07 can be exercised end-to-end **without** going through a real upload
or the ONNX validator.

**Prereqs:** 01 (DB layer + migrations). **Read first:** `CONTRACTS.md`
§3, §4, §6, §9 (filenames), §10 (like txn).

> Dev-only convenience. Not part of the production image or CI. Do not wire it
> into the deploy flow.

## Files you create

- `scripts/seed.ts` — built/run the **same way** Task 01 runs `scripts/migrate.ts`
  (e.g. compiled to `dist/scripts/seed.mjs`, run with `node dist/scripts/seed.mjs`).
  Use the identical run mechanism so there's no new tooling.

## What the script does

1. Import `db` + `cats`/`votes` tables from `src/db` (do **not** open a second
   connection — reuse `src/db/connection.ts`).
2. Ensure the dev image dir exists and **is served by `astro dev`**: write
   placeholder images to **`public/uploads/`** (Astro serves `public/uploads/x`
   at `/uploads/x` in dev). Create the dir if missing.
   - In production nginx serves `/uploads/` from the real volume; this
     `public/uploads/` copy exists only so the dev server can display seeded
     images. `public/uploads/` is already in `.gitignore` — verify, and append
     it only if missing.
3. For each of 3 sample cats:
   - Insert the `cats` row first with placeholder paths to obtain its
     autoincrement `id` (mirror the upload route's "insert → get id → name files
     by id" approach; filenames use the numeric id only — CONTRACTS §9).
   - Generate two placeholder WebP files with **Sharp** (already a dependency —
     no new deps): a 300px thumbnail (`{id}_thumb.webp`) and a 1200px full
     (`{id}_full.webp`). A solid color or simple gradient with the cat's name
     drawn on it is fine; no real photo or network fetch.
   - Update the row so `thumbnail_path = /uploads/{id}_thumb.webp` and
     `image_path = /uploads/{id}_full.webp` (CONTRACTS §4 path format).
4. Insert a handful of `votes` (distinct `user_token` + `ip_ua_hash` values) via
   the like transaction semantics (CONTRACTS §10) so `likes_count` differs across
   cats — give them e.g. 5, 8, 3 likes so the hero/leaderboard ordering and the
   "top cat excluded from grid" rule are visibly exercised.

## Idempotency

- Running the script twice must not duplicate or error. Make it safe by either
  clearing the three sample rows + their files first, or upserting on a known
  marker (e.g. names `Sample Cat 1..3`). State which approach you chose.

## Sample data shape

| name         | likes |
| ------------ | ----- |
| Sample Cat 1 | 5     |
| Sample Cat 2 | 8     |
| Sample Cat 3 | 3     |

(Cat 2 should become the hero; Cats 1 and 3 appear in the grid.)

## Constraints

- No new dependencies (Sharp only). No network access. Dev-only.
- Do not modify `package.json` (Task 00 owns it). If a convenience npm script is
  desired, note it in your report for Task 00 to add — do not edit it yourself.
- Use `process.env.DATABASE_PATH` (same DB the app/migrations use).

## Acceptance check

```
npm run build
DATABASE_PATH=./data/cats.db node dist/scripts/migrate.mjs   # if not already migrated
DATABASE_PATH=./data/cats.db node dist/scripts/seed.mjs
sqlite3 ./data/cats.db "SELECT id,name,likes_count FROM cats ORDER BY likes_count DESC;"
ls public/uploads/                                            # 6 webp files
# run again — still 3 cats, no duplicates / no error
DATABASE_PATH=./data/cats.db node dist/scripts/seed.mjs
sqlite3 ./data/cats.db "SELECT count(*) FROM cats;"           # 3
```

Then `npm run dev` and confirm the hero (Sample Cat 2), the grid (Cats 1 & 3),
and the leaderboard render with visible placeholder images. Report results.
