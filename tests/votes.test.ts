import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import LikeRoute from '../src/pages/api/cats/[id]/like.astro';
import { rawDb } from '../src/db/connection';
import { applyMigrations, insertCat, renderPartialRoute, resetDb } from './helpers';

const ORIGIN = process.env.ALLOWED_ORIGIN!;

function likesCount(catId: number): number {
  const row = rawDb.prepare('SELECT likes_count AS n FROM cats WHERE id = ?').get(catId) as {
    n: number;
  };
  return row.n;
}

function voteCount(catId: number): number {
  const row = rawDb.prepare('SELECT count(*) AS n FROM votes WHERE cat_id = ?').get(catId) as {
    n: number;
  };
  return row.n;
}

async function like(
  catId: number,
  locals: { userToken?: string; clientIp?: string } = {},
  opts: { origin?: string | null; userAgent?: string } = {},
) {
  const headers: Record<string, string> = {};
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.Origin = origin;
  headers['user-agent'] = opts.userAgent ?? 'test-ua';
  return renderPartialRoute(LikeRoute, {
    request: new Request(`http://localhost:4321/api/cats/${catId}/like`, {
      method: 'POST',
      headers,
    }),
    params: { id: String(catId) },
    locals,
  });
}

beforeAll(() => {
  applyMigrations();
});

beforeEach(() => {
  resetDb();
});

describe('POST /api/cats/[id]/like (CONTRACTS §10)', () => {
  it('is idempotent: the same user liking twice increments once', async () => {
    const catId = insertCat();
    const res1 = await like(catId, { userToken: 'u1', clientIp: '1.1.1.1' });
    expect(res1.status).toBe(200);
    const res2 = await like(catId, { userToken: 'u1', clientIp: '1.1.1.1' });
    expect(res2.status).toBe(200);
    expect(likesCount(catId)).toBe(1);
    // The second response is a real liked button, not an empty 200.
    const body = await res2.text();
    expect(body).toContain(`hx-post="/api/cats/${catId}/like"`);
    expect(body).toContain('★');
    expect(body).not.toContain('☆');
  });

  it('rejects a second vote with a different token but same IP+UA hash', async () => {
    const catId = insertCat();
    await like(catId, { userToken: 'u1', clientIp: '1.1.1.1' });
    const res2 = await like(catId, { userToken: 'u2', clientIp: '1.1.1.1' });
    expect(res2.status).toBe(200); // idempotent, still returns a liked button
    expect(likesCount(catId)).toBe(1);
    const body = await res2.text();
    expect(body).toContain(`hx-post="/api/cats/${catId}/like"`);
    expect(body).toContain('★');
    expect(body).not.toContain('☆');
  });

  it('counts two genuinely distinct users', async () => {
    const catId = insertCat();
    await like(catId, { userToken: 'u1', clientIp: '1.1.1.1' });
    await like(catId, { userToken: 'u2', clientIp: '2.2.2.2' });
    expect(likesCount(catId)).toBe(2);
    expect(voteCount(catId)).toBe(2);
  });

  it('returns 403 for a foreign Origin and inserts no row', async () => {
    const catId = insertCat();
    const res = await like(
      catId,
      { userToken: 'u1', clientIp: '1.1.1.1' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden');
    expect(voteCount(catId)).toBe(0);
  });

  it('returns 404 for a nonexistent cat', async () => {
    const res = await like(999999, { userToken: 'u1', clientIp: '1.1.1.1' });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });
});
