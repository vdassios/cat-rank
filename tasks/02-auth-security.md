# Task 02 — Auth & security

**Goal:** signed-cookie auth, IP+UA hashing, CSRF Origin check, a concurrency
semaphore, an app-level rate limiter, and the Astro middleware that issues the
`user_token` cookie and resolves the real client IP.

**Prereqs:** 00. **Read first:** `CONTRACTS.md` §3, §5 (auth/csrf/semaphore/
rateLimit/middleware).

## Files you create

- `src/lib/auth.ts`
- `src/lib/csrf.ts`
- `src/lib/semaphore.ts`
- `src/lib/rateLimit.ts`
- `src/middleware.ts`

## `src/lib/auth.ts`

Implement the exact signatures in CONTRACTS §5:
- `issueToken()` → `crypto.randomUUID()`.
- `signToken` / `verifyToken` → `cookie-signature` `sign`/`unsign` with
  `process.env.HMAC_SECRET`. Throw at module load if `HMAC_SECRET` is unset.
- `createIpUaHash(ip, ua)` → `sha256(\`${ip}|${ua}\`)` hex, `.slice(0, 32)`.
- Export `COOKIE_NAME = 'user_token'` and `COOKIE_OPTS` exactly as in §5.

## `src/lib/csrf.ts`

- `checkOrigin(request)` → read `Origin` (fallback `Referer`); return true only
  if its URL origin === `process.env.ALLOWED_ORIGIN`. Missing header → false.

## `src/lib/semaphore.ts`

- `Semaphore` class with `constructor(max)` and `run(fn)` per §5. Must serialize
  beyond `max` concurrent runs and release on both resolve and reject.

## `src/lib/rateLimit.ts`

- `rateLimit(key, limit, windowMs)` → in-memory fixed/sliding window per key,
  returns `true` if allowed. This is a best-effort app fallback behind nginx;
  a simple `Map<string, number[]>` of timestamps is fine. No external deps.

## `src/middleware.ts`

Astro `onRequest`:
1. Resolve client IP: `X-Real-IP` header if present, else the connection
   remote address (dev fallback). Store on `context.locals.clientIp`.
   **Never read `X-Forwarded-For`** — nginx *appends* to the client-supplied
   value, so its first hop is attacker-controlled; trusting it would let anyone
   spoof the `ip_ua_hash` vote dedupe and rate limits. nginx always overwrites
   `X-Real-IP` with the true `$remote_addr`, which is why it is the only
   trusted source. Do not "improve" this by adding an XFF fallback.
2. Read `user_token` cookie; `verifyToken` it. If valid, use it; otherwise
   `issueToken()` and set the signed cookie with `COOKIE_OPTS`. Store the
   plain token on `context.locals.userToken`.
3. Declare the `App.Locals` augmentation from CONTRACTS §5.

## Constraints

- Do not perform CSRF enforcement here — routes call `checkOrigin` themselves
  (CONTRACTS §8). Middleware only sets cookie + locals.
- No packages beyond `cookie-signature` and Node built-ins.

## Acceptance check

`npm run build` succeeds. Then a quick self-check (you may write a throwaway
script, delete after):
- `verifyToken(signToken(t)) === t`; tampered string → `false`.
- `createIpUaHash('1.2.3.4','UA')` is 32 hex chars and stable.
- `new Semaphore(2)` never runs >2 of 5 concurrent tasks at once.

Report results of all three.
