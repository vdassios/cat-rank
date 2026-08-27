import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/connection';
import { cats, comments, votes } from '../src/db/schema';
import { validateCat } from '../src/validation/isCat';
import { refreshLocal } from '../scripts/refresh-local';
import { applyMigrations, insertCat, makeImage, resetDb, RIFF_WAVE } from './helpers';

vi.mock('../src/validation/isCat', () => ({ validateCat: vi.fn() }));

const validateCatMock = vi.mocked(validateCat);
const UPLOAD_DIR = process.env.UPLOAD_DIR!;

beforeAll(applyMigrations);

beforeEach(() => {
  resetDb();
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  validateCatMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of srcDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const srcDirs: string[] = [];

function makeSourceDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kot-src-'));
  srcDirs.push(dir);
  return dir;
}

function writeFile(dir: string, name: string, content: Buffer): void {
  fs.writeFileSync(path.join(dir, name), content);
}

const realExistsSync = fs.existsSync;

function stubModel(present: boolean): void {
  vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
    String(p).endsWith('mobilenetv2-cat.onnx') ? present : realExistsSync(p),
  );
}

function stubDefaultEnv(): void {
  vi.stubEnv('LOCAL_DEV', '1');
  stubModel(true);
}

function webpFiles(): string[] {
  return fs.readdirSync(UPLOAD_DIR).filter((f) => /_(thumb|full)\.webp$/.test(f));
}

function catNames(): string[] {
  return db
    .select()
    .from(cats)
    .all()
    .map((c) => c.name);
}

describe('refreshLocal (Task 14)', () => {
  it('imports three files in lexical order with sanitized names', async () => {
    stubDefaultEnv();
    const dir = makeSourceDir();
    writeFile(dir, 'b.png', await makeImage(40, 40, 'png'));
    writeFile(dir, 'a.jpg', await makeImage(40, 40, 'jpeg'));
    writeFile(dir, '<b>Fluffy the third.webp', await makeImage(40, 40, 'webp'));

    await refreshLocal(dir);

    expect(catNames()).toEqual(['Fluffy the third', 'a', 'b']);
    expect(webpFiles()).toHaveLength(6);
    expect(db.select().from(votes).all()).toHaveLength(0);
    expect(db.select().from(comments).all()).toHaveLength(0);
  });

  it('re-running replaces the dataset', async () => {
    stubDefaultEnv();
    const first = makeSourceDir();
    writeFile(first, 'one.jpg', await makeImage(40, 40, 'jpeg'));
    await refreshLocal(first);
    const firstRunWebps = webpFiles();
    expect(firstRunWebps).toHaveLength(2);

    const second = makeSourceDir();
    writeFile(second, 'two.png', await makeImage(40, 40, 'png'));
    await refreshLocal(second);

    expect(catNames()).toEqual(['two']);
    const secondRunWebps = webpFiles();
    expect(secondRunWebps).toHaveLength(2);
    for (const f of firstRunWebps) {
      expect(secondRunWebps).not.toContain(f);
    }
  });

  it('rejects an oversize file and leaves prior data intact', async () => {
    stubDefaultEnv();
    insertCat();
    const dir = makeSourceDir();
    writeFile(dir, 'big.jpg', Buffer.alloc(10 * 1024 * 1024 + 1));

    await expect(refreshLocal(dir)).rejects.toThrow(/Validation failed — nothing was changed:/);
    await expect(refreshLocal(dir)).rejects.toThrow(/big\.jpg: File too large \(max 10MB\)/);

    expect(db.select().from(cats).all()).toHaveLength(1);
    expect(webpFiles()).toHaveLength(0);
  });

  it('rejects a file with bad magic bytes', async () => {
    stubDefaultEnv();
    insertCat();
    const dir = makeSourceDir();
    writeFile(dir, 'x.webp', RIFF_WAVE);

    await expect(refreshLocal(dir)).rejects.toThrow(/x\.webp: Unsupported format/);
    expect(db.select().from(cats).all()).toHaveLength(1);
  });

  it('rejects a file with a bad extension', async () => {
    stubDefaultEnv();
    insertCat();
    const dir = makeSourceDir();
    writeFile(dir, 'x.gif', await makeImage(40, 40, 'jpeg'));

    await expect(refreshLocal(dir)).rejects.toThrow(/x\.gif: Unsupported file type/);
    expect(db.select().from(cats).all()).toHaveLength(1);
  });

  it('rejects a file that is not a cat', async () => {
    stubDefaultEnv();
    insertCat();
    validateCatMock.mockResolvedValue(false);
    const dir = makeSourceDir();
    writeFile(dir, 'dog.jpg', await makeImage(40, 40, 'jpeg'));

    await expect(refreshLocal(dir)).rejects.toThrow(/dog\.jpg: We couldn't verify this is a cat/);
    expect(db.select().from(cats).all()).toHaveLength(1);
  });

  it('aborts when LOCAL_DEV is not set', async () => {
    stubModel(true);
    const dir = makeSourceDir();
    writeFile(dir, 'a.jpg', await makeImage(40, 40, 'jpeg'));

    await expect(refreshLocal(dir)).rejects.toThrow(
      /LOCAL_DEV=1 is required — run this via "npm run local:refresh"/,
    );
    expect(db.select().from(cats).all()).toHaveLength(0);
    expect(webpFiles()).toHaveLength(0);
  });

  it('aborts on a production database path', async () => {
    stubDefaultEnv();
    vi.stubEnv('DATABASE_PATH', '/app/data/cats.db');
    const dir = makeSourceDir();
    writeFile(dir, 'a.jpg', await makeImage(40, 40, 'jpeg'));

    await expect(refreshLocal(dir)).rejects.toThrow(
      /Refusing to run against production path: \/app\/data\/cats\.db/,
    );
    expect(webpFiles()).toHaveLength(0);
  });

  it('aborts when the model is missing', async () => {
    vi.stubEnv('LOCAL_DEV', '1');
    stubModel(false);
    const dir = makeSourceDir();
    writeFile(dir, 'a.jpg', await makeImage(40, 40, 'jpeg'));

    await expect(refreshLocal(dir)).rejects.toThrow(
      /Model missing: models\/mobilenetv2-cat\.onnx — run "npm run local:model" first/,
    );
    expect(db.select().from(cats).all()).toHaveLength(0);
  });

  it('aborts when the source dir has no images', async () => {
    stubDefaultEnv();
    const dir = makeSourceDir();
    writeFile(dir, 'README.md', Buffer.from('readme'));
    writeFile(dir, '.gitkeep', Buffer.alloc(0));

    await expect(refreshLocal(dir)).rejects.toThrow(
      new RegExp(`No images found in ${dir} — add photos, then re-run`),
    );
    expect(db.select().from(cats).all()).toHaveLength(0);
  });

  it('cleans up the processed pair when the insert fails', async () => {
    stubDefaultEnv();
    const insertSpy = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw new Error('insert boom');
    });
    const dir = makeSourceDir();
    writeFile(dir, 'a.jpg', await makeImage(40, 40, 'jpeg'));

    await expect(refreshLocal(dir)).rejects.toThrow('insert boom');
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(webpFiles()).toHaveLength(0);
    expect(db.select().from(cats).all()).toHaveLength(0);
  });
});
