import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CatsIndex from '../src/pages/api/cats/index.astro';
import { rawDb } from '../src/db/connection';
import { applyMigrations, makeImage, renderPartialRoute, resetDb } from './helpers';

// The upload route imports these task boundaries; mock both so we test *our*
// guards and flow, not the ONNX model or Sharp pipeline.
const h = vi.hoisted(() => ({
  validateCat: vi.fn(),
  processImage: vi.fn(),
  deleteProcessedImages: vi.fn(),
}));

vi.mock('../src/validation/isCat', () => ({
  validateCat: (...args: unknown[]) => h.validateCat(...args),
}));

vi.mock('../src/lib/images', () => ({
  processImage: (...args: unknown[]) => h.processImage(...args),
  deleteProcessedImages: (...args: unknown[]) => h.deleteProcessedImages(...args),
}));

const ORIGIN = process.env.ALLOWED_ORIGIN!;

function uploadRequest(image: File | null, name: string, opts: { origin?: string | null } = {}) {
  const form = new FormData();
  if (image) form.set('image', image);
  form.set('name', name);
  const headers: Record<string, string> = {};
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.Origin = origin;
  return new Request('http://localhost:4321/api/cats', {
    method: 'POST',
    body: form,
    headers,
  });
}

beforeAll(() => {
  applyMigrations();
});

beforeEach(() => {
  resetDb();
  h.validateCat.mockReset();
  h.processImage.mockReset();
  h.deleteProcessedImages.mockReset();
  h.processImage.mockResolvedValue({
    thumbnailPath: '/uploads/fake_thumb.webp',
    imagePath: '/uploads/fake_full.webp',
  });
  h.deleteProcessedImages.mockResolvedValue(undefined);
});

describe('POST /api/cats upload guards (CONTRACTS §9, order-sensitive)', () => {
  it('rejects files over 10 MB', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.jpg', {
      type: 'image/jpeg',
    });
    const res = await renderPartialRoute(CatsIndex, { request: uploadRequest(big, 'x') });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('File too large (max 10MB)');
    expect(h.validateCat).not.toHaveBeenCalled();
  });

  it('rejects files with bad magic bytes', async () => {
    const junk = new File([Buffer.from('not-an-image-at-all')], 'x.jpg', {
      type: 'image/jpeg',
    });
    const res = await renderPartialRoute(CatsIndex, { request: uploadRequest(junk, 'x') });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Unsupported format');
    expect(h.validateCat).not.toHaveBeenCalled();
  });

  it('rejects valid magic bytes with a wrong extension', async () => {
    const valid = new File([new Uint8Array(await makeImage(100, 100, 'jpeg'))], 'x.gif', {
      type: 'image/jpeg',
    });
    const res = await renderPartialRoute(CatsIndex, { request: uploadRequest(valid, 'x') });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Unsupported file type');
    expect(h.validateCat).not.toHaveBeenCalled();
  });

  it('rejects SVG files as Unsupported format before cat validation', async () => {
    // An SVG payload has no raster magic bytes, so the MIME guard rejects it
    // (CONTRACTS §9 has no dedicated SVG guard/message). validateCat never runs.
    const svg = new File([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')], 'x.svg', {
      type: 'image/svg+xml',
    });
    const res = await renderPartialRoute(CatsIndex, { request: uploadRequest(svg, 'x') });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Unsupported format');
    expect(h.validateCat).not.toHaveBeenCalled();
  });

  it('rejects a valid image that fails cat validation', async () => {
    h.validateCat.mockResolvedValue(false);
    const valid = new File([new Uint8Array(await makeImage(100, 100, 'jpeg'))], 'x.jpg', {
      type: 'image/jpeg',
    });
    const res = await renderPartialRoute(CatsIndex, { request: uploadRequest(valid, 'x') });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("We couldn't verify this is a cat");
    expect(h.validateCat).toHaveBeenCalledTimes(1);
    expect(h.processImage).not.toHaveBeenCalled();
  });

  it('short-circuits: an unsupported format never reaches cat validation', async () => {
    const junk = new File([Buffer.from('garbage bytes')], 'x.jpg', { type: 'image/jpeg' });
    await renderPartialRoute(CatsIndex, { request: uploadRequest(junk, 'x') });
    expect(h.validateCat).not.toHaveBeenCalled();
  });

  it('returns 403 when the Origin header is missing', async () => {
    const valid = new File([new Uint8Array(await makeImage(100, 100, 'jpeg'))], 'x.jpg', {
      type: 'image/jpeg',
    });
    const res = await renderPartialRoute(CatsIndex, {
      request: uploadRequest(valid, 'x', { origin: null }),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden');
    expect(h.validateCat).not.toHaveBeenCalled();
  });
});

describe('POST /api/cats success and failure paths', () => {
  it('on success inserts a sanitized row and returns HX-Redirect', async () => {
    h.validateCat.mockResolvedValue(true);

    // Capture the DB state at the moment processImage runs. The upload flow
    // must process the image BEFORE inserting the row, so no cat row may exist
    // while processing is in flight (TESTING.md T05 sequencing contract).
    let rowsSeenDuringProcessing = -1;
    h.processImage.mockImplementation(async () => {
      const row = rawDb.prepare('SELECT count(*) AS n FROM cats').get() as { n: number };
      rowsSeenDuringProcessing = row.n;
      return { thumbnailPath: '/uploads/fake_thumb.webp', imagePath: '/uploads/fake_full.webp' };
    });

    const valid = new File([new Uint8Array(await makeImage(100, 100, 'jpeg'))], 'mycat.jpg', {
      type: 'image/jpeg',
    });
    const res = await renderPartialRoute(CatsIndex, {
      request: uploadRequest(valid, '<b>Garfield</b>   '),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('HX-Redirect')).toBe('/');
    expect(rowsSeenDuringProcessing).toBe(0);

    const rows = rawDb.prepare('SELECT name, thumbnail_path, image_path FROM cats').all() as Array<{
      name: string;
      thumbnail_path: string;
      image_path: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Garfield');
    expect(rows[0].thumbnail_path).toBe('/uploads/fake_thumb.webp');
    expect(rows[0].image_path).toBe('/uploads/fake_full.webp');

    // processImage received a UUID storage key, not user input.
    const keyArg = h.processImage.mock.calls[0][1] as string;
    expect(keyArg).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('leaves the cats table empty when processing fails', async () => {
    h.validateCat.mockResolvedValue(true);
    h.processImage.mockRejectedValue(new Error('sharp failed'));
    const valid = new File([new Uint8Array(await makeImage(100, 100, 'jpeg'))], 'x.jpg', {
      type: 'image/jpeg',
    });
    const res = await renderPartialRoute(CatsIndex, { request: uploadRequest(valid, 'x') });
    expect(res.status).toBe(500);
    const count = rawDb.prepare('SELECT count(*) AS n FROM cats').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('cleans up processed files when the DB insert fails', async () => {
    h.validateCat.mockResolvedValue(true);
    const valid = new File([new Uint8Array(await makeImage(100, 100, 'jpeg'))], 'x.jpg', {
      type: 'image/jpeg',
    });
    rawDb.exec(`CREATE TRIGGER block_cats BEFORE INSERT ON cats
      BEGIN SELECT RAISE(FAIL, 'forced'); END;`);
    try {
      const res = await renderPartialRoute(CatsIndex, { request: uploadRequest(valid, 'x') });
      expect(res.status).toBe(500);
      expect(h.deleteProcessedImages).toHaveBeenCalledTimes(1);
      const count = rawDb.prepare('SELECT count(*) AS n FROM cats').get() as { n: number };
      expect(count.n).toBe(0);
    } finally {
      rawDb.exec('DROP TRIGGER block_cats');
    }
  });
});
