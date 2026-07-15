import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema';

const dbPath = process.env.DATABASE_PATH || './data/cats.db';

const dbDir = path.dirname(dbPath);
fs.mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(dbPath);

sqlite.pragma('journal_mode = WAL');
sqlite.pragma('wal_autocheckpoint = 0');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

export const rawDb = sqlite;
export const db = drizzle(rawDb, { schema });
