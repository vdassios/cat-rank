# Task 05 — API routes

**Goal:** all HTTP endpoints, wiring together the DB, auth, validation, and image
modules. This is the integration task.

**Prereqs:** 00, 01, 02, 03, 04.
**Read first:** `CONTRACTS.md` §5, §7, §8, §9, §10 (all of it).
**Import (do not reimplement):** `db`/tables (Task 01), `auth`/`csrf` (Task 02),
`detectMime`/`validateCat` (Task 03), `processImage`/`deleteProcessedImages`
(Task 04), components (Task 06 — render them; if a component file is absent,
still code the import per CONTRACTS §7 names/props).

## Files you create

- `src/pages/health.ts`
- `src/pages/api/submit-form.astro`
- `src/pages/api/cats/index.astro`
- `src/pages/api/cats/[id]/index.astro`
- `src/pages/api/cats/[id]/like.astro`
- `src/pages/api/cats/[id]/comments.astro`

Implement every route exactly per the table in CONTRACTS §8, with the validation
rules and exact error strings in §9 and the like transaction in §10.

The five `.astro` route files are partial pages. Every one of them starts its
frontmatter with **both** exports — `partial` is what stops Astro wrapping the
fragment in a full HTML document (which silently breaks every HTMX swap), and
it is not optional:

```astro
---
export const partial = true;
export const prerender = false;
---
```

Each branches on `Astro.request.method` where the route serves more than one
method, and renders its contracted component directly. Use `Astro.request`,
`Astro.locals`, and `Astro.response`; do not use `astro/container` or
`experimental_AstroContainer` in production routes. `health.ts` is the one
exception to all of this: it is a plain `.ts` API endpoint returning JSON, not
a fragment, so it exports neither.

Only successful fragment responses carry `Content-Type: text/html` (Astro sets
it for a rendered partial). Error bodies — the §9 guard strings, `Forbidden`,
`Not Found` — are bare `Response`s and stay plain text; do not add HTML headers
to them (CONTRACTS §8).

**Drizzle predicates:** every two-column lookup here (`liked`, `canComment`,
duplicate-comment check) must use one `where(and(...))` call. Chaining
`.where()` twice replaces the first predicate, which silently makes likes and
comments user-global instead of per-cat. Copy this shape:

```ts
import { and, asc, desc, eq, ne } from 'drizzle-orm';

// RIGHT
const voteRow = db
  .select()
  .from(votes)
  .where(and(eq(votes.catId, id), eq(votes.userToken, Astro.locals.userToken)))
  .limit(1);

// WRONG — the second .where() throws the first one away
db.select().from(votes).where(eq(votes.catId, id)).where(eq(votes.userToken, token));
```

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
3. Sanitize `name` per §9.
4. Persist. This is the master plan's § Upload flow diagram, verbatim — no
   placeholder row, no follow-up `UPDATE`, no `catId` passed to `processImage`:

   ```ts
   const storageKey = crypto.randomUUID();

   let processed;
   try {
     // processImage removes its own partial output if either write fails
     processed = await processImage(buf, storageKey);
   } catch {
     return new Response('Internal Server Error', { status: 500 });
   }

   try {
     db.insert(cats)
       .values({
         name,
         thumbnailPath: processed.thumbnailPath,
         imagePath: processed.imagePath,
       })
       .run();
   } catch {
     await deleteProcessedImages(storageKey);
     return new Response('Internal Server Error', { status: 500 });
   }

   return new Response(null, { status: 200, headers: { 'HX-Redirect': '/' } });
   ```

   Invariants this enforces: exactly one `INSERT`, the row's stored paths equal
   the on-disk filenames, and neither an unfinished row nor an orphan image pair
   can survive a failure.

**`/api/submit-form` GET** — the whole file, verbatim:

```astro
---
import SubmitForm from '../../components/SubmitForm';

export const partial = true;
export const prerender = false;
---

<SubmitForm client:load />
```

It must be an `.astro` partial (not a `.ts` endpoint) so the Preact island
ships its hydration script; the client-side preview/validation is dead without
it. `client:load` is required — `client:visible` would not fire reliably inside
a `<dialog>`.

**`/api/cats/[id]` GET** — load cat (`404` if none); compute `liked` (vote row
for `(id, locals.userToken)`) and `canComment` (no comment row for that pair) —
both with `and(...)`, see above; load first 10 comments `created_at ASC`;
render `CatModal`.

**`/api/cats/[id]/like` POST** — `checkOrigin` → 403; run the like transaction
(CONTRACTS §10) with `locals.userToken` + `createIpUaHash(locals.clientIp, ua)`;
return the updated `LikeButton` (idempotent — already-liked returns the liked
button, no double count).

**`/api/cats/[id]/comments`**

- GET: page of comments `created_at ASC`, 10/page → `CommentList` fragment.
- POST: `checkOrigin` → 403; validate per §9 (empty / >500 / duplicate) with
  exact error strings; sanitize (`replace(/<[^>]*>/g,'').trim()`); insert.
- The duplicate `SELECT` is a pre-check only. The insert goes in `try`/`catch`
  using `isConstraintError()` (CONTRACTS §10) — the exact snippet is in
  CONTRACTS §9. Two concurrent posts can both pass the `SELECT`, and an
  unguarded insert then throws a 500 instead of the contracted 400.
- After a successful insert, set a local `justPosted = true` and fall through to
  the shared GET rendering (page 1). The template is exactly:

  ```astro
  <CommentList comments={pageComments} catId={id} nextPage={nextPage} />
  {
    justPosted && (
      <div id="comment-form" hx-swap-oob="true">
        comment posted
      </div>
    )
  }
  ```

  A bare sibling `<p>comment posted</p>` lands inside `#comment-list` and leaves
  the form on screen — it must not be used. Notice text is `comment posted`
  exactly; do not reuse the `400` string (CONTRACTS §7 string table).

## Constraints

- Use `locals.userToken` / `locals.clientIp` (set by middleware) — never read
  the cookie or headers directly for these.
- All POSTs call `checkOrigin` first. Successful fragment responses are
  `text/html`; error bodies stay plain text (see above).
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
  text → second is `400 You already commented on this cat` (and the success
  body contains both the refreshed list and the `hx-swap-oob` form notice).
- `GET /api/cats/1` after user A liked cat 1 → cat 2's fragment must still show
  unliked (catches the chained-`.where()` bug).

Report each result.
