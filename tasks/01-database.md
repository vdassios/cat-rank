# Task 01 — Database layer

**Goal:** SQLite connection (correct pragmas), drizzle schema, types, migrations,
and a migration runner script.

**Prereqs:** 00. **Read first:** `CONTRACTS.md` §2, §4, §5 (connection/schema), §6.

## Files you create

- `src/db/connection.ts`
- `src/db/schema.ts`
- `scripts/migrate.ts`
- `drizzle/migrations/` (generated SQL, via `npm run db:generate`)

## `src/db/connection.ts`

- Open `better-sqlite3` at `process.env.DATABASE_PATH` (default `./data/cats.db`),
  creating the parent dir if missing.
- Apply pragmas **in this order**: `journal_mode = WAL`,
  `wal_autocheckpoint = 0`, `busy_timeout = 5000`, `foreign_keys = ON`.
- Export `rawDb` (the better-sqlite3 instance) and `db` (drizzle instance bound
  to the schema). Signatures per CONTRACTS §5.

> `wal_autocheckpoint = 0` is mandatory — Litestream owns checkpointing. Do not
> change it.

## `src/db/schema.ts`

- Define drizzle tables `cats`, `votes`, `comments` matching the DDL in
  CONTRACTS §6 **exactly** (column names, defaults, NOT NULL, the two UNIQUE
  constraints on votes, the one on comments, and all indexes).
- Export the `Cat`, `Vote`, `Comment` types from CONTRACTS §4 (use drizzle's
  `$inferSelect`). Column names are snake_case in SQL, camelCase in TS (drizzle
  mapping) — match the type field names in §4.

## `scripts/migrate.ts`

- Apply pending migrations using drizzle's better-sqlite3 migrator
  (`drizzle-orm/better-sqlite3/migrator`), reading from
  **`./drizzle/migrations`** (relative to cwd) against the DB at
  `process.env.DATABASE_PATH`.
- It is bundled to `dist/scripts/migrate.mjs` by `npm run build:scripts`
  (esbuild — see CONTRACTS §12); you do **not** add a separate build step. Just
  write the `.ts`; `npm run build` produces the `.mjs`.
- Must exit non-zero on failure. Keep it dependency-free beyond drizzle +
  better-sqlite3 (reuse `src/db/connection.ts` if convenient).

## Generate migrations

After writing the schema:
```
npm run db:generate   # drizzle-kit generate → drizzle/migrations/*.sql
```
Commit the generated SQL.

## Constraints

- Touch only the four paths above. Do not write app routes or seed data.
- No schema deviations from CONTRACTS §6 — not even "harmless" extra columns.

## Acceptance check

```
npm run db:generate            # produces migration SQL
npm run build
DATABASE_PATH=./data/test.db node dist/scripts/migrate.mjs   # creates tables, exits 0
sqlite3 ./data/test.db ".tables"      # cats, comments, votes
sqlite3 ./data/test.db "PRAGMA wal_autocheckpoint;"   # 0
rm ./data/test.db*
```
Report: tables created, `wal_autocheckpoint` is 0, migrate exits 0.
