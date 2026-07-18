// Runs before each test file's module graph is imported (vitest setupFiles),
// so env vars set here are visible to modules that read env at import time
// (src/db/connection.ts opens the DB at import; src/lib/auth.ts throws at
// import without HMAC_SECRET). Each test file gets its own temp dir, so
// module-level DB state never leaks across files or into the repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kot-test-'));

process.env.DATABASE_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
process.env.HMAC_SECRET = 'test-hmac-secret';
process.env.ALLOWED_ORIGIN = 'http://localhost:4321';
