# CONTRACTS — shared interfaces (authoritative)

Every subtask conforms to this file exactly. Do not rename symbols, change
signatures, alter type shapes, or move files. If you think something here is
wrong, **stop and report** — do not "fix" it unilaterally.

---

## 1. Versions & toolchain

| Thing             | Pinned value                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node              | `22` (Dockerfile + CI + local)                                                                                                                                           |
| Docker base image | `node:22-bookworm-slim` — **never Alpine** (`onnxruntime-node` has no musl build; `better-sqlite3` has no musl prebuilds)                                                |
| Sidecar images    | `nginx:1.27-alpine`, `litestream/litestream:0.3.13`, `rclone/rclone:1.67`, `certbot/certbot:v2.11.0` (pinned; no `:latest`)                                              |
| Package manager   | `npm` (use `npm ci`)                                                                                                                                                     |
| Formatter         | `prettier@3.9.5` + `prettier-plugin-astro@0.14.1` (exact; repository config only)                                                                                        |
| Linter            | `eslint@10.7.0` + exact plugins/configs from §11; `eslint-config-prettier` is applied last                                                                               |
| Astro             | `^5` (SSR, `output: 'server'`)                                                                                                                                           |
| Adapter           | `@astrojs/node` (`mode: 'standalone'`)                                                                                                                                   |
| Islands           | `@astrojs/preact`                                                                                                                                                        |
| HTMX              | `2.0.4`, self-hosted at `public/htmx.min.js` (pinned + SRI)                                                                                                              |
| ONNX model file   | `models/mobilenetv2-cat.onnx` (gitignored; fetched in CI). **Never in `public/`** — Astro copies `public/` into `dist/client/` and would serve the model to the internet |
| Module system     | ESM (`"type": "module"`), TypeScript, `.ts` source                                                                                                                       |

---

## 2. Repository layout (authoritative paths)

```
docker-compose.yml              # REPO ROOT (not deploy/) — relative mounts
                                # (./data, ./deploy/*, ./certbot/*) resolve here
.dockerignore                   # excludes node_modules, dist, data, certbot,
                                # public/uploads, .env*, .git — NOT models/ or drizzle/
src/
├── db/connection.ts            # exports: db, rawDb
├── db/schema.ts                # exports: cats, votes, comments (drizzle tables)
├── lib/auth.ts                 # cookie signing + ip_ua_hash
├── lib/csrf.ts                 # Origin check
├── lib/semaphore.ts            # Semaphore class
├── lib/rateLimit.ts            # per-IP token bucket (app fallback)
├── lib/images.ts               # Sharp processing
├── validation/mime.ts          # magic-byte MIME detection
├── validation/isCat.ts         # ONNX wrapper: validateCat()
├── validation/imagenet-labels.json
├── middleware.ts               # Astro middleware: user_token + real IP
├── pages/index.astro           # page shell
├── pages/health.ts             # GET /health
├── pages/api/submit-form.ts    # GET submit modal
├── pages/api/cats/index.ts     # GET grid | POST upload
├── pages/api/cats/[id]/index.ts        # GET detail modal
├── pages/api/cats/[id]/like.ts         # POST like
├── pages/api/cats/[id]/comments.ts     # GET page | POST add
├── components/*.astro          # see §7
├── components/SubmitForm.tsx   # Preact island
└── scripts/ui.ts               # client JS (built to dist/client/ui.js)
scripts/migrate.ts              # drizzle migration runner (built → dist/scripts/migrate.mjs)
scripts/fetch-model.sh          # CI: model → models/mobilenetv2-cat.onnx
models/                         # ONNX model lands here (gitignored, non-public)
deploy/{Dockerfile,nginx.conf,litestream.yml,entrypoint.sh,backup-images.sh,restore-images.sh,verify-backup.sh,provision.sh,FIRST_DEPLOY.md}
drizzle/migrations/
tests/
.github/workflows/deploy.yml
```

---

## 3. Environment variables (names are fixed)

Read via `process.env`. Never hardcode these values.

| Var                       | Used by                          | Example                                                                                                 |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | app                              | `production`                                                                                            |
| `HOST`                    | app                              | `0.0.0.0`                                                                                               |
| `PORT`                    | app                              | `3000`                                                                                                  |
| `DATABASE_PATH`           | db/connection.ts                 | `/app/data/cats.db`                                                                                     |
| `UPLOAD_DIR`              | images.ts, health                | `/var/lib/cat-ranking/uploads`                                                                          |
| `ALLOWED_ORIGIN`          | csrf.ts                          | `https://yourdomain.com`                                                                                |
| `HMAC_SECRET`             | auth.ts                          | (32-byte hex)                                                                                           |
| `R2_ACCESS_KEY_ID`        | deploy/backups                   | —                                                                                                       |
| `R2_SECRET_ACCESS_KEY`    | deploy/backups                   | —                                                                                                       |
| `R2_ENDPOINT`             | deploy/backups                   | —                                                                                                       |
| `HEALTHCHECK_IMAGES_URL`  | backup-images.sh                 | —                                                                                                       |
| `HEALTHCHECK_RESTORE_URL` | verify-backup.sh                 | —                                                                                                       |
| `IMAGE_TAG`               | docker-compose.yml (deploy only) | git sha; default `latest` — CI pins it in the VPS `.env` on every deploy (rollback = old sha + `up -d`) |

Derived (set inside docker-compose.yml, never by hand): the **app** and
**litestream** services both receive `LITESTREAM_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}`
and `LITESTREAM_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}` — `litestream.yml`
expands `${LITESTREAM_*}`, and the app's entrypoint runs `litestream restore`,
so the app container needs them too.

For local dev defaults: `DATABASE_PATH=./data/cats.db`,
`UPLOAD_DIR=./data/uploads`, `ALLOWED_ORIGIN=http://localhost:4321`.

---

## 4. Shared TypeScript types

Define these in `src/db/schema.ts` (inferred from drizzle tables) and re-export.
Consumers import types from `src/db/schema.ts`.

```ts
export interface Cat {
  id: number;
  name: string;
  thumbnailPath: string; // e.g. "/uploads/12_thumb.webp"
  imagePath: string; // e.g. "/uploads/12_full.webp"
  likesCount: number;
  createdAt: string; // SQLite datetime('now') text
}

export interface Vote {
  id: number;
  catId: number;
  userToken: string;
  ipUaHash: string;
  createdAt: string;
}

export interface Comment {
  id: number;
  catId: number;
  userToken: string;
  text: string;
  createdAt: string;
}
```

---

## 5. Module interfaces (signatures are fixed)

### `src/db/connection.ts`

```ts
import type BetterSqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
export const rawDb: BetterSqlite3.Database; // pragmas applied
export const db: BetterSQLite3Database<typeof schema>; // drizzle instance
```

Must apply at init, in order: `journal_mode = WAL`, `wal_autocheckpoint = 0`,
`busy_timeout = 5000`, `foreign_keys = ON`.

### `src/db/schema.ts`

```ts
export const cats: SQLiteTable; // see §6 DDL
export const votes: SQLiteTable;
export const comments: SQLiteTable;
// plus the Cat/Vote/Comment types from §4
```

### `src/lib/auth.ts`

```ts
export function issueToken(): string; // crypto.randomUUID()
export function signToken(token: string): string; // cookie-signature sign
export function verifyToken(signed: string): string | false;
export function createIpUaHash(ip: string, userAgent: string): string; // sha256(`${ip}|${ua}`).slice(0,32)
export const COOKIE_NAME = 'user_token';
export const COOKIE_OPTS: {
  httpOnly: true;
  secure: true;
  sameSite: 'lax';
  path: '/';
  maxAge: 31536000;
};
```

### `src/lib/csrf.ts`

```ts
// true if request Origin/Referer matches process.env.ALLOWED_ORIGIN
export function checkOrigin(request: Request): boolean;
```

### `src/lib/semaphore.ts`

```ts
export class Semaphore {
  constructor(max: number);
  run<T>(fn: () => Promise<T>): Promise<T>;
}
```

### `src/lib/rateLimit.ts`

```ts
// in-process per-IP token bucket; app-level fallback behind nginx
export function rateLimit(key: string, limit: number, windowMs: number): boolean; // true = allowed
```

### `src/lib/images.ts`

```ts
export interface ProcessedImage {
  thumbnailPath: string;
  imagePath: string;
}
// Sharp: rotate (EXIF) → thumbnail 300px WebP80 + full 1200px WebP85, strip metadata.
// Writes {id}_thumb.webp and {id}_full.webp into process.env.UPLOAD_DIR.
// Returns public paths "/uploads/{id}_thumb.webp" and "/uploads/{id}_full.webp".
export function processImage(buf: Buffer, id: number): Promise<ProcessedImage>;
```

### `src/validation/mime.ts`

```ts
// returns 'image/jpeg' | 'image/png' | 'image/webp' | null  (magic bytes; WEBP checks bytes 8-11)
export function detectMime(buf: Buffer): string | null;
```

### `src/validation/isCat.ts`

```ts
// resize→224x224, run ONNX, sum ~5 ImageNet cat classes, compare to threshold.
// Semaphore-bounded (max 2). Threshold default 0.20 via CAT_THRESHOLD const.
// Model path: models/mobilenetv2-cat.onnx (dev) or dist/models/ (built image)
// — resolve whichever exists. NEVER public/ (Astro would publish it).
export function validateCat(buf: Buffer): Promise<boolean>;
```

### `src/middleware.ts` (Astro `onRequest`)

- If no valid `user_token` cookie: issue one, set signed cookie with `COOKIE_OPTS`.
- Resolve real client IP from **`X-Real-IP` only** (nginx sets it to
  `$remote_addr`, overwriting anything the client sent), falling back to the
  connection remote address in dev. **Never read `X-Forwarded-For`** — nginx
  _appends_ to the client-supplied value, so its first hop is
  attacker-controlled and would let anyone spoof the vote dedupe / rate limits.
- Put both on `context.locals`:

```ts
declare namespace App {
  interface Locals {
    userToken: string;
    clientIp: string;
  }
}
```

---

## 6. Database DDL (authoritative)

```sql
CREATE TABLE cats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  thumbnail_path TEXT NOT NULL,
  image_path TEXT NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cats_likes   ON cats(likes_count DESC);
CREATE INDEX idx_cats_created ON cats(created_at DESC);

CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat_id INTEGER NOT NULL REFERENCES cats(id),
  user_token TEXT NOT NULL,
  ip_ua_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cat_id, user_token),
  UNIQUE(cat_id, ip_ua_hash)
);
CREATE INDEX idx_votes_cat ON votes(cat_id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat_id INTEGER NOT NULL REFERENCES cats(id),
  user_token TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cat_id, user_token)
);
CREATE INDEX idx_comments_cat ON comments(cat_id, created_at);
```

---

## 7. Component contract (props are fixed)

All components are Astro (`.astro`) except `SubmitForm.tsx` (Preact). Routes in
§8 render specific components — names and props must match.

| Component           | Props                                                                                              | Renders                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Hero.astro`        | `{ cat: Cat \| null }`                                                                             | top-rated cat card + Submit button                          |
| `CatGrid.astro`     | `{ cats: Cat[]; nextPage: number \| null }`                                                        | tiles + `Sentinel` if more                                  |
| `CatCard.astro`     | `{ cat: Cat }`                                                                                     | one grid tile (thumb + ★count), `hx-get="/api/cats/{id}"`   |
| `LikeButton.astro`  | `{ cat: Cat; liked: boolean }`                                                                     | ★ button, `hx-post="/api/cats/{id}/like"`                   |
| `Sentinel.astro`    | `{ url: string }`                                                                                  | `hx-get={url}` `hx-trigger="revealed"` `hx-swap="afterend"` |
| `CatModal.astro`    | `{ cat: Cat; liked: boolean; comments: Comment[]; nextPage: number \| null; canComment: boolean }` | full image + LikeButton + CommentList + CommentForm/notice  |
| `CommentList.astro` | `{ comments: Comment[]; catId: number; nextPage: number \| null }`                                 | items + Sentinel if more                                    |
| `CommentItem.astro` | `{ comment: Comment }`                                                                             | one comment (escaped text + timestamp)                      |
| `CommentForm.astro` | `{ catId: number }`                                                                                | textarea + submit, `hx-post="/api/cats/{id}/comments"`      |
| `Leaderboard.astro` | `{ cats: Cat[] }`                                                                                  | top-10 list (thumb + name + ★)                              |
| `Sidebar.astro`     | `{ cats: Cat[] }`                                                                                  | overlay wrapping `Leaderboard`                              |
| `SubmitForm.tsx`    | `{}`                                                                                               | file input + name + client-side preview/validation          |

**HTML/ID conventions (so JS and HTMX line up):**

- Detail/submit dialogs: a single `<dialog id="modal">` in `index.astro`;
  HTMX loads fragments into `#modal-body`. JS closes via `modal.close()`.
- Sidebar root element id: `#sidebar`; toggle button id: `#sidebar-toggle`;
  backdrop id: `#sidebar-backdrop`.
- Grid container id: `#cat-grid`. Comment list container id: `#comment-list`.

---

## 8. HTTP route contract (authoritative)

All POST handlers MUST: (1) call `checkOrigin(request)` → 403 if false;
(2) read `locals.userToken` / `locals.clientIp`. Redirects use the `HX-Redirect`
response header (never 302). Fragment routes return `Content-Type: text/html`.

| Route                     | Method | Request                                  | Success response                                                                                                      |
| ------------------------- | ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/`                       | GET    | —                                        | full HTML page (`index.astro`)                                                                                        |
| `/api/cats`               | GET    | `?page=N&limit=12`                       | `200` HTML: `CatGrid` fragment, `created_at DESC`, **top cat excluded**, 12/page                                      |
| `/api/cats`               | POST   | multipart: `image` (file), `name` (text) | on success `200` + header `HX-Redirect: /`; on reject `400` HTML error string (see §9)                                |
| `/api/submit-form`        | GET    | —                                        | `200` HTML: `SubmitForm` island wrapper                                                                               |
| `/api/cats/[id]`          | GET    | —                                        | `200` HTML: `CatModal` fragment; `404` if no cat                                                                      |
| `/api/cats/[id]/like`     | POST   | —                                        | `200` HTML: updated `LikeButton` (idempotent if already liked)                                                        |
| `/api/cats/[id]/comments` | GET    | `?page=N`                                | `200` HTML: `CommentList` page, `created_at ASC`, 10/page                                                             |
| `/api/cats/[id]/comments` | POST   | form: `text`                             | `200` HTML: updated first-10 `CommentList` + form replaced by "comment posted"; `400` HTML error if invalid/duplicate |
| `/health`                 | GET    | —                                        | `200` JSON `{"status":"ok"}` if DB writable + upload dir OK; else `503` text `unhealthy`                              |

**Pagination:** `limit` for grid defaults to 12, comments fixed at 10. `page`
is 1-based. `nextPage` is `page+1` when a full page was returned, else `null`.

**Like state (`liked`)**: true if a `votes` row exists for `(catId, userToken)`.
**Comment eligibility (`canComment`)**: false if a `comments` row exists for
`(catId, userToken)`.

---

## 9. Validation rules & error strings (exact)

Upload guards run in this order, each returns `400` with this exact body text:

1. size > 10 MB → `File too large (max 10MB)`
2. `detectMime()` null OR not jpeg/png/webp → `Unsupported format`
3. extension not in `.jpg/.jpeg/.png/.webp` → `Unsupported file type`
4. SVG detected → `SVG files not allowed`
5. `validateCat()` false → `We couldn't verify this is a cat`

Comment guards (`400` exact body):

- empty/whitespace → `Comment cannot be empty`
- length > 500 → `Comment too long (max 500)`
- duplicate for `(catId, userToken)` → `You already commented on this cat`

Comment sanitization before insert: `text.replace(/<[^>]*>/g, '').trim()`, then
length-check the result. Cat `name`: trim, max 60 chars, same tag strip.

Filenames: `{id}_thumb.webp`, `{id}_full.webp` — id from DB, never user input.

---

## 10. Like transaction (use verbatim semantics)

Insert `votes` row + increment `cats.likes_count` in ONE transaction. Catch
`SQLITE_CONSTRAINT` → return already-liked without double counting. Tiebreak for
ordering: equal `likes_count` → `id ASC`.

---

## 11. Dependencies (the only allowed packages)

```
runtime:  astro @astrojs/preact @astrojs/node preact
          drizzle-orm better-sqlite3 sharp onnxruntime-node cookie-signature
dev:      drizzle-kit @types/better-sqlite3 vitest typescript
          esbuild @astrojs/check prettier@3.9.5 prettier-plugin-astro@0.14.1
          eslint@10.7.0 @eslint/js@10.0.1 typescript-eslint@8.64.0
          eslint-plugin-astro@3.0.0 eslint-config-prettier@10.1.8
          globals@17.7.0
```

Any addition beyond this list must be flagged in your final report.

---

## 12. Build pipeline (how non-Astro code is built)

`astro build` only builds the Astro app into `dist/`. The standalone Node
scripts in `scripts/` are bundled separately:

- `npm run build` = `astro build && npm run build:scripts`.
- `npm run format` formats supported repository files; `npm run format:check`
  verifies them without writing. `npm run lint` runs ESLint, whose final config
  is `eslint-config-prettier`; `npm run lint:format-compat` verifies that lint
  rules do not conflict with Prettier.
- `build:scripts` bundles `scripts/*.ts` to `dist/scripts/*.mjs` with esbuild
  (guarded so it's a no-op before any `scripts/*.ts` exists — Task 00 runs first):
  `if ls scripts/*.ts >/dev/null 2>&1; then esbuild scripts/*.ts --bundle --platform=node --format=esm --packages=external --outdir=dist/scripts --out-extension:.js=.mjs; else echo 'no scripts/*.ts yet'; fi`
- So `scripts/migrate.ts` → `dist/scripts/migrate.mjs`,
  `scripts/seed.ts` → `dist/scripts/seed.mjs`. `--packages=external` leaves
  `node_modules` deps (better-sqlite3, drizzle, sharp) resolved at runtime.
- The drizzle migrator reads migrations from **`./drizzle/migrations`** relative
  to the working dir (`/app` in the container). That folder must ship in the
  image (the Dockerfile copies it).
- `src/scripts/ui.ts` (Task 07) is client-side; it is served at `/ui.js` —
  Task 07 decides whether to emit it via the bundler or ship `public/ui.js`.
