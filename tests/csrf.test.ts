import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkOrigin } from '../src/lib/csrf';

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost:4321/api/test', { method: 'POST', headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('checkOrigin (CONTRACTS §5)', () => {
  it('accepts a matching Origin', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'http://localhost:4321');
    expect(checkOrigin(req({ Origin: 'http://localhost:4321' }))).toBe(true);
  });

  it('rejects a foreign Origin', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'http://localhost:4321');
    expect(checkOrigin(req({ Origin: 'https://evil.example' }))).toBe(false);
  });

  it('rejects when both Origin and Referer are missing', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'http://localhost:4321');
    expect(checkOrigin(req({}))).toBe(false);
  });

  it('falls back to Referer and extracts its origin from the full URL', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'http://localhost:4321');
    expect(checkOrigin(req({ Referer: 'http://localhost:4321/some/page?x=1' }))).toBe(true);
  });

  it('rejects a foreign Referer', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'http://localhost:4321');
    expect(checkOrigin(req({ Referer: 'https://evil.example/some/page' }))).toBe(false);
  });

  it('rejects a malformed Origin without throwing', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'http://localhost:4321');
    expect(checkOrigin(req({ Origin: 'not a url' }))).toBe(false);
  });
});

describe('checkOrigin with LOCAL_DEV=1', () => {
  it('accepts a request with no headers', () => {
    vi.stubEnv('LOCAL_DEV', '1');
    expect(checkOrigin(req({}))).toBe(true);
  });

  it('skips header inspection entirely, even for a foreign Origin', () => {
    vi.stubEnv('LOCAL_DEV', '1');
    expect(checkOrigin(req({ Origin: 'https://evil.example' }))).toBe(true);
  });
});
