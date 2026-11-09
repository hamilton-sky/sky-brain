# sky-brain: notes for agents working in this repo

## What this repo is

sky-brain is a shared, typed knowledge store for people and AI agents, hosted on Vercel (docs/DECISIONS.md D16).
People sign in with Google. Agents connect over MCP or REST. Read [docs/PLAN.md](docs/PLAN.md)
before you change anything; it is the contract for the current design.

## Hard rules

These come from the security review behind the plan. Do not weaken them.

1. **Context, not execution.** No endpoint may start, stop or steer a run, a process or a
   command anywhere. sky-brain sends data, never commands.
2. **Identity comes from the token or session only.** Never trust an author, role or user id
   sent in a request body.
3. **Agents cannot write rules, approve, reject, release or delete.** Agents cannot write to
   the workspace (global) scope. Enforce this on the server, with tests.
4. **Every query is filtered by workspace membership.** Any new query needs a test that proves
   another workspace cannot read it.
5. **Tokens only in the `Authorization` header.** Never in a URL or query string.
6. **Every write is scanned for secrets** and size-capped. Instruction-like or web-sourced text
   is quarantined.
7. **The `context` packet is fenced.** Entries are rendered as quoted data with kind, status,
   author and source. Only approved rules appear in the rules section.

## Code rules

- TypeScript, strict mode. One file, one concern. Keep files under 400 lines; split before
  adding to a big file.
- Shared types and zod schemas live in `packages/shared`. Do not copy them.
- Tests: Vitest, with PGlite for the database. A change to permissions or trust rules needs a
  test for the allowed case and for the refused case.

## Layout (planned)

```
apps/server      API (/api/v1), MCP (/mcp), auth (/api/auth), serves the web build
apps/web         React app
packages/shared  entry types and zod schemas
docs/            plan, roadmap, decisions, tickets
vercel.json      Vercel project (build, function, rewrites)
```

## Commands

Node 22 (`>=22.12`) and pnpm 10 (`packageManager` in `package.json`).

```
pnpm install --frozen-lockfile   install exactly what pnpm-lock.yaml pins
pnpm lint                        ESLint and prettier --check
pnpm typecheck                   tsc --noEmit in every package
pnpm test                        Vitest in every package
pnpm build                       build the web shell (apps/web/dist)
pnpm dev                         build the web shell, then run the server on one port
node tools/dev-smoke.mjs         start pnpm dev, wait for /healthz, print `healthz 200`, stop it
pnpm --filter @sky-brain/server exec drizzle-kit generate
                                 write a migration after changing apps/server/src/db/schema.ts
```

Environment:

- `PORT`: the server's port (default 3000).
- `DATABASE_URL`: Postgres; required when `NODE_ENV=production`.
- `PGLITE_DATA_DIR`: dev only; default `.pglite` under `apps/server`; `memory://` for in-memory.
- `NODE_ENV`: `pnpm dev` sets `development` itself (in `apps/server/src/dev.ts`).

## Docs stay in sync

When code changes the behaviour described in `docs/PLAN.md`, update the plan in the same
commit. `docs/DECISIONS.md` is a log: add a new decision instead of rewriting an old one.

## Git

- Never push to `main` unless the user asks.
- Work on the branch you were given.
