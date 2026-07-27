import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rawDb } from '../src/db/connection';
import { applyMigrations, insertCat, resetDb } from './helpers';

beforeAll(() => {
  applyMigrations();
});

beforeEach(() => {
  resetDb();
});

function sqliteMasterNames(type: 'table' | 'index'): string[] {
  return rawDb
    .prepare('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => (row as { name: string }).name);
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
    return 'NO_ERROR';
  } catch (err) {
    return (err as { code?: string }).code ?? 'NO_CODE';
  }
}

const insertVote = (catId: number, token: string, hash: string) =>
  rawDb
    .prepare('INSERT INTO votes (cat_id, user_token, ip_ua_hash) VALUES (?, ?, ?)')
    .run(catId, token, hash);

const insertComment = (catId: number, token: string, text: string) =>
  rawDb
    .prepare('INSERT INTO comments (cat_id, user_token, text) VALUES (?, ?, ?)')
    .run(catId, token, text);

describe('connection pragmas (CONTRACTS §5)', () => {
  it('journal_mode is WAL', () => {
    expect(rawDb.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('wal_autocheckpoint is 0 — Litestream owns checkpointing', () => {
    expect(rawDb.pragma('wal_autocheckpoint', { simple: true })).toBe(0);
  });

  it('busy_timeout is 5000', () => {
    expect(rawDb.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('foreign_keys is ON', () => {
    expect(rawDb.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('migrated schema (CONTRACTS §6)', () => {
  it('creates the cats, votes, and comments tables', () => {
    const tables = sqliteMasterNames('table');
    for (const t of ['cats', 'votes', 'comments']) {
      expect(tables).toContain(t);
    }
  });

  it('creates all four contract indexes', () => {
    const indexes = sqliteMasterNames('index');
    for (const i of ['idx_cats_likes', 'idx_cats_created', 'idx_votes_cat', 'idx_comments_cat']) {
      expect(indexes).toContain(i);
    }
  });

  it('applies column defaults: likes_count 0, created_at now()', () => {
    const id = insertCat();
    const row = rawDb.prepare('SELECT likes_count, created_at FROM cats WHERE id = ?').get(id) as {
      likes_count: number;
      created_at: string;
    };
    expect(row.likes_count).toBe(0);
    expect(row.created_at).toBeTruthy();
  });
});

describe('constraints', () => {
  it('rejects a second vote by the same user_token on the same cat', () => {
    const catId = insertCat();
    insertVote(catId, 'token-a', 'hash-1');
    expect(errorCode(() => insertVote(catId, 'token-a', 'hash-2'))).toMatch(/^SQLITE_CONSTRAINT/);
  });

  it('rejects a second vote with the same ip_ua_hash even under a new token (cookie-clearing defense)', () => {
    const catId = insertCat();
    insertVote(catId, 'token-a', 'hash-1');
    expect(errorCode(() => insertVote(catId, 'token-b', 'hash-1'))).toMatch(/^SQLITE_CONSTRAINT/);
  });

  it('rejects a second comment by the same user_token on the same cat', () => {
    const catId = insertCat();
    insertComment(catId, 'token-a', 'first');
    expect(errorCode(() => insertComment(catId, 'token-a', 'second'))).toMatch(
      /^SQLITE_CONSTRAINT/,
    );
  });

  it('enforces foreign keys on votes and comments', () => {
    expect(errorCode(() => insertVote(999999, 'token-a', 'hash-1'))).toMatch(/^SQLITE_CONSTRAINT/);
    expect(errorCode(() => insertComment(999999, 'token-a', 'text'))).toMatch(/^SQLITE_CONSTRAINT/);
  });
});

describe('dedupe precursors (CONTRACTS §10 ground rules)', () => {
  it('lets the same user_token vote on two different cats', () => {
    const a = insertCat('A');
    const b = insertCat('B');
    insertVote(a, 'token-a', 'hash-1');
    insertVote(b, 'token-a', 'hash-1');
    const count = rawDb
      .prepare('SELECT count(*) AS n FROM votes WHERE user_token = ?')
      .get('token-a') as { n: number };
    expect(count.n).toBe(2);
  });

  it('records two genuinely distinct users on one cat', () => {
    const catId = insertCat();
    insertVote(catId, 'token-a', 'hash-1');
    insertVote(catId, 'token-b', 'hash-2');
    const count = rawDb.prepare('SELECT count(*) AS n FROM votes WHERE cat_id = ?').get(catId) as {
      n: number;
    };
    expect(count.n).toBe(2);
  });
});
