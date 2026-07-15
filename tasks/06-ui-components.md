# Task 06 — UI components

**Goal:** all Astro components, the Preact submit-form island, and the page
shell, matching the component contract so routes (Task 05) can render them.

**Prereqs:** 00. **Read first:** `CONTRACTS.md` §1, §4, §7; master plan
§ UI Layout and § Interactions summary.

## Files you create

Components in `src/components/` (props per CONTRACTS §7):
`Hero.astro`, `CatGrid.astro`, `CatCard.astro`, `LikeButton.astro`,
`Sentinel.astro`, `CatModal.astro`, `CommentList.astro`, `CommentItem.astro`,
`CommentForm.astro`, `Leaderboard.astro`, `Sidebar.astro`, `SubmitForm.tsx`
(Preact island).
Plus the shell: `src/pages/index.astro`.

## Requirements

- **Props are fixed** — match CONTRACTS §7 names/types exactly. Routes pass these.
- **HTMX attributes** drive interactions (no fetch calls):
  - `CatCard`: `hx-get="/api/cats/{id}"`, `hx-target="#modal-body"`,
    `hx-swap="innerHTML"`, and open the dialog (paired with Task 07 JS).
  - `LikeButton`: `hx-post="/api/cats/{id}/like"`, `hx-swap="outerHTML"`.
  - `Sentinel`: `hx-get={url}` `hx-trigger="revealed"` `hx-swap="afterend"`.
  - `CommentForm`: `hx-post="/api/cats/{id}/comments"`, targets `#comment-list`
    region; on success the form is replaced (route returns the replacement).
- **IDs** from CONTRACTS §7: `#modal`, `#modal-body`, `#sidebar`,
  `#sidebar-toggle`, `#sidebar-backdrop`, `#cat-grid`, `#comment-list`.
- **Escaping:** render `cat.name` and `comment.text` as plain text (Astro
  auto-escapes `{value}`) — never `set:html`.
- **Grid CSS:** `display:grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr))`.
- **Mobile-first** styling; the sidebar is an overlay from the right using
  `transform: translateX()` (animation only — the swipe/toggle JS is Task 07).

## `index.astro` shell

- Include the HTMX script with the SRI hash recorded by Task 00:
  `<script src="/htmx.min.js" integrity="sha384-..." crossorigin="anonymous"></script>`.
- Render `Hero` (top cat, server-fetched), the initial `CatGrid` page, the
  `Sidebar`, the empty `<dialog id="modal"><div id="modal-body"></div></dialog>`,
  and a `<script type="module" src="/ui.js">` placeholder (Task 07 provides it).
- This page may query the DB directly (import `db` from `src/db`) for the initial
  SSR hero + first grid page + leaderboard. Use the same ordering rules as the
  routes (CONTRACTS §8, §10 tiebreak).

## `SubmitForm.tsx` (Preact)

- File input (`accept="image/*"`) + `name` text input + submit button.
- Client-side preview of the chosen image and basic checks (type/size ≤10MB)
  before allowing submit; keep it ~30 lines. The actual upload POST is HTMX on
  the surrounding `<form hx-post="/api/cats" hx-encoding="multipart/form-data">`.

## Constraints

- Do not write the `dialog.close()` / swipe logic here — that is Task 07
  (`src/scripts/ui.ts`). Only render the markup + IDs it will hook into.
- Do not change any prop names/types from CONTRACTS §7.

## Acceptance check

```
npm run build
```

Build succeeds. Manually confirm (dev server) that the page renders the hero,
grid, sidebar, and an (initially empty) modal, and that markup contains the
exact IDs and `hx-*` attributes listed above. Report which components render.
