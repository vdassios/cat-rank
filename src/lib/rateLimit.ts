const buckets = new Map<string, number[]>();
const windows = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of buckets) {
    const windowMs = windows.get(key) ?? 60000;
    const cutoff = now - windowMs;
    const firstKeep = timestamps.findIndex((t) => t > cutoff);
    if (firstKeep === -1) {
      buckets.delete(key);
      windows.delete(key);
    } else if (firstKeep > 0) {
      buckets.set(key, timestamps.slice(firstKeep));
    }
  }
}, 60000).unref();

/**
 * Best-effort abuse prevention per user — second line of defense behind nginx.
 *
 * Every sensitive request (upload, like, comment) is checked against a key —
 * in this app that's the client IP resolved by the middleware. The question
 * it answers is: "has this IP already done this action `limit` times in the
 * last `windowMs` milliseconds?" If yes, the route returns an error instead
 * of doing the work.
 *
 * ## Mechanics
 *
 * A `Map<string, number[]>` stores lists of timestamps per key. On each call
 * it drops timestamps older than the window, and if fewer than `limit` remain,
 * it records the new one and returns `true` (allowed). Denied attempts are NOT
 * recorded — hammering a blocked endpoint doesn't extend your own lockout.
 *
 * ## Design notes
 *
 * 1. **Second line of defense.** nginx sits in front with `limit_req` doing
 *    the real rate limiting. This in-process copy only catches whatever
 *    nginx's config misses or traffic that reaches the app directly. That's
 *    why "best-effort, in-memory, no external deps" is acceptable — if the
 *    process restarts and the map is wiped, nothing important is lost.
 *
 * 2. **Per-key fairness.** One abusive IP gets throttled; everyone else is
 *    unaffected.
 *
 * @param key      The identifier to rate-limit (typically the client IP).
 * @param limit    Maximum allowed requests within the window.
 * @param windowMs Window size in milliseconds.
 * @returns `true` if the request is allowed, `false` if it should be rejected.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = buckets.get(key);

  windows.set(key, Math.max(windows.get(key) ?? 0, windowMs));

  if (!timestamps) {
    buckets.set(key, [now]);
    return true;
  }

  const threshold = now - windowMs;
  const filtered = timestamps.filter((t) => t > threshold);

  if (filtered.length < limit) {
    filtered.push(now);
    buckets.set(key, filtered);
    return true;
  }

  buckets.set(key, filtered);
  return false;
}
