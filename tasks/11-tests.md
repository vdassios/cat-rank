# Task 11 — Tests

**Goal:** fast unit/integration tests (Vitest) for the highest-value logic:
dedupe transaction, upload guards, `validateCat` thresholding, comment rules,
and the Origin check. No network, no real ONNX, in-memory SQLite.

**Prereqs:** 01, 02, 03, 05. **Read first:** `CONTRACTS.md` §5, §8, §9, §10;
master plan § Testing strategy.

## Files you create

- `tests/` — one spec per area below (e.g. `votes.test.ts`, `guards.test.ts`,
  `isCat.test.ts`, `comments.test.ts`, `csrf.test.ts`).
- If needed, a `tests/helpers.ts` that builds an in-memory DB
  (`DATABASE_PATH=:memory:` or a temp file) and applies migrations.

`npm test` already maps to `vitest run` (Task 00). Add `vitest` config if needed
(`vitest.config.ts`) targeting the `tests/` dir.

## Required test cases (cover at least these)

**Dedupe transaction (CONTRACTS §10):**

- same `user_token` likes a cat twice → `likes_count` increments **once**.
- different `user_token` but same `ip_ua_hash` → second like rejected.
- two genuinely distinct users → count == 2.

**Upload guards (CONTRACTS §9), order-sensitive:**

- > 10 MB → `File too large (max 10MB)`.
- bad magic bytes → `Unsupported format`.
- valid magic but wrong extension → `Unsupported file type`.
- SVG → `SVG files not allowed`.
- (mock `validateCat` to false) → `We couldn't verify this is a cat`.

**`validateCat` thresholding (mock the ONNX session):**

- cat-class sum ≥ `CAT_THRESHOLD` → true; below → false.

**Comment rules (CONTRACTS §9):**

- empty/whitespace → `Comment cannot be empty`.
- > 500 chars → `Comment too long (max 500)`.
- second comment by same user on same cat → `You already commented on this cat`.
- HTML tags stripped before insert.

**Origin check (CONTRACTS §5):**

- request with `Origin === ALLOWED_ORIGIN` → true; foreign Origin → false;
  missing → false.

## Constraints

- Mock ONNX and Sharp where they'd require real binaries/models; the point is to
  test **our** logic, not the libraries.
- Tests must run offline and deterministically. No real R2, no real model.
- Do not modify source files to make them testable beyond what their contracts
  already expose; if something genuinely isn't testable, report it.

## Acceptance check

```
npm test     # all specs green
```

Report the number of tests and that they pass offline.
