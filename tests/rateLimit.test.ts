import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rateLimit } from '../src/lib/rateLimit';

// Module-level bucket state persists across tests in this file — every test
// uses its own key so cases stay independent.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimit (CONTRACTS §5)', () => {
  it('allows up to limit calls and denies the next one', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k-limit', 3, 1000)).toBe(true);
    }
    expect(rateLimit('k-limit', 3, 1000)).toBe(false);
  });

  it('allows again after the window passes', () => {
    expect(rateLimit('k-window', 2, 1000)).toBe(true);
    expect(rateLimit('k-window', 2, 1000)).toBe(true);
    expect(rateLimit('k-window', 2, 1000)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rateLimit('k-window', 2, 1000)).toBe(true);
  });

  it('does not record denied attempts (hammering never extends the lockout)', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k-denied', 3, 1000)).toBe(true); // t=0
    }
    vi.advanceTimersByTime(500);
    for (let i = 0; i < 10; i++) {
      expect(rateLimit('k-denied', 3, 1000)).toBe(false); // t=500, all denied
    }
    // t=1001: the three allowed stamps (t=0) have expired. The denied burst at
    // t=500 would still be in-window — if it had been recorded, this would deny.
    vi.advanceTimersByTime(501);
    expect(rateLimit('k-denied', 3, 1000)).toBe(true);
  });

  it('tracks keys independently', () => {
    expect(rateLimit('k-indep-a', 1, 1000)).toBe(true);
    expect(rateLimit('k-indep-a', 1, 1000)).toBe(false);
    expect(rateLimit('k-indep-b', 1, 1000)).toBe(true);
  });
});
