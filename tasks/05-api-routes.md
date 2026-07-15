# Task 05 — API routes

**Goal:** all HTTP endpoints, wiring together the DB, auth, validation, and image
modules. This is the integration task.

**Prereqs:** 00, 01, 02, 03, 04.
**Read first:** `CONTRACTS.md` §5, §7, §8, §9, §10 (all of it).
**Import (do not reimplement):** `db`/tables (Task 01), `auth`/`csrf` (Task 02),
`detectMime`/`validateCat` (Task 03), `processImage` (Task 04), components
(Task 06 — render them; if a component file is absent, still code the import per
CONTRACTS §7 names/props).

## Files you create

- `src/pages/health.ts`
- `src/pages/api/submit-form.ts`
- `src/pages/api/cats/index.ts`
- `src/pages/api/cats/[id]/index.ts`
- `src/pages/api/cats/[id]/like.ts`
- `src/pages/api/cats/[id]/comments.ts`

Implement every route exactly per the table in CONTRACTS §8, with the validation
rules and exact error strings in §9 and the like transaction in §10.

## Per-route notes

**`/health` (GET)** — CONTRACTS §8: write+delete a row in a `_health` temp
table, `fs.accessSync(UPLOAD_DIR, W_OK)`; `200 {"status":"ok"}` else `503`
`unhealthy`.

**`/api/cats` GET** — query cats `ORDER BY created_at DESC`, **exclude the
current top cat** (highest `likes_count`, tiebreak `id ASC`), paginate
`limit` (default 12) / `page` (1-based). Return `CatGrid` fragment with
`nextPage` = `page+1` when a full page returned else `null`.

**`/api/cats` POST** — multipart (`image`, `name`):

1. `checkOrigin` → 403 if false.
2. Guards in the exact order of CONTRACTS §9 (size → mime → ext → svg → cat),
   each returning `400` + the exact body string.
3. Insert the cat row first (placeholder paths) to get its `id`, then
   `processImage(buf, id)` and update the row with the returned paths. The
   on-disk filename must match the stored `thumbnail_path`/`image_path`.
   Sanitize `name` per §9.
4. **Failure cleanup is mandatory:** if `processImage` (or the path update)
   throws, `DELETE` the just-inserted cat row in a `try/catch` before returning
   `500` — an orphan row with placeholder paths must never survive. Wrap
   insert→process→update so no code path leaks the row.
5. On success: `200` with header `HX-Redirect: /`.

**`/api/cats/[id]` GET** — load cat (`404` if none); compute `liked` (vote row
for `(id, locals.userToken)`) and `canComment` (no comment row for that pair);
load first 10 comments `created_at ASC`; render `CatModal`.

**`/api/cats/[id]/like` POST** — `checkOrigin` → 403; run the like transaction
(CONTRACTS §10) with `locals.userToken` + `createIpUaHash(locals.clientIp, ua)`;
return the updated `LikeButton` (idempotent — already-liked returns the liked
button, no double count).

**`/api/cats/[id]/comments`**

- GET: page of comments `created_at ASC`, 10/page → `CommentList` fragment.
- POST: `checkOrigin` → 403; validate per §9 (empty / >500 / duplicate) with
  exact error strings; sanitize (`replace(/<[^>]*>/g,'').trim()`); insert;
  return updated first-10 `CommentList` **and** replace the form with a
  "comment posted" notice.

## Constraints

- Use `locals.userToken` / `locals.clientIp` (set by middleware) — never read
  the cookie or headers directly for these.
- All POSTs call `checkOrigin` first. Fragment responses are `text/html`.
- Do not invent response shapes — match CONTRACTS §8 exactly.

## Acceptance check

```
npm run build
```

Then with a running dev server + a seeded cat (insert one row manually):

- `GET /health` → `{"status":"ok"}`.
- `GET /api/cats` → grid HTML.
- `POST /api/cats` with a non-image → `400 Unsupported format`.
- `POST /api/cats/1/like` twice → like count increments once.
- `POST /api/cats/1/comments` empty → `400 Comment cannot be empty`; twice with
  text → second is `400 You already commented on this cat`.

Report each result.
