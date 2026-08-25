import { rawDb } from '../db/connection';
import fs from 'node:fs';

export async function GET() {
  try {
    rawDb.exec('CREATE TEMP TABLE IF NOT EXISTS _health (tick INTEGER)');
    rawDb.exec('INSERT INTO _health (tick) VALUES (1)');
    rawDb.exec('DELETE FROM _health');

    const uploadDir = process.env.UPLOAD_DIR || './data/uploads';
    fs.accessSync(uploadDir, fs.constants.W_OK);

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response('unhealthy', { status: 503 });
  }
}
