import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import fs from 'node:fs';

try {
  const dbPath = process.env.DATABASE_PATH || './data/cats.db';
  const dbDir = path.dirname(dbPath);
  fs.mkdirSync(dbDir, { recursive: true });

  const sqlite = new Database(dbPath);
  // Litestream owns checkpointing (see litestream.yml). The deploy flow runs
  // migrations while the old container serves and litestream replicates — a
  // default autocheckpoint connection could truncate WAL frames mid-ship.
  sqlite.pragma('wal_autocheckpoint = 0');
  const db = drizzle(sqlite);

  migrate(db, { migrationsFolder: './drizzle/migrations' });

  console.log('Migrations complete');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
}