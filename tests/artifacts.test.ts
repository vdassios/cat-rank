import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(p, 'utf-8');
const exists = (p: string) => fs.existsSync(p);
const lines = (p: string) => read(p).split('\n');
const indexOf = (p: string, needle: string) => lines(p).findIndex((l) => l.includes(needle));
const indexOfLine = (p: string, re: RegExp) => lines(p).findIndex((l) => re.test(l));

/** Recursively list every file under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Extract the block of a top-level compose service (e.g. `litestream:`) up to
 * the next top-level key. Compose indents services two spaces; service body is
 * four spaces. Returns the raw text of that service's block.
 */
function composeServiceBlock(_compose: string, name: string): string {
  const all = lines('docker-compose.yml');
  const start = all.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return '';
  const body: string[] = [];
  for (let i = start + 1; i < all.length; i += 1) {
    if (/^ {2}\S/.test(all[i])) break; // next top-level key (services:, volumes:, …)
    body.push(all[i]);
  }
  return body.join('\n');
}

/**
 * Parse an indentation-based YAML mapping into a nested object. Only handles
 * the shapes compose uses here (scalars, nested maps, and `- ` list items
 * which are skipped). Indentation is measured per line, so any base indent
 * works.
 */
function parseYamlMap(lines: string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; map: Record<string, unknown> }> = [
    { indent: -1, map: root },
  ];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('- ')) continue;
    const indent = raw.length - raw.trimStart().length;
    const key = trimmed.split(':')[0];
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    const rest = trimmed.slice(key.length + 1).trim();
    if (rest === '' || rest === '{}' || rest === '[]') {
      const child: Record<string, unknown> = {};
      parent.map[key] = child;
      stack.push({ indent, map: child });
    } else {
      parent.map[key] = rest;
    }
  }
  return root;
}

describe.skipIf(!exists('docker-compose.yml'))('docker-compose.yml (repo root)', () => {
  const compose = read('docker-compose.yml');

  it('is pinned to the repo root, not deploy/', () => {
    expect(exists('docker-compose.yml')).toBe(true);
    expect(exists('deploy/docker-compose.yml')).toBe(false);
  });

  it('litestream depends_on app with condition service_healthy', () => {
    const block = composeServiceBlock(compose, 'litestream');
    const parsed = parseYamlMap(block.split('\n')) as Record<string, unknown>;
    const deps = parsed.depends_on as Record<string, unknown> | undefined;
    expect(deps, 'litestream must have depends_on').toBeTruthy();
    const app = deps!.app as Record<string, unknown> | undefined;
    expect(app, 'depends_on must list app').toBeTruthy();
    expect(app!.condition, 'app must have condition: service_healthy').toBe('service_healthy');
  });

  it('app and litestream both mount ./data at /app/data', () => {
    for (const name of ['app', 'litestream']) {
      const block = composeServiceBlock(compose, name);
      expect(block, `${name} service should exist`).toBeTruthy();
      expect(block).toContain('./data:/app/data');
    }
  });

  it('app env maps LITESTREAM_ACCESS_KEY_ID from R2_ACCESS_KEY_ID', () => {
    const appBlock = composeServiceBlock(compose, 'app');
    expect(appBlock).toContain('LITESTREAM_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}');
    expect(appBlock).toContain('LITESTREAM_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}');
  });

  it('pins all sidecar images (no :latest sidecar)', () => {
    expect(compose).toContain('litestream/litestream:0.3.13');
    expect(compose).toContain('nginx:1.27-alpine');
    expect(compose).toContain('rclone/rclone:1.67');
    expect(compose).toContain('certbot/certbot:v2.11.0');
    // Sidecar services must not float on :latest.
    for (const line of lines('docker-compose.yml')) {
      if (/^ {4}image:/.test(line) && !line.startsWith('    image: ghcr.io')) {
        expect(line).not.toContain(':latest');
      }
    }
  });

  it('certbot renews with --webroot, never --standalone', () => {
    expect(compose).toContain('--webroot');
    expect(compose).not.toContain('--standalone');
  });
});

describe.skipIf(!exists('deploy/Dockerfile'))('deploy/Dockerfile', () => {
  const dockerfile = read('deploy/Dockerfile');

  it('uses node:22-bookworm-slim for both stages, never alpine', () => {
    expect((dockerfile.match(/FROM node:22-bookworm-slim/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(dockerfile).not.toContain('alpine');
  });

  it('copies the pinned litestream binary', () => {
    expect(dockerfile).toContain('COPY --from=litestream/litestream:0.3.13');
  });

  it('copies the model into dist/models/, never public/', () => {
    expect(dockerfile).toContain('COPY models/mobilenetv2-cat.onnx ./dist/models/');
    // Generic negative check: the model must never be staged under public/ by
    // ANY COPY/ADD instruction — Astro would serve it to the internet.
    expect(dockerfile).not.toContain('public/');
    for (const line of lines('deploy/Dockerfile')) {
      if (/^(COPY|ADD)\b/.test(line) && /mobilenetv2-cat\.onnx/.test(line)) {
        expect(line).toContain('dist/models');
      }
    }
  });

  it('ships the drizzle migrations into the image', () => {
    expect(dockerfile).toContain('COPY --from=builder /app/drizzle ./drizzle');
  });
});

describe.skipIf(!exists('deploy/litestream.yml'))('deploy/litestream.yml', () => {
  const litestream = read('deploy/litestream.yml');

  it('replicates /app/data/cats.db (matches the compose DATABASE_PATH)', () => {
    expect(litestream).toContain('path: /app/data/cats.db');
  });

  it('syncs every 1s with 168h retention', () => {
    expect(litestream).toContain('sync-interval: 1s');
    expect(litestream).toContain('retention: 168h');
  });
});

describe.skipIf(!exists('deploy/nginx.conf'))('deploy/nginx.conf', () => {
  const nginx = read('deploy/nginx.conf');

  it('includes mime.types', () => {
    expect(nginx).toContain('include /etc/nginx/mime.types;');
  });

  it('sends HSTS and enables http2 without the deprecated directive', () => {
    expect(nginx).toContain('Strict-Transport-Security');
    expect(nginx).toContain('http2 on;');
    expect(nginx).not.toContain('listen 443 ssl http2');
  });

  it('sets X-Real-IP from $remote_addr and ignores spoofable XFF/real-ip', () => {
    expect(nginx).toContain('proxy_set_header X-Real-IP $remote_addr');
    expect(nginx).not.toContain('X-Forwarded-For');
    expect(nginx).not.toContain('set_real_ip_from');
  });

  it('re-declares nosniff for /uploads/', () => {
    const uploadsBlock = nginx.slice(
      nginx.indexOf('location /uploads/'),
      nginx.indexOf('}', nginx.indexOf('location /uploads/')),
    );
    expect(uploadsBlock).toContain('X-Content-Type-Options nosniff');
  });

  it('rate-limits the health endpoint', () => {
    expect(nginx).toContain('location = /health');
    expect(nginx).toContain('limit_req zone=api');
  });
});

describe.skipIf(!exists('.github/workflows/deploy.yml'))('.github/workflows/deploy.yml', () => {
  it('runs migrations before bringing the stack up', () => {
    const migrate = indexOf('.github/workflows/deploy.yml', 'dist/scripts/migrate.mjs');
    // Match the actual `docker compose up -d` command, not the comment that
    // mentions `docker compose up -d app` in the rollback note.
    const up = indexOfLine('.github/workflows/deploy.yml', /^\s*docker compose up -d\s*$/);
    expect(migrate).toBeGreaterThan(-1);
    expect(up).toBeGreaterThan(-1);
    expect(migrate).toBeLessThan(up);
  });

  it('fetches the model before the docker build', () => {
    expect(indexOf('.github/workflows/deploy.yml', './scripts/fetch-model.sh')).toBeGreaterThan(-1);
    expect(indexOf('.github/workflows/deploy.yml', 'docker/build-push-action@v6')).toBeGreaterThan(
      -1,
    );
    expect(indexOf('.github/workflows/deploy.yml', './scripts/fetch-model.sh')).toBeLessThan(
      indexOf('.github/workflows/deploy.yml', 'docker/build-push-action@v6'),
    );
  });

  it('pins node to 22', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("node-version: '22'");
  });
});

describe.skipIf(!exists('scripts/fetch-model.sh'))('scripts/fetch-model.sh', () => {
  const script = read('scripts/fetch-model.sh');

  it('targets the non-public models/ directory', () => {
    expect(script).toContain('MODEL_DIR="models"');
    expect(script).toContain('MODEL_PATH="$MODEL_DIR/mobilenetv2-cat.onnx"');
    // The string `public/` must be absent entirely — the model is never staged
    // where Astro would publish it.
    expect(script).not.toContain('public/');
  });

  it('checksums the download with sha256sum --check', () => {
    expect(script).toContain('sha256sum --check');
  });
});

describe.skipIf(!exists('deploy/backup-images.sh'))('deploy/backup-images.sh', () => {
  const script = lines('deploy/backup-images.sh');
  const text = read('deploy/backup-images.sh');

  it('is POSIX sh with set -eu', () => {
    expect(script[0]).toBe('#!/bin/sh');
    expect(text).toContain('set -eu');
  });

  it('uses rclone copy with --backup-dir, never sync', () => {
    expect(text).toContain('rclone copy');
    expect(text).toContain('--backup-dir');
    expect(text).not.toContain('rclone sync');
  });

  it('contains no rclone sync anywhere under deploy/', () => {
    // The single most important backup rule: `rclone sync` would propagate a
    // local wipe to the remote backup and destroy it. Scan every file under
    // deploy/ recursively, not just backup-images.sh.
    const offenders = walk('deploy').filter((p) => read(p).includes('rclone sync'));
    expect(offenders).toEqual([]);
  });

  it('pings via busybox wget (the rclone image has no curl)', () => {
    expect(text).toContain('wget');
    expect(text).not.toContain('curl');
  });
});

describe.skipIf(!exists('deploy/verify-backup.sh'))('deploy/verify-backup.sh', () => {
  const text = read('deploy/verify-backup.sh');

  it('restores via --no-deps and runs PRAGMA integrity_check', () => {
    expect(text).toContain('--no-deps');
    expect(text).toContain('PRAGMA integrity_check');
  });

  it('restores from /app/data/cats.db', () => {
    expect(text).toContain('/app/data/cats.db');
  });
});
