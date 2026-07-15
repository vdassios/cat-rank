# Learning Resources

This file collects resources and short explanations for learning the technologies and concepts used in KOT.

## Database Layer

1. [SQLite documentation](https://sqlite.org/docs.html)
   - Start here for an overview of SQLite, an embedded relational database stored in a local file. This provides the foundation for understanding the project's persistence layer.

2. [SQLite `CREATE TABLE`](https://sqlite.org/lang_createtable.html)
   - Learn how tables define columns, primary keys, `NOT NULL` fields, default values, unique constraints, and other data-integrity rules.

3. [SQLite foreign keys](https://sqlite.org/foreignkeys.html)
   - Explains relationships between tables, how SQLite protects referenced records, and why the project enables `foreign_keys` explicitly.

4. [SQLite query planner](https://sqlite.org/queryplanner.html) and [`CREATE INDEX`](https://sqlite.org/lang_createindex.html)
   - Learn how SQLite chooses ways to execute queries and how indexes improve filtering and sorting at the cost of disk space and additional work during writes.

5. [SQLite write-ahead logging](https://sqlite.org/wal.html)
   - Describes WAL mode, reader/writer concurrency, checkpoints, and the behavior behind the project's SQLite and Litestream configuration.

6. [Drizzle ORM: SQLite getting started](https://orm.drizzle.team/docs/get-started/sqlite-new)
   - Introduces connecting Drizzle to SQLite and defining a type-safe database schema in TypeScript.

7. [Drizzle ORM: SQLite indexes and constraints](https://orm.drizzle.team/docs/indexes-constraints)
   - Covers the schema APIs used to define indexes, uniqueness rules, primary keys, and foreign-key relationships.

8. [Drizzle Kit: `generate`](https://orm.drizzle.team/docs/drizzle-kit-generate) and [`migrate`](https://orm.drizzle.team/docs/drizzle-kit-migrate)
   - Explains how schema changes become versioned SQL migration files and how those migrations are applied to a database.

9. [Litestream: how it works](https://litestream.io/how-it-works/) and [tips and caveats](https://litestream.io/tips/)
   - Explains continuous SQLite replication, WAL processing, recovery considerations, and why checkpoint configuration matters.

10. [`better-sqlite3` API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
    - Reference for the synchronous Node.js SQLite driver used beneath Drizzle, including connections, prepared statements, transactions, and pragmas.

> Note: Current Drizzle documentation may use syntax newer than the versions pinned by this repository. Use it to learn the concepts, while treating the repository's contracts and installed package versions as authoritative.
