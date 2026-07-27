import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  COOKIE_NAME,
  COOKIE_OPTS,
  createIpUaHash,
  issueToken,
  signToken,
  verifyToken,
} from '../src/lib/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('token signing', () => {
  it('round-trips: verifyToken(signToken(t)) === t', () => {
    const t = issueToken();
    expect(verifyToken(signToken(t))).toBe(t);
  });

  it('rejects a tampered signature', () => {
    const signed = signToken(issueToken());
    const tampered = signed.slice(0, -1) + (signed.endsWith('a') ? 'b' : 'a');
    expect(verifyToken(tampered)).toBe(false);
  });

  it('rejects an unsigned garbage string', () => {
    expect(verifyToken('not-a-signed-token')).toBe(false);
  });

  it('issues unique UUID tokens', () => {
    const a = issueToken();
    const b = issueToken();
    expect(a).toMatch(UUID_RE);
    expect(b).toMatch(UUID_RE);
    expect(a).not.toBe(b);
  });

  it('throws at import when HMAC_SECRET is unset', async () => {
    const saved = process.env.HMAC_SECRET;
    vi.resetModules();
    delete process.env.HMAC_SECRET;
    try {
      await expect(import('../src/lib/auth')).rejects.toThrow(/HMAC_SECRET/);
    } finally {
      process.env.HMAC_SECRET = saved;
    }
  });
});

describe('createIpUaHash (CONTRACTS §5)', () => {
  it('returns 32 lowercase hex chars', () => {
    expect(createIpUaHash('1.2.3.4', 'UA')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic and equals sha256("ip|ua").slice(0, 32)', () => {
    const expected = createHash('sha256').update('1.2.3.4|UA').digest('hex').slice(0, 32);
    expect(createIpUaHash('1.2.3.4', 'UA')).toBe(expected);
    expect(createIpUaHash('1.2.3.4', 'UA')).toBe(expected);
  });

  it('changes when either the IP or the UA changes', () => {
    const base = createIpUaHash('1.2.3.4', 'UA');
    expect(createIpUaHash('1.2.3.5', 'UA')).not.toBe(base);
    expect(createIpUaHash('1.2.3.4', 'UA2')).not.toBe(base);
  });
});

describe('cookie constants (CONTRACTS §5)', () => {
  it('COOKIE_NAME is user_token', () => {
    expect(COOKIE_NAME).toBe('user_token');
  });

  it('COOKIE_OPTS match the contract literal', () => {
    expect(COOKIE_OPTS).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 31536000,
    });
  });
});
