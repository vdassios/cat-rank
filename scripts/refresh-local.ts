import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db } from '../src/db/connection';
import { cats, votes, comments } from '../src/db/schema';
import { detectMime } from '../src/validation/mime';
import { validateCat } from '../src/validation/isCat';
import { processImage, deleteProcessedImages } from '../src/lib/images';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export async function refreshLocal(sourceDir?: string): Promise<void> {
  if (process.env.LOCAL_DEV !== '1') {
    throw new Error('LOCAL_DEV=1 is required — run this via "npm run local:refresh"');
  }

  const dbPath = path.resolve(process.env.DATABASE_PATH ?? './data/cats.db');
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? './data/uploads');

  for (const resolved of [dbPath, uploadDir]) {
    if (resolved.startsWith('/app/data') || resolved.startsWith('/var/lib/cat-ranking')) {
      throw new Error(`Refusing to run against production path: ${resolved}`);
    }
  }

  if (!fs.existsSync(path.resolve('models/mobilenetv2-cat.onnx'))) {
    throw new Error('Model missing: models/mobilenetv2-cat.onnx — run "npm run local:model" first');
  }

  const dir = sourceDir ?? './test-cats';
  const files: string[] = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('.') && name !== 'README.md')
        .sort()
    : [];

  if (files.length === 0) {
    throw new Error(`No images found in ${dir} — add photos, then re-run`);
  }

  const failures: string[] = [];

  for (const filename of files) {
    const buf = fs.readFileSync(path.join(dir, filename));
    let failure: string | null = null;

    if (buf.byteLength > MAX_BYTES) {
      failure = 'File too large (max 10MB)';
    } else if (!ALLOWED_MIMES.includes(detectMime(buf) ?? '')) {
      failure = 'Unsupported format';
    } else if (!ALLOWED_EXTENSIONS.includes(path.extname(filename).toLowerCase())) {
      failure = 'Unsupported file type';
    } else if (!(await validateCat(buf))) {
      failure = "We couldn't verify this is a cat";
    }

    if (failure) failures.push(`${filename}: ${failure}`);
  }

  if (failures.length > 0) {
    throw new Error(`Validation failed — nothing was changed:\n${failures.join('\n')}`);
  }

  db.delete(comments).run();
  db.delete(votes).run();
  db.delete(cats).run();

  fs.mkdirSync(uploadDir, { recursive: true });
  for (const name of fs.readdirSync(uploadDir)) {
    if (/_(thumb|full)\.webp$/.test(name)) {
      fs.unlinkSync(path.join(uploadDir, name));
    }
  }

  let imported = 0;
  for (const filename of files) {
    const name = path
      .parse(filename)
      .name.replace(/<[^>]*>/g, '')
      .trim()
      .slice(0, 60);
    const storageKey = crypto.randomUUID();
    const buf = fs.readFileSync(path.join(dir, filename));
    const processed = await processImage(buf, storageKey);

    try {
      db.insert(cats)
        .values({
          name,
          thumbnailPath: processed.thumbnailPath,
          imagePath: processed.imagePath,
        })
        .run();
    } catch (err) {
      await deleteProcessedImages(storageKey);
      throw err;
    }

    imported += 1;
    console.log(`imported: ${name}`);
  }

  console.log(`Done — ${imported} cats imported.`);
}

const isCliEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntry) {
  refreshLocal().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
