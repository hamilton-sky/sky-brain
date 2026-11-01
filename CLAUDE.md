# sky-brain: notes for agents working in this repo

## What this repo is

sky-brain is a shared, typed knowledge store for people and AI agents, hosted on Render.
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
render.yaml      Render Blueprint
```

## Commands

To be filled in by ticket T1 (scaffold).

## Docs stay in sync

When code changes the behaviour described in `docs/PLAN.md`, update the plan in the same
commit. `docs/DECISIONS.md` is a log: add a new decision instead of rewriting an old one.

## Git

- Never push to `main` unless the user asks.
- Work on the branch you were given.
