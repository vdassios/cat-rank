import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { processImage, deleteProcessedImages } from '../src/lib/images';
import { detectMime } from '../src/validation/mime';
import { makeImage } from './helpers';

const UPLOAD_DIR = process.env.UPLOAD_DIR!;
const KEY = '550e8400-e29b-41d4-a716-446655440000';

describe('processImage (CONTRACTS §5)', () => {
  it('writes thumb and full files with the contract filename convention', async () => {
    const buf = await makeImage(400, 300, 'jpeg');
    await processImage(buf, KEY);
    await expect(fs.access(path.join(UPLOAD_DIR, `${KEY}_thumb.webp`))).resolves.toBeUndefined();
    await expect(fs.access(path.join(UPLOAD_DIR, `${KEY}_full.webp`))).resolves.toBeUndefined();
  });

  it('returns public URL paths, not disk paths', async () => {
    const buf = await makeImage(400, 300, 'jpeg');
    const result = await processImage(buf, KEY);
    expect(result.thumbnailPath).toBe(`/uploads/${KEY}_thumb.webp`);
    expect(result.imagePath).toBe(`/uploads/${KEY}_full.webp`);
  });

  it('emits valid WebP output for both sizes', async () => {
    const buf = await makeImage(400, 300, 'jpeg');
    await processImage(buf, KEY);
    const thumbBuf = await fs.readFile(path.join(UPLOAD_DIR, `${KEY}_thumb.webp`));
    const fullBuf = await fs.readFile(path.join(UPLOAD_DIR, `${KEY}_full.webp`));
    expect(detectMime(thumbBuf)).toBe('image/webp');
    expect(detectMime(fullBuf)).toBe('image/webp');
  });

  it('thumbnail width is exactly 300', async () => {
    const buf = await makeImage(800, 600, 'jpeg');
    await processImage(buf, KEY);
    const meta = await sharp(path.join(UPLOAD_DIR, `${KEY}_thumb.webp`)).metadata();
    expect(meta.width).toBe(300);
  });

  it('full image max side does not exceed 1200', async () => {
    const buf = await makeImage(2000, 1000, 'jpeg');
    await processImage(buf, KEY);
    const meta = await sharp(path.join(UPLOAD_DIR, `${KEY}_full.webp`)).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1200);
  });

  it('honors EXIF orientation 6: a 2000×1000 landscape becomes portrait 600×1200', async () => {
    const exifKey = 'exif-rotate-test';
    const base = await makeImage(2000, 1000, 'jpeg');
    const rotated = await sharp(base).withMetadata({ orientation: 6 }).toBuffer();
    await processImage(rotated, exifKey);
    const meta = await sharp(path.join(UPLOAD_DIR, `${exifKey}_full.webp`)).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(1200);
    expect(meta.exif).toBeUndefined();
  });

  it('does not enlarge images smaller than the target sizes', async () => {
    const smallKey = 'small-test-key';
    const buf = await makeImage(100, 80, 'jpeg');
    await processImage(buf, smallKey);
    const thumbMeta = await sharp(path.join(UPLOAD_DIR, `${smallKey}_thumb.webp`)).metadata();
    const fullMeta = await sharp(path.join(UPLOAD_DIR, `${smallKey}_full.webp`)).metadata();
    expect(thumbMeta.width).toBe(100);
    expect(fullMeta.width).toBe(100);
    expect(fullMeta.height).toBe(80);
  });

  it('recreates the upload directory if it is missing', async () => {
    const testDir = path.join(UPLOAD_DIR, 'recreate-test');
    await fs.mkdir(testDir);
    // Temporarily swap UPLOAD_DIR to a path that does not exist, then re-import
    const orig = process.env.UPLOAD_DIR!;
    try {
      process.env.UPLOAD_DIR = testDir;
      vi.resetModules();
      const { processImage: pi } = await import('../src/lib/images');
      const buf = await makeImage(200, 200, 'jpeg');
      await fs.rm(testDir, { recursive: true, force: true });
      await pi(buf, 'mkdir-test');
      await expect(fs.stat(path.join(testDir, 'mkdir-test_thumb.webp'))).resolves.toBeTruthy();
    } finally {
      process.env.UPLOAD_DIR = orig;
      await fs.rm(testDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it('removes the already-written output when the second write fails', async () => {
    // Make the FULL output path a directory so the thumbnail is written first,
    // then the full write fails. This forces the failure to occur AFTER one
    // output exists and proves the cleanup path removes it.
    const failKey = 'fail-key';
    const thumbPath = path.join(UPLOAD_DIR, `${failKey}_thumb.webp`);
    const fullPath = path.join(UPLOAD_DIR, `${failKey}_full.webp`);
    await fs.mkdir(fullPath);
    try {
      await expect(processImage(await makeImage(200, 200, 'jpeg'), failKey)).rejects.toThrow();
    } finally {
      await fs.rm(fullPath, { recursive: true, force: true });
    }
    // The thumbnail was created and then cleaned up; the full path was never a file.
    await expect(fs.access(thumbPath)).rejects.toThrow(/ENOENT/);
    await expect(fs.access(fullPath)).rejects.toThrow(/ENOENT/);
  });
});

describe('deleteProcessedImages (CONTRACTS §5)', () => {
  it('removes both files for a given storage key', async () => {
    const dKey = 'delete-test';
    const buf = await makeImage(200, 200, 'jpeg');
    await processImage(buf, dKey);
    await deleteProcessedImages(dKey);
    await expect(fs.access(path.join(UPLOAD_DIR, `${dKey}_thumb.webp`))).rejects.toThrow(/ENOENT/);
    await expect(fs.access(path.join(UPLOAD_DIR, `${dKey}_full.webp`))).rejects.toThrow(/ENOENT/);
  });

  it('succeeds if files are already absent (idempotent)', async () => {
    await expect(deleteProcessedImages('nonexistent-key')).resolves.toBeUndefined();
  });

  it('rejects on unexpected filesystem errors other than ENOENT', async () => {
    // Path longer than OS MAXPATHLEN — unlink throws ENAMETOOLONG, not ENOENT.
    const tooLong = 'a'.repeat(1024);
    await expect(deleteProcessedImages(tooLong)).rejects.toThrow();
  });
});
