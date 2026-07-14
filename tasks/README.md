# Cat Ranking — Subtask Index

This directory splits `../CAT_RANKING_PLAN_V4.md` (the **master plan** — V4
supersedes V3; never transcribe artifacts from V3) into
isolated, self-contained subtasks. Each subtask is sized for an agent that
executes precise instructions well but should **not** be asked to resolve
ambiguity or make design decisions.

## Rules for every agent (read first)

1. **The master plan is context, not license.** Build exactly what your task
   file says. If your task and the plan disagree, the **task file wins** — stop
   and report the conflict; do not improvise.
2. **`CONTRACTS.md` is law.** All file paths, function signatures, type shapes,
   env var names, DB columns, and HTTP request/response shapes come from
   `CONTRACTS.md`. Never rename, re-shape, or "improve" anything defined there.
3. **Stay in your lane.** Create/modify **only** the files listed under
   "Files you create" in your task. Do not touch files owned by other tasks.
4. **Code against the contract, not the implementation.** If you need another
   module that another task owns (e.g. `src/lib/auth.ts`), import it using the
   exact signature in `CONTRACTS.md`. Assume it exists and behaves as specified.
   Do not implement it yourself.
5. **No new dependencies** beyond those in `CONTRACTS.md` → "Dependencies"
   without saying so explicitly in your final report.
6. **Finish with the acceptance check.** Each task ends with a verification
   command or checklist. Run/confirm it. Report pass/fail honestly.
7. **If something is missing or ambiguous, stop and report it.** Do not guess.

## Execution order & dependencies

Tasks marked **[parallel]** can run at the same time once their prerequisites
are met. The contract lets parallel tasks compile against each other's
interfaces before those are implemented.

```
00-scaffold ─┬─► 01-database ──────┐
             ├─► 02-auth-security  ├─► 05-api-routes ─► 11-tests
             ├─► 03-image-validation┤
             ├─► 04-image-processing┘
             ├─► 06-ui-components ──► 07-frontend-js
             ├─► 08-deploy-artifacts┐
             ├─► 09-cicd           ├─► 12-host-setup
             └─► 10-backup-scripts ┘
```

- **Must run first:** `00-scaffold` (creates the project, configs, and the
  directory skeleton every other task writes into).
- **After 00, fully parallel:** 01, 02, 03, 04, 06, 08, 09, 10.
- **05-api-routes** needs 01, 02, 03, 04 (it wires them together).
- **07-frontend-js** needs 06 (it attaches behavior to rendered markup).
- **11-tests** is written last; it exercises 01, 02, 03, 05.
- **12-host-setup** needs 08, 09, 10 (its provision script + first-deploy
  checklist reference their artifacts by name).

## Task list

| # | Task | Owns | Prereqs |
|---|---|---|---|
| 00 | [Project scaffold](./00-scaffold.md) | configs, dir skeleton, htmx, `.dockerignore` | — |
| 01 | [Database layer](./01-database.md) | `src/db/*`, migrations | 00 |
| 02 | [Auth & security](./02-auth-security.md) | `src/lib/{auth,csrf,semaphore,rateLimit}.ts`, `src/middleware.ts` | 00 |
| 03 | [Image validation](./03-image-validation.md) | `src/validation/*` | 00 |
| 04 | [Image processing](./04-image-processing.md) | `src/lib/images.ts` | 00 |
| 05 | [API routes](./05-api-routes.md) | `src/pages/api/*`, `src/pages/health.ts` | 00,01,02,03,04 |
| 06 | [UI components](./06-ui-components.md) | `src/components/*`, `src/pages/index.astro` | 00 |
| 07 | [Frontend JS](./07-frontend-js.md) | `src/scripts/ui.ts` | 06 |
| 08 | [Deploy artifacts](./08-deploy-artifacts.md) | `docker-compose.yml` (**repo root**), `deploy/{Dockerfile,nginx.conf,litestream.yml,entrypoint.sh}` | 00 |
| 09 | [CI/CD](./09-cicd.md) | `.github/workflows/deploy.yml`, `scripts/fetch-model.sh` | 00 |
| 10 | [Backup scripts](./10-backup-scripts.md) | `deploy/{backup-images,restore-images,verify-backup}.sh` | 00 |
| 11 | [Tests](./11-tests.md) | `tests/*` | 01,02,03,05 |
| 12 | [Host setup](./12-host-setup.md) | `deploy/provision.sh`, `deploy/FIRST_DEPLOY.md` | 08,09,10 |
| — | [Sample data (dev only)](./SEED.md) | `scripts/seed.ts` | 01 |

> `.env.example` and `.gitignore` already exist at the repo root — do not
> recreate them.
>
> **SEED** is an optional dev-only helper: after Task 01 it inserts 3 sample cats
> (with served placeholder images) so Tasks 05–07 can be exercised end-to-end
> without a real upload. It is not part of CI or the production image.
