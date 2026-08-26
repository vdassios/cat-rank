import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import CommentsRoute from '../src/pages/api/cats/[id]/comments.astro';
import { rawDb } from '../src/db/connection';
import { applyMigrations, insertCat, renderPartialRoute, resetDb } from './helpers';

const ORIGIN = process.env.ALLOWED_ORIGIN!;

function commentCount(catId: number): number {
  const row = rawDb.prepare('SELECT count(*) AS n FROM comments WHERE cat_id = ?').get(catId) as {
    n: number;
  };
  return row.n;
}

function insertCommentAt(catId: number, token: string, text: string, createdAt: string) {
  rawDb
    .prepare('INSERT INTO comments (cat_id, user_token, text, created_at) VALUES (?, ?, ?, ?)')
    .run(catId, token, text, createdAt);
}

function commentTexts(body: string): string[] {
  return [...body.matchAll(/class="comment-item-text"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);
}

async function postComment(
  catId: number,
  text: string,
  locals: { userToken?: string } = {},
  opts: { origin?: string | null } = {},
) {
  const form = new FormData();
  form.set('text', text);
  const headers: Record<string, string> = {};
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.Origin = origin;
  return renderPartialRoute(CommentsRoute, {
    request: new Request(`http://localhost:4321/api/cats/${catId}/comments`, {
      method: 'POST',
      body: form,
      headers,
    }),
    params: { id: String(catId) },
    locals,
  });
}

async function getComments(catId: number, page = 1) {
  return renderPartialRoute(CommentsRoute, {
    request: new Request(`http://localhost:4321/api/cats/${catId}/comments?page=${page}`),
    params: { id: String(catId) },
  });
}

beforeAll(() => {
  applyMigrations();
});

beforeEach(() => {
  resetDb();
});

describe('POST /api/cats/[id]/comments validation (CONTRACTS §9)', () => {
  it('rejects empty text', async () => {
    const catId = insertCat();
    const res = await postComment(catId, '   ');
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Comment cannot be empty');
  });

  it('rejects text longer than 500 chars', async () => {
    const catId = insertCat();
    const res = await postComment(catId, 'x'.repeat(501));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Comment too long (max 500)');
  });

  it('accepts exactly 500 chars', async () => {
    const catId = insertCat();
    const res = await postComment(catId, 'x'.repeat(500));
    expect(res.status).toBe(200);
    expect(commentCount(catId)).toBe(1);
  });

  it('strips HTML tags before insert', async () => {
    const catId = insertCat();
    const res = await postComment(catId, '<b>hi</b> <script>x</script>');
    expect(res.status).toBe(200);
    const row = rawDb.prepare('SELECT text FROM comments WHERE cat_id = ?').get(catId) as {
      text: string;
    };
    expect(row.text).toBe('hi x');
  });

  it('rejects text that becomes empty after stripping', async () => {
    const catId = insertCat();
    const res = await postComment(catId, '<b></b><i></i>');
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Comment cannot be empty');
  });

  it('rejects a second comment by the same user on the same cat', async () => {
    const catId = insertCat();
    await postComment(catId, 'first', { userToken: 'u1' });
    const res = await postComment(catId, 'second', { userToken: 'u1' });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('You already commented on this cat');
  });

  it('maps a constraint failure to the duplicate guard response (never 500)', async () => {
    const catId = insertCat();
    // Force a constraint failure the pre-check cannot see.
    rawDb.exec(`CREATE TRIGGER dup_guard BEFORE INSERT ON comments
      BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed'); END;`);
    try {
      const res = await postComment(catId, 'hi', { userToken: 'fresh-user' });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('You already commented on this cat');
    } finally {
      rawDb.exec('DROP TRIGGER dup_guard');
    }
  });

  it('returns 403 for a foreign Origin', async () => {
    const catId = insertCat();
    const res = await postComment(
      catId,
      'hi',
      { userToken: 'u1' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden');
    expect(commentCount(catId)).toBe(0);
  });
});

describe('POST success response shape (CONTRACTS §8)', () => {
  it('returns the refreshed list and an out-of-band form notice', async () => {
    const catId = insertCat();
    const res = await postComment(catId, 'nice cat', { userToken: 'u1' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="comment-form"');
    expect(body).toContain('hx-swap-oob="true"');
    expect(body).toContain('comment posted');
    expect(body).not.toContain('id="comment-list"');
    expect(body).toContain('nice cat');
  });
});

describe('GET /api/cats/[id]/comments pagination', () => {
  it('paginates 11 comments as 10 + 1 in created_at ASC order', async () => {
    const catId = insertCat();
    for (let i = 0; i < 11; i += 1) {
      const sec = String(i).padStart(2, '0');
      insertCommentAt(catId, `user-${i}`, `comment ${i}`, `2024-01-01 00:00:${sec}`);
    }

    const page1 = await getComments(catId, 1);
    const body1 = await page1.text();
    const texts1 = commentTexts(body1);
    expect(texts1).toHaveLength(10);
    // Ascending order, strictly: the first page holds the 10 oldest comments.
    expect(texts1).toEqual(Array.from({ length: 10 }, (_, i) => `comment ${i}`));

    const page2 = await getComments(catId, 2);
    const body2 = await page2.text();
    expect(commentTexts(body2)).toEqual(['comment 10']);
    // No sentinel (nextPage null) on the last page
    expect(body2).not.toContain('hx-trigger="revealed"');
  });
});
