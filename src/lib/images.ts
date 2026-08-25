import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

export interface ProcessedImage {
  thumbnailPath: string;
  imagePath: string;
}

async function ensureDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

async function removeIfExists(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code !== 'ENOENT') throw err;
  }
}

export async function processImage(buf: Buffer, storageKey: string): Promise<ProcessedImage> {
  await ensureDir();

  const thumbPath = path.join(UPLOAD_DIR, `${storageKey}_thumb.webp`);
  const fullPath = path.join(UPLOAD_DIR, `${storageKey}_full.webp`);

  const pipeline = sharp(buf).rotate();

  try {
    await pipeline
      .clone()
      .resize({ width: 300, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(thumbPath);

    await pipeline
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(fullPath);
  } catch {
    await removeIfExists(thumbPath);
    await removeIfExists(fullPath);
    throw new Error('Image processing failed');
  }

  return {
    thumbnailPath: `/uploads/${storageKey}_thumb.webp`,
    imagePath: `/uploads/${storageKey}_full.webp`,
  };
}

export async function deleteProcessedImages(storageKey: string): Promise<void> {
  await Promise.all([
    removeIfExists(path.join(UPLOAD_DIR, `${storageKey}_thumb.webp`)),
    removeIfExists(path.join(UPLOAD_DIR, `${storageKey}_full.webp`)),
  ]);
}
