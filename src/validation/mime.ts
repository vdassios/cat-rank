/**
 * Detects the image format by sniffing the file's magic bytes, rather than
 * trusting a user-supplied filename or Content-Type header.
 *
 * Signatures checked (big-endian reads):
 *   JPEG: `FF D8 FF` — Start-of-Image marker. Only 3 bytes are matched
 *         (`head >>> 8`) because the 4th varies by flavor (E0 JFIF, E1 Exif, …).
 *   PNG:  `89 50 4E 47` (`\x89PNG`) — first half of the 8-byte PNG signature.
 *   WebP: `52 49 46 46` (`RIFF`) at offset 0, then `57 45 42 50` (`WEBP`) at
 *         offset 8. Both are required: RIFF alone is a generic container also
 *         used by WAV/AVI; bytes 4–7 are the RIFF chunk size and are skipped.
 *
 * Returns the MIME type, or null if the buffer matches no supported format.
 */
export function detectMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const head = buf.readUInt32BE(0);

  if (head >>> 8 === 0xffd8ff) return 'image/jpeg';
  if (head === 0x89504e47) return 'image/png';
  if (head === 0x52494646) {
    if (buf.length < 12) return null;
    const webp = buf.readUInt32BE(8);
    if (webp === 0x57454250) return 'image/webp';
    return null;
  }
  return null;
}
