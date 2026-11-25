# Package structure

Status: plan, updated 25 Nov 2026 (first written 15 Nov). shammai wants the split so each feature
can be tested on its own and stays separate from the others. Nothing has moved yet. Each step in
"How we get there" is its own PR and changes no behaviour.

## The idea

sky-brain stays one repo, one Vercel deploy and one Postgres database. Inside the repo, the server
code is split into workspace packages with clear borders and a one-way dependency order. A package
can be type-checked and tested alone (`pnpm --filter @sky-brain/memory test`), and a lint rule
refuses imports that break the order.

Separate repos or services stay out: every part shares one database, one trust rule and one
permission model, and one person runs it.

## Where the code is today (25 Nov)

Everything lives in folders under `apps/server/src`. Lines of code, without tests:

| Folder | Lines | What it is |
| --- | --- | --- |
| `tasks` | 2,050 | goals, the task DAG, claim and lease, reports, goal documents |
| `auth` | 1,960 | Perminister sign-in, Better Auth, OAuth for MCP clients |
| `db` | 1,360 | the one Drizzle schema, client, audit log, migrations |
| `memory` | 1,270 | entries, versions, comments, the context packet |
| `mcp` | 1,130 | the MCP server and every tool |
| `testing` | 990 | the app test harness (fake Perminister, seeds) |
| `run-tokens`, `devices` | 1,100 | devices that pull approved tasks (D20) and their run tokens |
| `approvals`, `push` | 720 | approval requests (D32) and web push alerts (D36) |
| `agents`, `projects`, `actor`, `guards`, `scope`, `http` | 1,080 | small shared pieces |

Folders already give each feature a place, but nothing stops one from reaching into another, and
some already do:

- **memory and tasks import each other.** Tasks use memory (goal documents, reports, the packet
  at claim). Memory imports `tasks/write-guards.ts` (secret scan, quarantine) and a helper from
  `tasks/goals-router.ts`. Those helpers are not about tasks; they are in the wrong folder.
- **`tasks/goals-router.ts` is a shared toolbox.** `projects`, `push` and `approvals` import its
  `boardWriteLimit`, `parseRequest`, `pathId` and `assertWriter`.
- **`db` tests import `tasks`** (`taskTextHash`).
- **Most tests boot the whole app** through `testing/harness.ts`, with sign-in. That is why a
  memory change today runs against auth, MCP and the board.

## The packages

```
packages/shared      types and zod schemas (exists)
      ▲
packages/db          schema, client, migrations, audit, a PGlite test db
      ▲
packages/kernel      actor, guards (incl. secret scan), scope, http helpers, run tokens
      ▲
packages/memory      entries, versions, comments, packet
      ▲
packages/board       goals, tasks, projects, goal documents, devices
      ▲
packages/approvals   approval requests and web push
      ▲
apps/server          auth, agents, MCP, config, app wiring, Vercel entry, migrate CLI
apps/web             React app; talks to the server over HTTP only
```

Each arrow means "may import". Nothing imports upward.

- **`packages/db`.** One schema and one migration history, as today, so there is never a second
  migration stream for the shared database. It also exports `createTestDb()` (PGlite, migrated)
  so every package can test against a real database without the app.
- **`packages/kernel`.** The pieces every feature needs: the actor (who is calling), guards
  (identity, membership, the secret scan and quarantine in `guards/write-guards.ts`), scope,
  the Express request checks in `http/request-checks.ts`, and run tokens, because a run token
  caps the caller's role and memory checks it too.
- **`packages/memory`, `packages/board`, `packages/approvals`.** Each holds its service code and
  its Express router. They receive a db handle and an actor; they never read environment
  variables or open a connection. Auth, MCP and sign-in stay out of them.
- **`apps/server`.** Reads the environment, opens the database, signs people in, registers MCP
  tools (and later the book's `defineTool` registry) and mounts the routers. Agents stay here
  because they are about who is connected, which is auth's job.

## Tests

- **Package tests** call the service directly with `createTestDb()` and a made-up actor. Each
  hard rule a package owns (membership filter, agents cannot approve, secret scan) keeps its
  allowed and refused test inside that package.
- **App tests** stay in `apps/server`: sign-in, OAuth, MCP over HTTP, and one end-to-end path per
  feature. They keep using `testing/harness.ts`.
- CI runs every package; locally `pnpm --filter <package> test` runs one.

## Border rules

1. `apps/web` talks to `apps/server` over HTTP only. It may import `packages/shared`.
2. Only `apps/server` opens a database connection or reads environment variables.
3. Packages never import from `apps/*`, and import each other only in the order above, through
   what a package exports in its `package.json`.
4. No import cycles. ESLint (`no-restricted-imports` per package) refuses a wrong import, and
   `pnpm health` runs it.
5. Every table is owned by one package; another package reads it only through the owner's
   exported functions.

## How we get there

Each step is one PR, keeps every test green and changes no behaviour.

0. **Untangle in place** (done, 25 Nov). The secret scan and quarantine helpers moved from
   `tasks/write-guards.ts` to `guards/`, the request checks from `tasks/goals-router.ts` to
   `http/request-checks.ts`, the tasks schema test from `db/` to `tasks/`, and the `/me` router
   from `projects/` to `agents/` (it uses MCP's `whoami`). ESLint now enforces the folder order
   on source files (`eslint.config.js`, `serverLayers`). Memory no longer imports tasks.
1. **`packages/db`** (done, 25 Nov). Schema, client, audit and the migrations
   (`packages/db/drizzle`) moved there, with `createTestDb()` in `@sky-brain/db/test-db`.
   `apps/server/src/db/` keeps only `migrate-cli.ts` (it reads the environment) and two schema
   tests that need the app's seeds. `testing/harness.ts` re-exports `createTestDb` for older tests
   and `bench/`.
2. **`packages/kernel`** (done, 25 Nov). `actor`, `guards`, `scope`, `http` and `run-tokens`
   moved to `packages/kernel/src/<folder>/`; the server imports `@sky-brain/kernel/<folder>/<file>`.
   Their tests that boot the app (`actor.test.ts`, `resolve-scope.test.ts`, the run-token route
   tests and their fixture) stay in `apps/server/src/<folder>/`. ESLint now also enforces the
   package order (`packageRules`).
3. **`packages/memory`** (done, 25 Nov). `comments`, `entries-service`, `memories`,
   `memory-router`, `packet` and `wire` moved to `packages/memory/src/`; the server imports
   `@sky-brain/memory/<file>`. `memories.test.ts` runs in the package against `createTestDb()`
   (membership filter, About me for the owner only). The older memory tests boot the app or use
   the run-token fixture, so they stay in `apps/server/src/memory/` for now.
4. **`packages/board`** (tasks, projects, goal documents, devices).
5. **`packages/approvals`** (approvals and push).

Vercel needs no change: esbuild already bundles workspace packages into the function, and
`migrate-cli.ts` stays in `apps/server`.

## Working alongside the book and the benchmark

The benchmark (`bench/`) runs outside the server, so the split does not touch it. The thin book
adds `defineTool` and tool descriptions in `apps/server/src/mcp`, which stays in the server. The
moves that could clash are memory's `packet.ts` (the book's `context` tool) and the MCP files
that import memory and tasks; do steps 3 and 4 when no book PR is open on those files.

## Later, if needed

- `packages/stewards` for Steward jobs (Curator, Consolidator, Archivist, Auditor) when build
  step 6 starts. They may simply live in `packages/board` and `packages/memory`.
- A package moves to its own repo only once it is stable and another app (for example Pathly)
  wants it.
