# Task 14 — Local refresh workflow (dev only)

**Goal:** `npm run local:refresh` rebuilds the local dataset from photos in
`test-cats/` through the **real** production pipeline (§9 guards + ONNX +
Sharp + SQLite), never mutating anything until every file passes;
`npm run dev:local` then serves it for browser use (grid, modal, likes,
comments, and real uploads) with no Docker and no secrets.

**Prereqs:** 01, 03, 04, 09 (`scripts/fetch-model.sh`), 13 (the `LOCAL_DEV`
bypass — required for the end-to-end acceptance). **Read first:** `CONTRACTS.md`
§2, §3 (`LOCAL_DEV` row + local-workflow paragraph), §5, §9, §12 (the three npm
scripts).

> Dev-only convenience. Not part of the production image or CI. Do not wire it
> into the deploy flow.

## Files you create

- `scripts/refresh-local.ts` — bundled by the existing `build:scripts` glob to
  `dist/scripts/refresh-local.mjs`; no build wiring changes.
- `test-cats/README.md` — exact content below.
- `tests/refreshLocal.test.ts`

## Files you modify (scoped exceptions, explicitly granted)

- `package.json` (owned by Task 00) — add **exactly** the three scripts from
  CONTRACTS §12 to `"scripts"` and change nothing else. The values must be
  byte-identical to §12 (Prettier normalizes key/value spacing; the value
  strings themselves must match §12 exactly):

  ```
  "local:model": "bash scripts/fetch-model.sh",
  "local:refresh": "npm run build:scripts && node dist/scripts/migrate.mjs && LOCAL_DEV=1 UPLOAD_DIR=./public/uploads node dist/scripts/refresh-local.mjs",
  "dev:local": "LOCAL_DEV=1 UPLOAD_DIR=./public/uploads astro dev"
  ```

- `.gitignore` — append exactly these two lines at the end:

  ```
  test-cats/*
  !test-cats/README.md
  ```

## `scripts/refresh-local.ts` — exact algorithm

Imports: `fs` from `node:fs` (default import — the tests spy on
`fs.existsSync`, so call it as a property access, never a named import),
`path` from `node:path`, `crypto` from `node:crypto`, `pathToFileURL` from
`node:url`, `db` from `../src/db/connection`, `cats`, `votes`, `comments` from
`../src/db/schema`, `detectMime` from `../src/validation/mime`, `validateCat`
from `../src/validation/isCat`, `processImage` and `deleteProcessedImages` from
`../src/lib/images`. No other imports, no new dependencies.

1. Export the single entry point:

   ```ts
   export async function refreshLocal(sourceDir?: string): Promise<void>;
   ```

   All aborts below `throw new Error(<exact message>)`. The CLI entry is
   guarded so tests can import the module without side effects — put this at
   the bottom of the file verbatim:

   ```ts
   const isCliEntry =
     process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

   if (isCliEntry) {
     refreshLocal().catch((err: unknown) => {
       console.error(err instanceof Error ? err.message : String(err));
       process.exit(1);
     });
   }
   ```

2. **Preflight (in this order, before touching anything):**
   1. Unless `process.env.LOCAL_DEV === '1'`, abort:
      `LOCAL_DEV=1 is required — run this via "npm run local:refresh"`
   2. Resolve `dbPath = path.resolve(process.env.DATABASE_PATH ?? './data/cats.db')`
      and `uploadDir = path.resolve(process.env.UPLOAD_DIR ?? './data/uploads')`.
      If either starts with `/app/data` or `/var/lib/cat-ranking`, abort:
      `Refusing to run against production path: <the offending resolved path>`
   3. If `fs.existsSync(path.resolve('models/mobilenetv2-cat.onnx'))` is
      `false`, abort:
      `Model missing: models/mobilenetv2-cat.onnx — run "npm run local:model" first`

3. **Enumerate** the source dir (`sourceDir ?? './test-cats'`), non-recursively:
   regular files only, skipping any name starting with `.`, plus `README.md`
   and `.gitkeep`; sort with the default `Array.prototype.sort()` (lexical). A
   missing dir counts as empty. If the resulting list is empty, abort:
   `No images found in <sourceDir> — add photos, then re-run`

4. **Phase 1 — validate all, mutate nothing.** For each file read its buffer
   and apply the §9 guards in contract order, recording one failure line
   `<filename>: <exact §9 string>` per failed file (first failing guard wins):
   1. `buf.byteLength > 10 * 1024 * 1024` → `File too large (max 10MB)`
   2. `detectMime(buf)` not one of `image/jpeg` / `image/png` / `image/webp` →
      `Unsupported format`
   3. extension (lowercased) not in `.jpg`/`.jpeg`/`.png`/`.webp` →
      `Unsupported file type`
   4. `await validateCat(buf)` is `false` → `We couldn't verify this is a cat`

   If any file failed, abort with the message
   `Validation failed — nothing was changed:` followed by one failure line per
   file, joined with `\n`. The previous dataset must be fully intact.

5. **Phase 2 — rebuild (only reached when every file passed):**
   1. Delete all rows in FK order via the shared `db`:
      `db.delete(comments).run(); db.delete(votes).run(); db.delete(cats).run();`
   2. `fs.mkdirSync(uploadDir, { recursive: true })`, then delete every file in
      `uploadDir` whose name matches `/_(thumb|full)\.webp$/`.
   3. Per file, in the sorted order:
      - `name = path.parse(filename).name.replace(/<[^>]*>/g, '').trim().slice(0, 60)`
        (the §9 cat-name sanitization applied to the filename stem);
      - `storageKey = crypto.randomUUID()`;
      - `const processed = await processImage(buf, storageKey);`
      - insert, mirroring the upload route's cleanup:

        ```ts
        try {
          db.insert(cats)
            .values({
              name,
              thumbnailPath: processed.thumbnailPath,
              imagePath: processed.imagePath,
            })
            .run();
        } catch (err) {
          await deleteProcessedImages(storageKey);
          throw err;
        }
        ```

      - print exactly `imported: <name>` for the inserted cat via
        `console.log`.

6. Finish by printing exactly `Done — <N> cats imported.` via `console.log`,
   where `<N>` is the number of inserted rows.

## `test-cats/README.md` — exact content

```markdown
# test-cats — local fixture photos

Drop cat photos (`.jpg`, `.jpeg`, `.png`, `.webp`, max 10 MB each) into this
folder, then run:

    npm run local:model      # once: fetch the ONNX model
    npm run local:refresh    # rebuild the local dataset from this folder
    npm run dev:local        # browse it at http://localhost:4321

Each refresh **replaces everything**: all cats, likes, and comments in the
local database and all generated images are deleted and rebuilt from the
photos currently in this folder. A cat's name is its filename without the
extension.

Every photo goes through the real production pipeline (size, format, and
extension guards, the ONNX cat check, Sharp WebP processing) — if any photo
fails, the refresh aborts and the previous dataset is left untouched.

In local dev every request uses one fixed user token, so you can like and
comment **once per cat** between refreshes. Everything in this folder except
this file is gitignored.
```

## `tests/refreshLocal.test.ts`

Mock **only** `validateCat`:
`vi.mock('../src/validation/isCat', () => ({ validateCat: vi.fn() }))`, and set
its resolved value per test (`true` by default). Everything else is real:
`tests/setup.ts` already gives each test file a temp `DATABASE_PATH` /
`UPLOAD_DIR`, and `applyMigrations()` / `resetDb()` / `makeImage()` come from
`tests/helpers.ts`. Import `{ refreshLocal }` statically — the CLI guard keeps
the import side-effect-free.

Shared scaffolding in the file:

- `beforeAll(applyMigrations)`; `beforeEach(resetDb)` plus wipe `UPLOAD_DIR`;
  `afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); })`.
- A fresh temp source dir per test (`fs.mkdtempSync`), removed afterwards;
  write fixture files into it with `makeImage()` (real Sharp JPEG/PNG/WebP
  buffers).
- `stubModel(present: boolean)` helper: `vi.spyOn(fs, 'existsSync')` with an
  implementation that returns `present` for any path ending in
  `mobilenetv2-cat.onnx` and delegates to the real `fs.existsSync` otherwise.
  Every test calls it (with `true` unless testing the missing-model abort) so
  no test depends on whether the gitignored model file exists on the machine.
- Unless the test says otherwise: `vi.stubEnv('LOCAL_DEV', '1')` and
  `stubModel(true)`.

Tests to write (names and assertions):

1. **happy path** — three files named `b.png`, `a.jpg`,
   `<b>Fluffy</b> the third.webp` → `refreshLocal(srcDir)` resolves; `cats` has
   3 rows in lexical file order (`<b>Fluffy</b> the third.webp` sorts first)
   with sanitized names (`Fluffy the third`, `a`, `b`); `UPLOAD_DIR` contains
   exactly 6 files matching `/_(thumb|full)\.webp$/`; `votes` and `comments`
   are empty.
2. **re-run replaces the dataset** — run twice with different source files;
   after the second run only the second run's rows exist and no WebP from the
   first run's storage keys remains.
3. **oversize rejected, prior data intact** — insert a cat via `insertCat()`
   first; source contains a `> 10 MB` `.jpg` buffer; rejects with a message
   containing `File too large (max 10MB)` and starting with
   `Validation failed — nothing was changed:`; the pre-existing row and
   `UPLOAD_DIR` are untouched.
4. **bad magic bytes rejected** — a file whose content is `RIFF_WAVE` (from
   helpers) named `x.webp` → message contains `x.webp: Unsupported format`;
   prior data intact.
5. **bad extension rejected** — a real JPEG buffer written as `x.gif` →
   message contains `x.gif: Unsupported file type`; prior data intact.
6. **not a cat rejected** — `validateCat` resolves `false` → message contains
   `We couldn't verify this is a cat`; prior data intact.
7. **missing flag aborts** — no `LOCAL_DEV` stub → rejects with
   `LOCAL_DEV=1 is required — run this via "npm run local:refresh"`; nothing
   mutated.
8. **production path aborts** — `vi.stubEnv('DATABASE_PATH', '/app/data/cats.db')`
   → rejects with
   `Refusing to run against production path: /app/data/cats.db`; nothing
   mutated.
9. **missing model aborts** — `stubModel(false)` → rejects with
   `Model missing: models/mobilenetv2-cat.onnx — run "npm run local:model" first`;
   nothing mutated.
10. **empty source dir aborts** — empty temp dir (or one containing only
    `README.md` and `.gitkeep`) → rejects with the
    `No images found in <sourceDir> — add photos, then re-run` message.
11. **insert-failure cleanup** — `vi.spyOn(db, 'insert')` throwing on its
    first call → `refreshLocal` rejects and `UPLOAD_DIR` contains no
    `*_thumb.webp` / `*_full.webp` files (the processed pair was cleaned up by
    `deleteProcessedImages`).

## Constraints

- No new dependencies. No changes to `src/` (Task 13 already made the bypass
  edits), no changes to `docker-compose.yml`, `deploy/`, CI, or `seed.ts`.
- Do not add `LOCAL_DEV` to `.env.example`, `tests/setup.ts`, or any deploy
  artifact.
- The npm script strings come from CONTRACTS §12 verbatim — if they differ
  from what you read there, stop and report.

## Acceptance check

```
npm test
npm run build
npm run typecheck
```

Then the manual end-to-end checklist (requires `MODEL_URL`/`MODEL_SHA256` for
the model fetch):

1. `npm run local:model`; put 2–3 real cat photos in `test-cats/`.
2. `npm run local:refresh` — prints one `imported: <name>` line per photo and
   the `Done — <N> cats imported.` summary. Run it a second time — same result,
   no duplicates.
3. `npm run dev:local` → at `http://localhost:4321` the grid renders the
   photos; the detail modal opens; a like and a comment both succeed.
4. Submit a new real cat photo through the UI: the real ONNX + Sharp pipeline
   runs, the row and both WebPs are created, and the `HX-Redirect: /` header
   fires.

Finish with `npx prettier --write` on the files you created/modified, then
`npm run format:check`, `npm run lint`, and `npm run lint:format-compat`.
Report pass/fail for each.
