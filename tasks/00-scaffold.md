# Task 00 — Project scaffold

**Goal:** create the Astro project, all config files, the empty directory
skeleton, and the self-hosted HTMX file. After this task the repo builds (with
empty pages) and every other task has a place to write its files.

**Prereqs:** none. **Read first:** `CONTRACTS.md` §1, §2, §11.

## Files you create

- `package.json` — scripts + the exact dependency set from CONTRACTS §11.
- `tsconfig.json` — extends `astro/tsconfigs/strict`, ESM, `"types": ["astro/client"]`.
- `astro.config.mjs` — SSR config (below).
- `drizzle.config.ts` — points at `src/db/schema.ts`, out `drizzle/migrations`, dialect `sqlite`.
- `public/htmx.min.js` — HTMX **v2.0.4** downloaded (see below).
- `.dockerignore` — exact contents below. Without it, the Dockerfile's
  `COPY . .` drags host `node_modules/` (macOS-native binaries — overwriting
  the container's `npm ci` output), `.env`, `data/`, and `.git` into the image.
- Empty placeholder dirs (use `.gitkeep`): `src/db/`, `src/lib/`, `src/validation/`,
  `src/components/`, `src/pages/api/cats/[id]/`, `src/scripts/`, `scripts/`,
  `models/`, `deploy/`, `tests/`, `data/`.
- `src/pages/index.astro` — minimal valid placeholder (`<h1>Cat Ranking</h1>`),
  task 06 replaces it.

## `.dockerignore` (exact contents)

`models/` and `drizzle/` must **stay in** the build context (the image copies
both) — do not add them here.

```
.git
.github
.astro
node_modules
dist
data
certbot
public/uploads
.env
.env.*
tasks
*.md
.DS_Store
```

## Exact configs

`package.json` scripts:
```json
{
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build && npm run build:scripts",
    "build:scripts": "if ls scripts/*.ts >/dev/null 2>&1; then esbuild scripts/*.ts --bundle --platform=node --format=esm --packages=external --outdir=dist/scripts --out-extension:.js=.mjs; else echo 'no scripts/*.ts yet'; fi",
    "preview": "astro preview",
    "typecheck": "astro check",
    "test": "vitest run --passWithNoTests",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node dist/scripts/migrate.mjs"
  }
}
```
Dependencies/devDependencies: exactly the lists in CONTRACTS §11. Use current
stable versions matching the majors there (Astro `^5`, etc.).

`astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import preact from '@astrojs/preact';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()],
  server: { host: true, port: 4321 },
});
```

## HTMX download

Fetch HTMX 2.0.4 and save to `public/htmx.min.js`:
```
curl -fSL https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js -o public/htmx.min.js
```
Then compute its SRI hash and record it in a comment at the top of
`src/pages/index.astro` for task 06 to use:
```
openssl dgst -sha384 -binary public/htmx.min.js | openssl base64 -A
```

## Constraints

- Do NOT implement DB, auth, routes, or components — only scaffolding.
- Do NOT add packages outside CONTRACTS §11.
- `.gitignore` and `.env.example` already exist at repo root — leave their
  content alone, with ONE exception: in `.gitignore`, replace the stale
  `public/models/` line with `models/` (the ONNX model moved out of `public/`
  — CONTRACTS §1; the existing `*.onnx` rule stays as belt-and-braces).
- Do NOT create `docker-compose.yml` — Task 08 owns it (at the repo root).

## Acceptance check

```
npm install
npm run build      # builds with the placeholder index page, no errors
test -f public/htmx.min.js
test -f .dockerignore && ! grep -qx 'models' .dockerignore
grep -qx 'models/' .gitignore
```
Report: build succeeds, htmx file present, SRI hash recorded, `.dockerignore`
created, `.gitignore` model path updated.
