import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { GET as healthGet } from '../src/pages/health';
import CatsIndex from '../src/pages/api/cats/index.astro';
import CatDetail from '../src/pages/api/cats/[id]/index.astro';
import * as catsIndexMod from '../src/pages/api/cats/index.astro';
import * as catDetailMod from '../src/pages/api/cats/[id]/index.astro';
import * as catLikeMod from '../src/pages/api/cats/[id]/like.astro';
import * as catCommentsMod from '../src/pages/api/cats/[id]/comments.astro';
import * as submitFormMod from '../src/pages/api/submit-form.astro';
import { rawDb } from '../src/db/connection';
import { applyMigrations, insertCat, renderPartialRoute, resetDb } from './helpers';

function insertCatWithLikes(name: string, likes: number): number {
  const result = rawDb
    .prepare('INSERT INTO cats (name, thumbnail_path, image_path, likes_count) VALUES (?, ?, ?, ?)')
    .run(name, '/uploads/0_thumb.webp', '/uploads/0_full.webp', likes);
  return Number(result.lastInsertRowid);
}

function insertCatAt(name: string, createdAt: string, likes = 0): number {
  const result = rawDb
    .prepare(
      'INSERT INTO cats (name, thumbnail_path, image_path, likes_count, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(name, '/uploads/0_thumb.webp', '/uploads/0_full.webp', likes, createdAt);
  return Number(result.lastInsertRowid);
}

function gridNames(body: string): string[] {
  return [...body.matchAll(/class="cat-card-thumb"[^>]*alt="([^"]*)"/g)].map((m) => m[1]);
}

function insertVote(catId: number, token: string, hash: string) {
  rawDb
    .prepare('INSERT INTO votes (cat_id, user_token, ip_ua_hash) VALUES (?, ?, ?)')
    .run(catId, token, hash);
}

function insertComment(catId: number, token: string, text: string) {
  rawDb
    .prepare('INSERT INTO comments (cat_id, user_token, text) VALUES (?, ?, ?)')
    .run(catId, token, text);
}

beforeAll(() => {
  applyMigrations();
});

beforeEach(() => {
  resetDb();
});

describe('/health', () => {
  it('returns ok when the DB is writable and the upload dir exists', async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"status":"ok"}');
  });

  it('returns 503 unhealthy when the upload dir is missing', async () => {
    const uploadDir = process.env.UPLOAD_DIR!;
    fs.rmSync(uploadDir, { recursive: true, force: true });
    try {
      const res = await healthGet();
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('unhealthy');
    } finally {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  });
});

describe('GET /api/cats grid', () => {
  it('excludes the top cat and paginates 12 per page', async () => {
    insertCatWithLikes('TopCat', 100);
    for (let i = 0; i < 13; i += 1) insertCat(`Cat ${i}`);

    const page1 = await renderPartialRoute(CatsIndex, {
      request: new Request('http://localhost:4321/api/cats?page=1'),
    });
    const body1 = await page1.text();
    const tiles1 = (body1.match(/class="cat-card"/g) ?? []).length;
    expect(tiles1).toBe(12);
    expect(body1).not.toContain('TopCat');

    const page2 = await renderPartialRoute(CatsIndex, {
      request: new Request('http://localhost:4321/api/cats?page=2'),
    });
    const body2 = await page2.text();
    const tiles2 = (body2.match(/class="cat-card"/g) ?? []).length;
    expect(tiles2).toBe(1);
    // No sentinel when there is no next page
    expect(body2).not.toContain('hx-trigger="revealed"');
  });

  it('orders tiles newest first (created_at DESC)', async () => {
    insertCatWithLikes('TopCat', 100);
    insertCatAt('Oldest', '2024-01-01 00:00:01');
    insertCatAt('Middle', '2024-01-02 00:00:00');
    insertCatAt('Newest', '2024-01-03 00:00:00');

    const res = await renderPartialRoute(CatsIndex, {
      request: new Request('http://localhost:4321/api/cats?page=1'),
    });
    const body = await res.text();
    expect(gridNames(body)).toEqual(['Newest', 'Middle', 'Oldest']);
  });
});

describe('GET /api/cats/[id]', () => {
  it('returns 404 for a missing cat', async () => {
    const res = await renderPartialRoute(CatDetail, {
      request: new Request('http://localhost:4321/api/cats/999999'),
      params: { id: '999999' },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  it('reflects a liked cat for the requesting user', async () => {
    const catId = insertCat('LikedCat');
    insertVote(catId, 'u1', 'hash-1');
    const res = await renderPartialRoute(CatDetail, {
      request: new Request(`http://localhost:4321/api/cats/${catId}`),
      params: { id: String(catId) },
      locals: { userToken: 'u1' },
    });
    const body = await res.text();
    expect(body).toContain('LikedCat');
    expect(body).toContain('★');
    expect(body).not.toContain('☆');
  });

  it('replaces the comment form with a notice for an already-commented user', async () => {
    const catId = insertCat('CommentedCat');
    insertComment(catId, 'u1', 'already here');
    const res = await renderPartialRoute(CatDetail, {
      request: new Request(`http://localhost:4321/api/cats/${catId}`),
      params: { id: String(catId) },
      locals: { userToken: 'u1' },
    });
    const body = await res.text();
    expect(body).toContain('You commented on this cat');
  });
});

describe('per-cat scoping (CONTRACTS §8 and() rule)', () => {
  it('does not leak liked/comment state across cats', async () => {
    const cat1 = insertCat('Cat One');
    const cat2 = insertCat('Cat Two');
    insertVote(cat1, 'u1', 'hash-1');
    insertComment(cat1, 'u1', 'only on cat one');

    const res = await renderPartialRoute(CatDetail, {
      request: new Request(`http://localhost:4321/api/cats/${cat2}`),
      params: { id: String(cat2) },
      locals: { userToken: 'u1' },
    });
    const body = await res.text();
    expect(body).toContain('Cat Two');
    expect(body).toContain('☆'); // unliked
    expect(body).not.toContain('You commented on this cat'); // canComment true
  });
});

describe('partial exports', () => {
  it.each([catsIndexMod, catDetailMod, catLikeMod, catCommentsMod, submitFormMod])(
    'exports partial = true',
    (mod) => {
      expect(mod.partial).toBe(true);
    },
  );
});
