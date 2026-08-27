# Task 13 — Local dev bypass (`LOCAL_DEV`)

**Goal:** with `LOCAL_DEV=1`, requests need no Origin header, no cookies, and no
`HMAC_SECRET` — CSRF checks pass, the middleware sets a fixed user token without
issuing cookies, and `auth.ts` falls back to a fixed dev secret. With the flag
unset, behavior is **bit-identical to today**, proven by the existing tests.

**Prereqs:** 02, 11 (both complete). **Read first:** `CONTRACTS.md` §3
(`LOCAL_DEV` row), §5 (the three "Local-dev amendment" notes).

> **Ownership exception (explicitly granted):** this task modifies files owned
> by Task 02 (`src/lib/csrf.ts`, `src/lib/auth.ts`, `src/middleware.ts`) and
> Task 11 (`tests/csrf.test.ts`, `tests/auth.test.ts`,
> `tests/middleware.test.ts`). That is permitted here and only here. Do not
> touch any other file.

## Files you modify (none created)

- `src/lib/csrf.ts`
- `src/lib/auth.ts`
- `src/middleware.ts`
- `tests/csrf.test.ts`
- `tests/auth.test.ts`
- `tests/middleware.test.ts`

## `src/lib/csrf.ts`

Add exactly one line: `if (process.env.LOCAL_DEV === '1') return true;` as the
**first statement** of `checkOrigin()`. The full resulting file is:

```ts
export function checkOrigin(request: Request): boolean {
  if (process.env.LOCAL_DEV === '1') return true;
  const origin = request.headers.get('Origin') ?? request.headers.get('Referer');
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.origin === process.env.ALLOWED_ORIGIN;
  } catch {
    return false;
  }
}
```

## `src/lib/auth.ts`

Replace the current import-time block

```ts
if (!process.env.HMAC_SECRET) {
  throw new Error('HMAC_SECRET environment variable is required');
}

const SECRET: string = process.env.HMAC_SECRET;
```

with exactly this (the secret still resolves at import time; the throw message
is unchanged):

```ts
function resolveSecret(): string {
  if (process.env.HMAC_SECRET) return process.env.HMAC_SECRET;
  if (process.env.LOCAL_DEV === '1') return 'local-dev-insecure';
  throw new Error('HMAC_SECRET environment variable is required');
}

const SECRET: string = resolveSecret();
```

Everything else in the file — `issueToken`, `signToken`, `verifyToken`,
`createIpUaHash`, `COOKIE_NAME`, `COOKIE_OPTS` — stays byte-identical.

## `src/middleware.ts`

Insert an early branch **after** the `clientIp` resolution and **before** any
cookie logic. The full resulting file is:

```ts
import { defineMiddleware } from 'astro:middleware';
import { issueToken, signToken, verifyToken, COOKIE_NAME, COOKIE_OPTS } from './lib/auth';

export const onRequest = defineMiddleware((context, next) => {
  const realIp = context.request.headers.get('X-Real-IP');
  context.locals.clientIp = realIp ?? context.clientAddress;

  if (process.env.LOCAL_DEV === '1') {
    context.locals.userToken = 'local-dev-user';
    return next();
  }

  const cookieValue = context.cookies.get(COOKIE_NAME)?.value;
  let token: string;

  if (cookieValue) {
    const verified = verifyToken(cookieValue);
    if (verified) {
      token = verified;
    } else {
      token = issueToken();
      context.cookies.set(COOKIE_NAME, signToken(token), COOKIE_OPTS);
    }
  } else {
    token = issueToken();
    context.cookies.set(COOKIE_NAME, signToken(token), COOKIE_OPTS);
  }

  context.locals.userToken = token;

  return next();
});
```

## Tests you add

Do not modify or delete any existing test — only append. Note that
`tests/setup.ts` sets `HMAC_SECRET` and `ALLOWED_ORIGIN` for every test file and
never sets `LOCAL_DEV`, so all existing tests exercise the flag-unset path
unchanged.

### `tests/csrf.test.ts` — append one `describe('checkOrigin with LOCAL_DEV=1')` block

The file's existing `afterEach(() => vi.unstubAllEnvs())` already cleans up.

1. `vi.stubEnv('LOCAL_DEV', '1')` → `checkOrigin(req({}))` is `true` (no
   headers needed).
2. `vi.stubEnv('LOCAL_DEV', '1')` →
   `checkOrigin(req({ Origin: 'https://evil.example' }))` is `true` (header
   inspection is skipped entirely).

### `tests/auth.test.ts` — append one `describe('LOCAL_DEV=1 dev fallback secret')` block

Use the fresh-module pattern already used by this file and by
`tests/isCat.test.ts`: `vi.resetModules()` + dynamic `import('../src/lib/auth')`
inside `try`/`finally` that restores `process.env`.

1. Loads with the fallback when `HMAC_SECRET` is deleted and
   `process.env.LOCAL_DEV = '1'`: the import resolves, and
   `verifyToken(signToken(t)) === t` round-trips on the freshly imported
   module.
2. Still throws when **both** `HMAC_SECRET` and `LOCAL_DEV` are deleted: the
   import rejects with `/HMAC_SECRET/` (same assertion as the existing throw
   test, but explicitly deleting `LOCAL_DEV` too).

In the `finally` of each test restore `process.env.HMAC_SECRET`, delete
`process.env.LOCAL_DEV`, and call `vi.resetModules()` so later imports get the
normal module again.

### `tests/middleware.test.ts` — append one `describe('LOCAL_DEV=1 bypass')` block

Add `afterEach(() => vi.unstubAllEnvs())` inside the new block. Reuse the
existing `makeContext()` helper.

1. `vi.stubEnv('LOCAL_DEV', '1')` → after `onRequest`,
   `locals.userToken === 'local-dev-user'` and `cookies.set` was **never**
   called (no `Set-Cookie`).
2. `vi.stubEnv('LOCAL_DEV', '1')` with
   `makeContext({ headers: { 'X-Real-IP': '203.0.113.7' } })` →
   `locals.clientIp === '203.0.113.7'` (IP resolution unchanged by the
   bypass).
3. `vi.stubEnv('LOCAL_DEV', '1')` with a valid signed cookie in the context →
   `locals.userToken === 'local-dev-user'` (cookie is ignored, not verified)
   and `cookies.set` not called; `next` called exactly once and its response
   returned.

## Constraints

- No changes to `COOKIE_NAME`, `COOKIE_OPTS`, any function signature, any route
  file, or any §9 error string.
- No new dependencies.
- The literal strings are exactly `local-dev-insecure` (fallback secret) and
  `local-dev-user` (fixed token) — CONTRACTS §5 pins both.
- Do not set `LOCAL_DEV` in `tests/setup.ts`, `.env.example`,
  `docker-compose.yml`, `deploy/`, or CI — nothing outside the new tests may
  reference it.

## Acceptance check

```
npm test          # entire suite green — existing tests prove flag-unset behavior unchanged
npm run build
npm run typecheck
```

Then `npx prettier --write` on the six modified files, followed by
`npm run format:check`, `npm run lint`, and `npm run lint:format-compat`. Report
pass/fail for each.
