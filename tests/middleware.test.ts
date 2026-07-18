import type { APIContext, MiddlewareNext } from 'astro';
import { describe, expect, it, vi } from 'vitest';
import { COOKIE_NAME, COOKIE_OPTS, signToken, verifyToken } from '../src/lib/auth';

// astro:middleware is a virtual module that only exists inside an Astro
// build; defineMiddleware is an identity function at runtime.
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: unknown) => fn,
}));

import { onRequest } from '../src/middleware';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeContext(opts: { headers?: Record<string, string>; cookie?: string } = {}) {
  const cookies = {
    get: vi.fn(() => (opts.cookie === undefined ? undefined : { value: opts.cookie })),
    set: vi.fn(),
  };
  const locals = {} as App.Locals;
  const context = {
    request: new Request('http://localhost:4321/', { headers: opts.headers ?? {} }),
    cookies,
    locals,
    clientAddress: '10.0.0.9',
  };
  const next = vi.fn(async () => new Response('downstream'));
  return {
    context: context as unknown as APIContext,
    next: next as MiddlewareNext,
    nextSpy: next,
    cookies,
    locals,
  };
}

describe('client IP resolution', () => {
  it('uses X-Real-IP when present (nginx-controlled)', async () => {
    const { context, next, locals } = makeContext({ headers: { 'X-Real-IP': '203.0.113.7' } });
    await onRequest(context, next);
    expect(locals.clientIp).toBe('203.0.113.7');
  });

  it('falls back to the connection address without X-Real-IP', async () => {
    const { context, next, locals } = makeContext();
    await onRequest(context, next);
    expect(locals.clientIp).toBe('10.0.0.9');
  });

  it('ignores X-Forwarded-For — spoofable, never trusted (V4 security fix)', async () => {
    const { context, next, locals } = makeContext({
      headers: { 'X-Forwarded-For': '6.6.6.6, 7.7.7.7' },
    });
    await onRequest(context, next);
    expect(locals.clientIp).toBe('10.0.0.9');
  });
});

describe('user_token cookie', () => {
  it('issues a signed cookie when none exists', async () => {
    const { context, next, cookies, locals } = makeContext();
    await onRequest(context, next);

    expect(locals.userToken).toMatch(UUID_RE);
    expect(cookies.set).toHaveBeenCalledTimes(1);
    const [name, value, cookieOpts] = cookies.set.mock.calls[0] as [string, string, object];
    expect(name).toBe(COOKIE_NAME);
    expect(verifyToken(value)).toBe(locals.userToken);
    expect(cookieOpts).toEqual(COOKIE_OPTS);
  });

  it('reuses a valid signed cookie without re-setting it', async () => {
    const token = '11111111-2222-3333-4444-555555555555';
    const { context, next, cookies, locals } = makeContext({ cookie: signToken(token) });
    await onRequest(context, next);

    expect(locals.userToken).toBe(token);
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it('replaces a tampered cookie with a fresh token', async () => {
    const token = '11111111-2222-3333-4444-555555555555';
    const signed = signToken(token);
    const tampered = signed.slice(0, -1) + (signed.endsWith('a') ? 'b' : 'a');
    const { context, next, cookies, locals } = makeContext({ cookie: tampered });
    await onRequest(context, next);

    expect(locals.userToken).toMatch(UUID_RE);
    expect(locals.userToken).not.toBe(token);
    expect(cookies.set).toHaveBeenCalledTimes(1);
  });
});

describe('chain', () => {
  it('calls next exactly once and returns its response', async () => {
    const { context, next, nextSpy } = makeContext();
    const response = await onRequest(context, next);
    expect(nextSpy).toHaveBeenCalledTimes(1);
    expect(await (response as Response).text()).toBe('downstream');
  });
});
