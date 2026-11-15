# Package structure

Status: agreed direction (15 Nov 2026), not built yet. Nothing has moved. This page says where
code goes as sky-brain grows, so each concern gets its own package as it is built.

## The idea

sky-brain stays one repo, one deploy and one Postgres database. Inside the repo, the code is split
into packages with clear borders. That gives each concern its own place, the way Zakai's projects
are each focused on one job, without separate repos or services. Those cost a lot for a one-person
project whose parts all share one database, one trust rule (D22) and one permission model.

```
apps/web  ──HTTP──▶  apps/server  ──▶  packages/memory ─┐
(frontend)           (backend)    ──▶  packages/board  ─┼──▶ db handle from the server ──▶ Postgres
                                  ──▶  packages/shared ◀┘
```

## The pieces

### `apps/server`: the backend

- Express on Vercel: REST (`/api/v1`), MCP (`/mcp`) and auth (`/api/auth`, Perminister and
  Better Auth). It also serves the web build.
- **The only piece that connects to Postgres.** It reads `DATABASE_URL`, opens the connection and
  passes a db handle to the feature packages.
- Owns everything that is about the outside world: routes, MCP tool registration, sign-in,
  tokens, devices, the actor (who is calling), rate limits and config.
- Owns the one Drizzle schema and the one migration history (`apps/server/src/db`), so there is
  never more than one migration stream for the shared database.
- Enforces the hard rules in `CLAUDE.md` at the edge (identity from the token only, membership
  filter, secret scan). Feature packages enforce them again on their own writes.

### `apps/web`: the frontend

- The React app (Vite).
- Talks to the backend over HTTP only. It never imports a feature package and never touches the
  database.
- May import types and zod schemas from `packages/shared`.

### `packages/shared`: shared types (exists today)

- Types and zod schemas used by the server, the web app and Pathly.
- No logic that reads or writes data, no database, no Node-only code (the web app imports it).

### `packages/memory`: the brain's memory (planned, build plan step 1)

- Entries with `kind` and trust level (D22), the append-only `entry_versions` table, links and
  `supersedes`, as-of queries.
- Later: hybrid search (step 4), the context packet and cognitive signals (step 5), and the logic
  the Consolidator uses (step 6).
- Gets a db handle and an actor from the server. It knows nothing about HTTP, MCP or sign-in.
- Owns the trust rule: agents write at `proposed` (external text at `quarantined`), and only a
  person raises trust or changes a kind.

### `packages/board`: the task board (planned)

- Projects, goals, the task DAG, claim and lease, reports, and question items that wake a role.
- Today this code lives in `apps/server/src/tasks` (and the board part of `apps/server/src/mcp`).
  It moves into the package the next time it needs real work, not as a separate rewrite.
- Gets a db handle and an actor from the server. It knows nothing about HTTP, MCP or sign-in.
- May call `packages/memory` through its exported functions (for example, to link a finished
  goal to the memory it produced).

### Later, if needed

- `packages/stewards`: Steward jobs (Curator, Consolidator, Archivist, Auditor) once step 6
  starts. They run as board jobs, so this may simply stay inside `packages/board` and
  `packages/memory`. Decide then.
- A piece moves into its **own repo** only once it is stable and another app wants it. Two likely
  candidates: the benchmark harness (step 0), and a bridge that lets Perminister sign people in
  to MCP clients.

## Border rules

1. `apps/web` talks to `apps/server` over HTTP only.
2. Only `apps/server` opens a database connection or reads environment variables. Feature
   packages receive a db handle and an actor as arguments.
3. Feature packages never import from `apps/*`.
4. Packages import each other only through what a package exports in its `package.json`
   (`@sky-brain/memory`, `@sky-brain/board`, `@sky-brain/shared`), never through a path into
   another package's `src`.
5. No import cycles: `board` may use `memory`; `memory` does not use `board`. Both may use
   `shared`.
6. Tables live in the one server schema. Each table has one owning package that writes it; other
   packages read it through that package's functions, not with their own queries.
7. Each package has its own tests (Vitest with PGlite), including the workspace-isolation test
   that `CLAUDE.md` asks for on every new query.
