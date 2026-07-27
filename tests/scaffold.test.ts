import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// Whole-line matching: `data` must not accidentally match `database/` etc.
function lines(file: string): string[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim());
}

describe('scaffold invariants (Task 00)', () => {
  it('ships a non-empty self-hosted htmx bundle', () => {
    expect(fs.statSync('public/htmx.min.js').size).toBeGreaterThan(0);
  });

  it('.dockerignore excludes secrets/runtime but keeps models/ and drizzle/ in the build context', () => {
    const ignore = lines('.dockerignore');
    for (const required of ['node_modules', '.env', 'data', '.git']) {
      expect(ignore).toContain(required);
    }
    // The image COPYs both — ignoring them would break the build (V4 fix #6).
    for (const forbidden of ['models', 'models/', 'drizzle', 'drizzle/']) {
      expect(ignore).not.toContain(forbidden);
    }
  });

  it('.gitignore keeps the ONNX model out of git', () => {
    expect(lines('.gitignore')).toContain('models/');
  });
});
