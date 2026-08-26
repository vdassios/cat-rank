# TESTING — master TDD plan (supersedes the scope note in `11-tests.md`)

This file is the authoritative test plan for the whole project. It is split
into ordered units: **T-INFRA** (shared infrastructure), then **T00–T12**, one
per implementation task. Units T-INFRA through T03 cover code that already
exists and are implemented retroactively; units T04–T12 are **written before
or together with their implementation task** (TDD: the executing agent writes
the spec first, watches it fail, then implements).

Rules from `README.md` and `CONTRACTS.md` apply unchanged: exact signatures,
exact error strings, no new dependencies, repository formatter/linter, honest
acceptance reporting. Every unit below ends with the same acceptance check:

```
npm test          # all specs green, offline, deterministic
```

**Global constraints (all units):**

- Tests live in `tests/*.test.ts`, run by Vitest (`npm test` → `vitest run`).
- No network, no real ONNX model, no real R2, no Docker. Anything that would
  need those is mocked or asserted statically on file contents.
- Never touch `./data/` or any repo-local path at runtime — all runtime
  artifacts go under a per-file temp dir created by `tests/setup.ts`.
- Sharp is real (it works offline and generates fixtures); `onnxruntime-node`
  is always mocked; the model file is never required.
- Do not modify `src/` to make something testable. If it genuinely isn't
  testable as contracted, stop and report.

---

## T-INFRA — test infrastructure

**Files:** `vitest.config.ts`, `tests/setup.ts`, `tests/helpers.ts`; edit
`package.json` (`"test": "vitest run"` — drop `--passWithNoTests` once the
first spec exists; deliberate, flagged edit to a Task-00-owned file).

**Why setup works:** Vitest `setupFiles` run before each test file's module
graph is imported, and each test file gets an isolated module registry. Env
vars set in `tests/setup.ts` are therefore visible to modules that read env
**at import time** (`src/db/connection.ts` opens the DB at import;
`src/lib/auth.ts` throws at import without `HMAC_SECRET`), and each test file
gets its own private temp DB.

1. `vitest.config.ts`:

   ```ts
   import { getViteConfig } from 'astro/config';

   export default getViteConfig({
     test: {
       include: ['tests/**/*.test.ts'],
       environment: 'node',
       setupFiles: ['tests/setup.ts'],
     },
   });
   ```

   Keep default isolation (do not set `isolate: false` or a shared pool) —
   module-level state (DB connection, rate-limit buckets) must stay per-file.

2. `tests/setup.ts` — module body (no exports needed):
   - `const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kot-test-'));`
   - `process.env.DATABASE_PATH = path.join(tmp, 'test.db');`
   - `process.env.UPLOAD_DIR = path.join(tmp, 'uploads');` and `mkdirSync` it.
   - `process.env.HMAC_SECRET = 'test-hmac-secret';`
   - `process.env.ALLOWED_ORIGIN = 'http://localhost:4321';`

3. `tests/helpers.ts` exports:
   - `applyMigrations(): void` — `migrate(db, { migrationsFolder: './drizzle/migrations' })`
     using `drizzle-orm/better-sqlite3/migrator` and the `db` from
     `src/db/connection` (cwd is the repo root under Vitest).
   - `resetDb(): void` — `DELETE FROM votes; DELETE FROM comments; DELETE FROM cats;`
     via `rawDb`.
   - `insertCat(name?): number` — insert a complete fixture row with fixed test
     image paths, return id.
   - Buffer fixtures for mime tests (hand-crafted magic bytes, see T03).
   - `makeImage(width, height, format, opts?): Promise<Buffer>` — sharp-generated
     solid-color image (used by T03 preprocessing and T04).
   - (Added in T05) `renderPartialRoute(...)` — see T05.

---

## T00 — scaffold guards (`tests/scaffold.test.ts`)

Static regression net for the scaffold's security-relevant invariants
(V4 fatal fix #6 — build-context leakage):

- `public/htmx.min.js` exists and is non-empty.
- `.dockerignore` exists; contains the exact lines `node_modules`, `.env`,
  `data`, `.git`; contains **no** line for `models` or `drizzle` (both must
  ship in the build context).
- `.gitignore` contains the exact line `models/`.

Read files with `fs.readFileSync(...).split('\n')` and compare whole lines —
never substring matching (`data` must not match `database/`).

---

## T01 — database layer (`tests/db.test.ts`)

Import order matters: `tests/setup.ts` has already set `DATABASE_PATH`;
import `{ db, rawDb }` from `../src/db/connection`, then `applyMigrations()`
in `beforeAll`, `resetDb()` in `beforeEach`.

**Pragmas** (via `rawDb.pragma('x', { simple: true })`):

- `journal_mode` → `'wal'`
- `wal_autocheckpoint` → `0` (Litestream owns checkpointing — regression-guard)
- `busy_timeout` → `5000`
- `foreign_keys` → `1`

**Schema** (query `sqlite_master`):

- tables `cats`, `votes`, `comments` exist.
- indexes `idx_cats_likes`, `idx_cats_created`, `idx_votes_cat`,
  `idx_comments_cat` exist.

**Defaults:** insert a cat providing only `name` + paths → `likes_count === 0`
and `created_at` is a non-empty string.

**Constraints** — each case asserts the insert throws and
`err.code.startsWith('SQLITE_CONSTRAINT')`:

- votes: same `(cat_id, user_token)` twice.
- votes: same `(cat_id, ip_ua_hash)` with a **different** `user_token`
  (the cookie-clearing defense).
- comments: same `(cat_id, user_token)` twice.
- foreign keys: vote and comment referencing `cat_id = 999999` both rejected.

**Dedupe precursors (CONTRACTS §10 ground rules):**

- same `user_token` may vote on two _different_ cats (2 rows).
- two distinct `(user_token, ip_ua_hash)` pairs on one cat → 2 rows.

---

## T02 — auth & security

### `tests/auth.test.ts`

- `verifyToken(signToken(t)) === t` for `t = issueToken()`.
- Tampered: flip a character in the signed value → `verifyToken` returns `false`.
- Garbage string (`'not-a-signed-token'`) → `false`.
- `issueToken()` matches UUID regex and two calls differ.
- `createIpUaHash('1.2.3.4', 'UA')`:
  - matches `/^[0-9a-f]{32}$/`,
  - deterministic (two calls equal),
  - equals `createHash('sha256').update('1.2.3.4|UA').digest('hex').slice(0, 32)`,
  - changes when either the IP or the UA changes.
- `COOKIE_NAME === 'user_token'`; `COOKIE_OPTS` deep-equals
  `{ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 31536000 }`.
- Import guard: in one test, `vi.resetModules()`, save + `delete
process.env.HMAC_SECRET`, then
  `await expect(import('../src/lib/auth')).rejects.toThrow(/HMAC_SECRET/)`;
  restore the env var in `finally`.

### `tests/csrf.test.ts`

`checkOrigin` reads `ALLOWED_ORIGIN` at **call** time — use
`vi.stubEnv('ALLOWED_ORIGIN', ...)` + `vi.unstubAllEnvs()` in `afterEach`.
Build inputs as `new Request('http://x/', { headers: { ... } })`.

- `Origin: http://localhost:4321` with matching env → `true`.
- `Origin: https://evil.example` → `false`.
- No `Origin`, no `Referer` → `false`.
- No `Origin`, `Referer: http://localhost:4321/some/page` → `true`
  (origin extracted from the full URL).
- `Origin: not a url` → `false` (no throw).

### `tests/semaphore.test.ts`

Deferred-promise pattern (no timers): create `n` tasks whose promises resolve
only when the test calls their stored `resolve`; each task increments/
decrements a `running` counter and records `peak`.

- `new Semaphore(2)` + 5 tasks: `peak === 2`, all 5 eventually resolve.
- FIFO: tasks start in submission order as slots free up.
- Rejection releases the slot: task 1 rejects → queued task still runs;
  the `run()` caller of the rejecting task gets the rejection.
- Resolved values propagate (`await run(() => Promise.resolve(42)) === 42`).

### `tests/rateLimit.test.ts`

`vi.useFakeTimers()` + `vi.setSystemTime(...)` in `beforeEach`,
`vi.useRealTimers()` in `afterEach`. Module state persists across tests in
the file — use a unique key per test (e.g. derived from the test name).

- calls 1…`limit` → `true`; call `limit + 1` → `false`.
- advance time past `windowMs` → allowed again.
- denied attempts are not recorded: exhaust the limit, hammer 10 more denied
  calls, advance one window → immediately allowed (a recorded denial would
  extend the lockout).
- two different keys don't interfere.

### `tests/middleware.test.ts`

`src/middleware.ts` imports the virtual module `astro:middleware` — mock it
at the top of the file:

```ts
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: unknown) => fn,
}));
```

Build a minimal fake context per test:
`{ request: new Request(url, { headers }), cookies: { get: vi.fn(), set: vi.fn() }, locals: {}, clientAddress: '10.0.0.9' }`
and `next = vi.fn(() => new Response())`. Cast to `any` for the call. Cases:

- `X-Real-IP: 203.0.113.7` → `locals.clientIp === '203.0.113.7'`.
- no `X-Real-IP` → `locals.clientIp === '10.0.0.9'` (connection fallback).
- **`X-Forwarded-For: 6.6.6.6` and no `X-Real-IP` → `locals.clientIp` is the
  connection address** — XFF must be ignored (spoofable; V4 security fix).
- no cookie → `locals.userToken` is a UUID; `cookies.set` called once with
  `COOKIE_NAME`, a value that `verifyToken`s back to that token, and
  `COOKIE_OPTS`.
- valid cookie (`cookies.get` returns `{ value: signToken(t) }`) →
  `locals.userToken === t`, `cookies.set` **not** called.
- tampered cookie value → new token issued, `cookies.set` called.
- `next` called exactly once; its response is returned.

---

## T03 — image validation

### `tests/mime.test.ts`

Hand-crafted buffers (helpers), exact expectations:

- `ff d8 ff e0 …` (JFIF) → `'image/jpeg'`; `ff d8 ff e1 …` (Exif) → `'image/jpeg'`.
- `89 50 4e 47 0d 0a 1a 0a` → `'image/png'`.
- 12-byte `RIFF` + 4 arbitrary size bytes + `WEBP` → `'image/webp'`.
- `RIFF` + size + `WAVE` → `null` (RIFF alone is not WebP).
- `RIFF`-prefixed buffer shorter than 12 bytes → `null`.
- buffer shorter than 4 bytes → `null`; empty buffer → `null`.
- random bytes (`00 01 02 03 …`) → `null`.
- an SVG text buffer (`<svg …>`) → `null` (SVG never sniffs as a raster type).

### `tests/isCat.test.ts`

`validateCat` caches the ONNX runtime and session in module state, so every
test uses `vi.resetModules()` + a fresh
`await import('../src/validation/isCat')`. Mocks (top of file):

- `vi.mock('onnxruntime-node', ...)`: export a fake `Tensor` class capturing
  `(type, data, dims)`, and `InferenceSession: { create: vi.fn() }` resolving
  to a configurable fake session
  `{ inputNames: ['input'], outputNames: ['output'], run: vi.fn() }` whose
  `run` resolves `{ output: { data: <Float32Array(1000) set per test> } }`.
- `vi.mock('node:fs', ...)`: spread `importActual`, override `existsSync` to
  return `true` for paths containing `mobilenetv2-cat.onnx` (configurable so
  the "model missing" test can restore real behavior).

Input fixture: real 32×32 JPEG from `makeImage` (sharp is real). Cases:

- logits all `0` → uniform softmax → cat sum `5/1000 = 0.005 < 0.2` → `false`.
- `logits[281] = 10`, rest `0` → cat sum ≈ `0.956 ≥ 0.2` → `true`.
- `CAT_THRESHOLD === 0.2`.
- the `Tensor` passed to `session.run` has `dims` `[1, 3, 224, 224]` and
  `type` `'float32'`.
- concurrency cap: make `session.run` block on a deferred promise, fire 5
  `validateCat()` calls, flush microtasks → at most 2 `run` invocations in
  flight before releasing; all 5 settle after release.
- model missing (`existsSync` → `false` for the model paths): the module
  **imports without throwing**, and `validateCat(buf)` rejects with
  `/ONNX model not found/`.

---

## T04 — image processing (`tests/images.test.ts`) — write BEFORE Task 04 code

Real sharp, real files under `process.env.UPLOAD_DIR` (temp). Fixture:
`makeImage(2000, 1000, 'jpeg')` piped through
`sharp(...).withMetadata({ orientation: 6 })` so EXIF rotation is testable.

- `processImage(buf, '550e8400-e29b-41d4-a716-446655440000')` writes exactly
  `550e8400-e29b-41d4-a716-446655440000_thumb.webp` and
  `550e8400-e29b-41d4-a716-446655440000_full.webp` into `UPLOAD_DIR`.
- Returned object equals
  `{ thumbnailPath: '/uploads/550e8400-e29b-41d4-a716-446655440000_thumb.webp', imagePath: '/uploads/550e8400-e29b-41d4-a716-446655440000_full.webp' }`
  (public URL paths, not disk paths — the contract's deliberate asymmetry).
- Both outputs sniff as `image/webp` via our own `detectMime` (reuse T03).
- `sharp(thumbFile).metadata()`: `width === 300`.
- Full: `Math.max(width, height) <= 1200`.
- EXIF orientation honored: with orientation 6 the output's aspect flips
  (input 2000×1000 → full is portrait, 600×1200).
- Metadata stripped: output `metadata().exif` is `undefined`.
- No enlargement: `makeImage(100, 80, 'jpeg')` → thumb width stays 100.
- `UPLOAD_DIR` missing (rm -rf it first) → `processImage` recreates it.
- If either Sharp output rejects, neither final file remains.
- `deleteProcessedImages(storageKey)` removes both files, tolerates either file
  already being absent, and rejects filesystem errors other than `ENOENT`.

---

## T05 — API routes — write together with Task 05, run against real handlers

Render the `.astro` partial route pages with Astro's Container API; call
`/health` (the only remaining `.ts` endpoint) directly — no dev server. The
Container API is experimental but is used here only as Astro's test harness;
production code is forbidden from importing it by CONTRACTS §8.

Extend `tests/helpers.ts` with `renderPartialRoute`. `AstroContainer` is an
**instance** factory, not a static namespace — import the experimental alias and
`create()` it before rendering. Copy this implementation as-is:

```ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

export async function renderPartialRoute(
  Page: AstroComponentFactory,
  opts: {
    request: Request;
    params?: Record<string, string>;
    locals?: Partial<App.Locals>;
  },
): Promise<Response> {
  const container = await AstroContainer.create();
  return container.renderToResponse(Page, {
    routeType: 'page',
    partial: true,
    request: opts.request,
    params: opts.params ?? {},
    locals: { userToken: 'u1', clientIp: '1.1.1.1', ...opts.locals },
  });
}
```

Import the page under test as its default export, e.g.
`import CatsIndex from '../src/pages/api/cats/index.astro';`, and pass that as
`Page`.

Note `renderToResponse` (not `renderToString`) — the route pages return bare
`Response` objects for their error paths, and only the Response form preserves
status codes and the `HX-Redirect` header.

Real migrated temp DB (T-INFRA). Mock only other tasks' module boundaries:

```ts
vi.mock('../src/validation/isCat', ...)   // validateCat: controllable resolved boolean
vi.mock('../src/lib/images', ...)         // processImage + deleteProcessedImages
```

Multipart bodies: native `FormData` + `File` (Node 22), passed to
`new Request(url, { method: 'POST', body: form, headers: { Origin: ... } })`.

Spec files and required cases:

**`tests/guards.test.ts`** — POST `/api/cats` upload guards, order-sensitive,
**exact** CONTRACTS §9 body strings:

1. 10 MB + 1 byte file → 400 `File too large (max 10MB)`.
2. random bytes named `x.jpg` → 400 `Unsupported format`.
3. valid JPEG bytes named `x.gif` → 400 `Unsupported file type`.
4. SVG (text buffer named `x.svg`, or svg mime) → 400 `Unsupported format`
   (SVG has no raster magic bytes, so the MIME guard rejects it; there is no
   `SVG files not allowed` response — see CONTRACTS §9).
5. valid JPEG named `x.jpg`, `validateCat` → false → 400
   `We couldn't verify this is a cat`.
6. Short-circuit: in case 2, `validateCat` was **never called**.
7. Success path: `validateCat` → true, `processImage` → fake paths → 200 with
   header `HX-Redirect: /`, cat row exists with sanitized name + real paths;
   `processImage` receives a canonical UUID storage key and observes no cat row
   before it resolves.
8. Processing failure: `processImage` rejects → response 500 and the cats table
   remains empty (no placeholder row was inserted).
9. Insert failure: install a temporary SQLite `BEFORE INSERT` trigger that
   raises `FAIL`; response is 500, no cat row exists, and
   `deleteProcessedImages(storageKey)` was called.
10. Missing `Origin` header → 403 (before any guard).

**`tests/votes.test.ts`** — POST `/api/cats/[id]/like`, CONTRACTS §10:

- same `userToken` likes twice → `likes_count === 1`, second response still
  200 (idempotent, returns liked button).
- different `userToken`, same `clientIp`+UA (same `ip_ua_hash`) →
  `likes_count === 1`.
- two distinct users (different token AND ip) → `likes_count === 2`.
- foreign Origin → 403, no row inserted.
- nonexistent cat id → 404.

**`tests/comments.test.ts`** — `/api/cats/[id]/comments`:

- POST empty / whitespace-only `text` → 400 `Comment cannot be empty`.
- POST 501 chars → 400 `Comment too long (max 500)`; exactly 500 → accepted.
- `<b>hi</b> <script>x</script>` → stored text is `hi` + stripped remainder
  (apply `replace(/<[^>]*>/g, '').trim()` semantics); a text that becomes
  empty after stripping → `Comment cannot be empty`.
- second POST by same user on same cat → 400
  `You already commented on this cat`.
- **Constraint mapping (not just the pre-check).** Racing two real requests is
  not reproducible, so force the constraint deterministically with a trigger:
  the pre-check finds nothing, the insert still fails, and the route must
  answer `400 You already commented on this cat` (never 500). Verbatim:

  ```ts
  rawDb.exec(`CREATE TRIGGER dup_guard BEFORE INSERT ON comments
    BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed'); END;`);
  try {
    const res = await postComment({ catId, userToken: 'fresh-user', text: 'hi' });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('You already commented on this cat');
  } finally {
    rawDb.exec('DROP TRIGGER dup_guard');
  }
  ```

  `RAISE(ABORT)` surfaces as `code === 'SQLITE_CONSTRAINT_TRIGGER'`, which is
  why CONTRACTS §10 matches the `SQLITE_CONSTRAINT` **prefix** rather than one
  exact code. An implementation that compares against `'SQLITE_CONSTRAINT_UNIQUE'`
  alone fails this test — that is intended.

- Success body shape: contains the refreshed first-10 list **and**
  `id="comment-form"` with `hx-swap-oob="true"` and the text `comment posted`;
  the response must not contain `id="comment-list"` at all (that container lives
  in `CatModal`, not in this fragment).
- GET pagination: insert 11 comments (distinct users) → page 1 has 10
  `created_at ASC`, page 2 has 1; `nextPage` null on the last page.
- foreign Origin on POST → 403.

**`tests/routes.test.ts`** — the rest:

- `/health`: normal → 200, body `{"status":"ok"}`; `UPLOAD_DIR` removed →
  503 `unhealthy`.
- GET `/api/cats`: 13 cats + one clear top cat → page 1 returns 12 tiles,
  **top cat excluded**, newest first; page 2 → remainder, `nextPage` null.
- GET `/api/cats/[id]`: 404 for missing id; for a liked cat the fragment
  reflects `liked`; for an already-commented user the form is replaced by the
  notice (`canComment` false).
- **Per-cat scoping:** with user `u1` having liked _and_ commented on cat 1,
  `GET /api/cats/2` for the same user must render unliked and `canComment`
  true. This fails loudly if any handler chains `.where()` instead of using
  `and()` (CONTRACTS §8).
- `partial` export — one table-driven case, exactly these five modules:

  ```ts
  import * as catsIndex from '../src/pages/api/cats/index.astro';
  import * as catDetail from '../src/pages/api/cats/[id]/index.astro';
  import * as catLike from '../src/pages/api/cats/[id]/like.astro';
  import * as catComments from '../src/pages/api/cats/[id]/comments.astro';
  import * as submitForm from '../src/pages/api/submit-form.astro';

  it.each([catsIndex, catDetail, catLike, catComments, submitForm])(
    'exports partial = true',
    (mod) => expect(mod.partial).toBe(true),
  );
  ```

  A missing export silently turns every fragment into a full document.

- `/api/submit-form` gets **no render test**. Rendering a `client:load` island
  through the Container API requires registering the Preact server _and_ client
  renderers on the container, which is more setup than it is worth here — the
  `partial` assertion above plus the T07 manual check (item 6) cover it. Do not
  add a dependency or a jsdom environment to test it.

---

## T06 — UI components (`tests/components.test.ts`) — with Task 06

Use Astro's built-in Container API (no new dependency):

```ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
const container = await AstroContainer.create();
const html = await container.renderToString(CatCard, { props: { cat } });
```

This experimental API is permitted only in tests. Production routes render
Astro components through `.astro` partial pages and must not import it.

- `CatCard`: contains `hx-get="/api/cats/<id>"` and the ★ count.
- `LikeButton`: `hx-post="/api/cats/<id>/like"`, `hx-swap="outerHTML"`.
- `Sentinel`: `hx-trigger="revealed"`, `hx-swap="afterend"`, given URL.
- `CommentForm`: `hx-post="/api/cats/<id>/comments"`,
  `hx-target="#comment-list"`, `hx-swap="innerHTML"`.
- `CommentList`: renders items + `Sentinel` only — its output contains **no**
  `id="comment-list"` (that container belongs to `CatModal`).
- `CatModal`: output contains exactly one `id="comment-list"` and one
  `id="comment-form"`.
- **Escaping:** a cat named `<script>alert(1)</script>` and a comment with the
  same text render with `&lt;script&gt;` — raw `<script>` must NOT appear in
  the HTML of `Hero`, `CatCard`, or `CommentItem`.
- `index.astro` output contains ids `modal`, `modal-body`, `cat-grid`,
  `sidebar`, `sidebar-toggle`, `sidebar-backdrop`, and the htmx `<script>` tag
  with an `integrity="sha384-` attribute.

If the Container API cannot render a component due to Astro internals
(islands), skip that one component with a comment — do not add jsdom or any
new dependency.

## T07 — frontend JS — manual checklist only

No unit tests: DOM/touch behavior would need a browser or jsdom (a new
dependency, forbidden by CONTRACTS §11). After Task 07, verify manually in a
browser and report each item:

1. Tile click → modal opens (after HTMX swap into `#modal-body`).
2. Backdrop / `data-close-modal` click → modal closes.
3. ☰ toggles the sidebar; backdrop click closes it.
4. Swipe from right edge opens; swipe right closes; a swipe starting mid-screen
   does nothing (activation zone ~20px).
5. `/ui.js` loads with no console errors and no CSP violations.
6. Submit modal: picking a file shows the client-side preview and the size/type
   check fires — this is the end-to-end proof that the `SubmitForm` island
   hydrated from the `/api/submit-form` partial.
7. Posting a comment refreshes the list **and** swaps the form for the
   "comment posted" notice in one response (the `hx-swap-oob` path).

---

## T08 + T09 + T10 — deploy artifacts, CI, backup scripts (`tests/artifacts.test.ts`)

Static file-content assertions that lock in every V3→V4 deploy-fatal and
security fix. Structure: one `describe` per artifact, guarded with
`describe.skipIf(!fs.existsSync(<path>))(...)` so the suite is green before
those tasks land and arms itself automatically as each file appears.

**`docker-compose.yml` (repo root — assert the path itself):**

- exists at repo root, NOT under `deploy/`.
- litestream service `depends_on` app with `condition: service_healthy`
  (litestream waits for the app, never the reverse).
- both app and litestream mount `./data` and reference `/app/data`.
- app env maps `LITESTREAM_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}` (and secret).
- every sidecar image pinned: `litestream/litestream:0.3.13`,
  `nginx:1.27-alpine`, `rclone/rclone:1.67`, `certbot/certbot:v2.11.0` —
  and no `:latest` anywhere.
- certbot entrypoint renews with `--webroot` (never `--standalone`).

**`deploy/Dockerfile`:**

- both stages `FROM node:22-bookworm-slim`; the string `alpine` absent.
- `COPY --from=litestream/litestream:0.3.13` present.
- `COPY models/mobilenetv2-cat.onnx ./dist/models/` present (never `public/`).
- `COPY --from=builder /app/drizzle ./drizzle` present.

**`deploy/litestream.yml`:** `path: /app/data/cats.db` (equal to the compose
`DATABASE_PATH`), `sync-interval: 1s`, `retention: 168h`.

**`deploy/nginx.conf`:**

- `include /etc/nginx/mime.types;` present.
- `Strict-Transport-Security` present; `http2 on;` present and the deprecated
  `listen 443 ssl http2` absent.
- `set_real_ip_from` absent; `X-Forwarded-For` absent;
  `proxy_set_header X-Real-IP $remote_addr` present.
- `location /uploads/` re-declares `X-Content-Type-Options nosniff`.
- a rate-limited `location = /health` block exists.

**`.github/workflows/deploy.yml`:** `migrate.mjs` line appears **before**
`docker compose up -d` (assert index order); `fetch-model.sh` runs before the
docker build step; `node-version: '22'`.

**`scripts/fetch-model.sh`:** targets `models/mobilenetv2-cat.onnx`; contains
`sha256sum --check`; the string `public/` absent.

**`deploy/backup-images.sh`:** first line `#!/bin/sh` (never bash); `set -eu`;
contains `rclone copy` and `--backup-dir`; **`rclone sync` absent anywhere in
`deploy/`** (the single most important backup rule); pings via `wget` (the
rclone image has no curl).

**`deploy/verify-backup.sh`:** contains `--no-deps`, `PRAGMA integrity_check`,
and restores from `/app/data/cats.db`.

Optional extra checks (run manually / in CI shell steps, NOT in `npm test`,
no new npm deps): `docker compose config -q`, `sh -n deploy/*.sh`,
`shellcheck`, `actionlint`.

## T12 — host setup — review checklist only

`provision.sh` mutates a host; no vitest coverage. Verification is
`sh -n deploy/provision.sh` (syntax) plus the review checklist in the task
file (idempotency: every step checks before changing; UFW allows only
22/80/443; sshd drop-in; cron line matches the master plan).

---

## Execution order recap

| Unit    | When                             | Status      |
| ------- | -------------------------------- | ----------- |
| T-INFRA | now                              | retroactive |
| T00–T03 | now                              | retroactive |
| T04     | before/with Task 04              | pending     |
| T05     | with Task 05                     | pending     |
| T06     | with Task 06                     | pending     |
| T07     | manual, after Task 07            | pending     |
| T08–T10 | specs may land any time (skipIf) | pending     |
| T12     | manual review                    | pending     |

CI (`.github/workflows/deploy.yml`, Task 09) already runs `npm test` before
the image build — every unit above becomes a deploy gate as soon as it lands.
