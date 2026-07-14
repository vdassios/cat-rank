# AGENTS.md — KOT (Cat Ranking)

This repo holds the design and task breakdown for a self-hosted cat-ranking
website (Astro SSR + HTMX + SQLite, Dockerized). Implementation is split into
isolated subtasks so multiple agents can work independently.

## Start here

1. **`tasks/README.md`** — the subtask index, global rules, and the dependency
   graph (what runs first, what runs in parallel). **Read this before anything.**
2. **`tasks/CONTRACTS.md`** — authoritative shared interfaces: file paths,
   function signatures, types, env vars, DB schema, component props, and the
   HTTP route/response contract. This is law; never rename or re-shape anything
   defined here.
3. **`tasks/NN-*.md`** — your specific subtask. Build exactly what it says.
4. **`CAT_RANKING_PLAN_V4.md`** — the master plan. Broader context only; it does
   **not** override a task file or `CONTRACTS.md`.

## Working rules

- **Do exactly one task** unless told otherwise. Create/modify only the files
  listed under "Files you create" in your task — stay out of other tasks' files.
- **Precedence:** task file > `CONTRACTS.md` > master plan. If they conflict, or
  anything is ambiguous or missing, **stop and report** — do not guess or
  improvise.
- **Code against the contract, not the implementation.** Import other modules
  using the exact signatures in `CONTRACTS.md` and assume they behave as
  specified, even if not yet written.
- **No new dependencies** beyond `CONTRACTS.md` §11 without flagging it in your
  report.
- **Finish with the acceptance check** at the bottom of your task file. Run it
  and report pass/fail honestly.

## Order of execution

`tasks/00-scaffold.md` must run first (it creates the project, configs, and the
directory skeleton everything else writes into). After that, Tasks 01, 02, 03,
04, 06, 08, 09, 10 can run in parallel; 05 integrates 01–04; 07 follows 06; 11
(tests) is last. `tasks/SEED.md` is an optional dev-only helper after Task 01.

## Project facts

- Stack: Astro (SSR, `@astrojs/node` standalone) + Preact islands + HTMX
  (self-hosted) + SQLite (`better-sqlite3` + `drizzle-orm`) + Sharp + ONNX.
- Runtime: Docker Compose; deploy via GitHub Actions → GHCR → ssh pull.
- Node is pinned to `22`. Package manager is `npm` (`npm ci`).
- `.env.example` and `.gitignore` already exist at the repo root — do not
  recreate them.
