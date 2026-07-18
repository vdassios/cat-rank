import { describe, expect, it } from 'vitest';
import { detectMime } from '../src/validation/mime';
import { JPEG_EXIF, JPEG_JFIF, PNG_SIG, RIFF_WAVE, WEBP_SIG } from './helpers';

describe('detectMime (CONTRACTS §5)', () => {
  it('detects JPEG from the SOI marker (JFIF and Exif flavors)', () => {
    expect(detectMime(JPEG_JFIF)).toBe('image/jpeg');
    expect(detectMime(JPEG_EXIF)).toBe('image/jpeg');
  });

  it('detects PNG from its signature', () => {
    expect(detectMime(PNG_SIG)).toBe('image/png');
  });

  it('detects WebP only when RIFF is followed by WEBP at bytes 8-11', () => {
    expect(detectMime(WEBP_SIG)).toBe('image/webp');
  });

  it('rejects a RIFF container that is not WebP', () => {
    expect(detectMime(RIFF_WAVE)).toBeNull();
  });

  it('rejects a RIFF prefix shorter than 12 bytes', () => {
    expect(detectMime(Buffer.from('RIFF'))).toBeNull();
    expect(detectMime(WEBP_SIG.subarray(0, 11))).toBeNull();
  });

  it('rejects buffers shorter than 4 bytes', () => {
    expect(detectMime(Buffer.alloc(0))).toBeNull();
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it('rejects random bytes', () => {
    expect(detectMime(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeNull();
  });

  it('never sniffs SVG as a raster type (XSS guard)', () => {
    expect(detectMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
});
