import sharp from 'sharp';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db/connection';
import { cats, votes } from '../src/db/schema';
import { eq, inArray } from 'drizzle-orm';

// Dev-only seed data. Fixed UUID storage keys make repeated runs deterministic
// (independent of the autoincrement DB id, mirroring the upload route).
const SAMPLES = [
  {
    name: 'Sample Cat 1',
    likes: 5,
    storageKey: '11111111-1111-4111-8111-111111111111',
    color: '#e74c3c',
  },
  {
    name: 'Sample Cat 2',
    likes: 8,
    storageKey: '22222222-2222-4222-8222-222222222222',
    color: '#2ecc71',
  },
  {
    name: 'Sample Cat 3',
    likes: 3,
    storageKey: '33333333-3333-4333-8333-333333333333',
    color: '#3498db',
  },
] as const;

const SAMPLE_NAMES = SAMPLES.map((s) => s.name);
// Dev images live under public/uploads so `astro dev` serves them at
// /uploads/x. (Prod serves /uploads from the real volume via nginx.)
const PUBLIC_UPLOADS = path.join(process.cwd(), 'public', 'uploads');

function removeFileIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
}

async function generatePlaceholder(name: string, storageKey: string, color: string): Promise<void> {
  fs.mkdirSync(PUBLIC_UPLOADS, { recursive: true });

  const makeSvg = (size: number) =>
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${size}" height="${size}" fill="${color}"/>` +
    `<text x="50%" y="50%" font-size="${size / 12}" fill="#ffffff" text-anchor="middle" ` +
    `dominant-baseline="middle" font-family="sans-serif">${name}</text>` +
    `</svg>`;

  await sharp(Buffer.from(makeSvg(300)))
    .webp({ quality: 80 })
    .toFile(path.join(PUBLIC_UPLOADS, `${storageKey}_thumb.webp`));
  await sharp(Buffer.from(makeSvg(1200)))
    .webp({ quality: 85 })
    .toFile(path.join(PUBLIC_UPLOADS, `${storageKey}_full.webp`));
}

async function seed(): Promise<void> {
  // Idempotency: clear the three sample rows (and their votes) by name, then
  // delete their deterministic files, then re-insert fresh. Re-running leaves
  // exactly 3 sample cats and no orphans.
  const existing = db.select().from(cats).where(inArray(cats.name, SAMPLE_NAMES)).all();
  for (const row of existing) {
    db.delete(votes).where(eq(votes.catId, row.id)).run();
  }
  db.delete(cats).where(inArray(cats.name, SAMPLE_NAMES)).run();

  for (const { storageKey } of SAMPLES) {
    removeFileIfExists(path.join(PUBLIC_UPLOADS, `${storageKey}_thumb.webp`));
    removeFileIfExists(path.join(PUBLIC_UPLOADS, `${storageKey}_full.webp`));
  }

  for (const { name, likes, storageKey, color } of SAMPLES) {
    await generatePlaceholder(name, storageKey, color);

    const cat = db
      .insert(cats)
      .values({
        name,
        thumbnailPath: `/uploads/${storageKey}_thumb.webp`,
        imagePath: `/uploads/${storageKey}_full.webp`,
        likesCount: likes,
      })
      .returning({ id: cats.id })
      .get();

    for (let i = 0; i < likes; i++) {
      const userToken = `seed-${storageKey}-user-${i}`;
      const ipUaHash = createHash('sha256')
        .update(`seed|${storageKey}|${i}`)
        .digest('hex')
        .slice(0, 32);
      db.insert(votes).values({ catId: cat.id, userToken, ipUaHash }).run();
    }
  }

  const totalLikes = SAMPLES.reduce((sum, s) => sum + s.likes, 0);
  console.log(`Seeded ${SAMPLES.length} cats with ${totalLikes} total likes`);
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
