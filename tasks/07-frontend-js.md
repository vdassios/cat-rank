# Task 07 — Frontend JS (~60 lines total)

**Goal:** the small amount of vanilla client JS that HTMX/CSS can't do: opening/
closing the dialog and the sidebar swipe/toggle. Output is served at `/ui.js`.

**Prereqs:** 06 (markup + IDs must exist). **Read first:** `CONTRACTS.md` §7
(IDs), master plan § Interactions summary.

## Files you create

- `src/scripts/ui.ts` — built/copied to `dist/client/ui.js` and referenced by
  `index.astro` as `<script type="module" src="/ui.js">`. (If your build doesn't
  emit it automatically, place a plain `public/ui.js`; either is acceptable —
  state which you chose.)

## Behavior to implement (only these)

1. **Open modal on tile click:** after HTMX swaps a detail fragment into
   `#modal-body` (listen for `htmx:afterSwap` where target is `#modal-body`),
   call `document.getElementById('modal').showModal()`.
2. **Close modal:** clicking the dialog backdrop or any element with
   `data-close-modal` calls `modal.close()`. (~5 lines.)
3. **Sidebar toggle:** `#sidebar-toggle` click toggles an `open` class on
   `#sidebar` and shows/hides `#sidebar-backdrop`. Backdrop click closes it.
4. **Sidebar swipe:** vanilla `touchstart`/`touchmove`/`touchend` — swipe left
   from the right edge opens, swipe right closes (~25 lines). Guard the
   activation zone so it doesn't fight the browser back-gesture (start zone =
   rightmost ~20px).

## Constraints

- No frameworks, no bundled deps — plain DOM APIs only.
- Total custom JS ≈ 60 lines. Do not add behaviors beyond the four above.
- Do not modify components (Task 06 owns markup); only attach behavior to the
  IDs in CONTRACTS §7.

## Acceptance check

`npm run build` succeeds and `/ui.js` is reachable. Manual check in a browser:
clicking a tile opens the modal; backdrop/close button closes it; the ☰ button
and an edge-swipe open/close the sidebar. Report each of the four behaviors.
