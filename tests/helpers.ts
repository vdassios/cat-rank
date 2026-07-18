import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import sharp from 'sharp';
import { db, rawDb } from '../src/db/connection';

/** Apply the committed drizzle migrations to this test file's temp DB. */
export function applyMigrations(): void {
  migrate(db, { migrationsFolder: './drizzle/migrations' });
}

/** Empty all tables (children first — foreign_keys is ON). */
export function resetDb(): void {
  rawDb.exec('DELETE FROM votes; DELETE FROM comments; DELETE FROM cats;');
}

/** Insert a cat row with placeholder paths; returns its id. */
export function insertCat(name = 'Testcat'): number {
  const result = rawDb
    .prepare('INSERT INTO cats (name, thumbnail_path, image_path) VALUES (?, ?, ?)')
    .run(name, '/uploads/0_thumb.webp', '/uploads/0_full.webp');
  return Number(result.lastInsertRowid);
}

// --- Magic-byte fixtures (tasks/TESTING.md T03) ---

/** JPEG SOI + JFIF APP0 marker. */
export const JPEG_JFIF = Buffer.from('ffd8ffe0', 'hex');
/** JPEG SOI + Exif APP1 marker. */
export const JPEG_EXIF = Buffer.from('ffd8ffe1', 'hex');
/** Full 8-byte PNG signature. */
export const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');
/** RIFF container declaring WEBP at bytes 8-11. */
export const WEBP_SIG = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([16, 0, 0, 0]), // chunk size — arbitrary
  Buffer.from('WEBP'),
]);
/** RIFF container that is NOT WebP (a WAV header). */
export const RIFF_WAVE = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([16, 0, 0, 0]),
  Buffer.from('WAVE'),
]);

/** Real raster image generated with sharp — deterministic, offline. */
export async function makeImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 210, g: 120, b: 60 } },
  })
    [format]()
    .toBuffer();
}
