# Commands: brain-core

The real commands for this project, read from its own config (package.json, Makefile,
Taskfile, CI). Approved by a human when the plan is approved. Workers read this file and
must not change it.

The flow runs Smoke before every ticket and Build, Test and Lint after every
ticket, so each must run without asking anything and exit non zero on failure. `Quick:` is
optional: when set, it runs in place of Test after the tickets in the middle of the plan, and
Test runs after the last ticket and before each handoff. `Sensitive:` is optional: a ticket whose
diff touches one of its paths is reviewed as level 3 whatever its own `Level:` says. `Shared:` and
`Setup:` matter only when tickets are built side by side (`FLOW_LANES`): a ticket that touches a
`Shared:` path is built alone, and `Setup:` runs once in each new lane worktree. `Profile:` sets
several FLOW_ settings at once (README, Profiles): `standard` (the default for a new plan: two reviewers side by side on each ticket, one review of the whole round at the end), `careful`, `normal` or `fast`. `Acceptance:` is optional: with it, a tester writes acceptance tests from the spec before the first ticket, and the flow runs this command once every ticket is resolved. `Lanes:` is how many tickets build side by side, each in its own worktree: `auto` (the plan's width, `flow-status.py <feature> --width`, at most 4, and at most 2 with `careful`; `fast` batches instead) or a number from 1 to 4. `FLOW_LANES` overrides it. `Typecheck:` and `Security:` are optional extra gate commands, run after Lint. A `Check <path>:` line is a gate command for one part of the repo, run only for a ticket that changes a path it names (`Check web/: npm run e2e`); add as many as you need. `Floor:` relaxes the floor guard for the whole plan and needs a reason (`Floor: allow config, reason: we are upgrading eslint`). `Gate:` says when the full gate and the review run: `each` ticket, every N tickets (`batch N`), or once at the `end`; without the line the profile picks (`fast` end, `standard` batch 3, `careful` each). Each ticket still gets the cheap checks. It turns the gate off only as `Gate: off unsafe`, and eval and the report then say so. Delete a line
you do not have; a line left as a placeholder is skipped.

This repo had no `package.json` when the plan was written: ticket 01 creates the root scripts
`lint` (`eslint . && prettier --check .`), `typecheck` (`pnpm -r --if-present typecheck`), `test`
(`pnpm -r --if-present test`), `build` (`pnpm -r --if-present build`) and `dev`, which are the
commands below and the brief's bar. Each command starts with `[ ! -f package.json ] ||`, so on
the empty base (before ticket 01 lands) it passes without doing anything, and from then on it
always runs. The gate runs commands with `bash -c` on Linux and macOS.

`Sensitive:` covers all of `apps/server/src/`: every route there is reachable by a hostile
caller, and identity (`actor/`, `config.ts`, `dev.ts`, which turns the dev header on), trust
rules and status routes (`entries/`), membership filters (`scope/`, `reads/`, `projects/`), the
fenced packet (`context/`), the guards, the workspace delete and the database code all live
under it. `packages/shared/src/` holds the request schemas and size caps (validation at the trust
boundary), and `render.yaml` sets the production environment (`NODE_ENV=production`, the
`DATABASE_URL` the server refuses to start without in production).

Build: `[ ! -f package.json ] || (pnpm install --frozen-lockfile && pnpm build)`
Test: `[ ! -f package.json ] || pnpm test`
Lint: `[ ! -f package.json ] || pnpm lint`
Typecheck: `[ ! -f package.json ] || pnpm typecheck`
Smoke: `[ ! -f package.json ] || (pnpm install --frozen-lockfile && pnpm typecheck)`
Run: `pnpm dev`
Shared: `apps/server/src/app.ts, pnpm-lock.yaml, docs/DECISIONS.md, docs/PLAN.md, CLAUDE.md`
Setup: `[ ! -f package.json ] || pnpm install --frozen-lockfile`
Sensitive: `apps/server/src/, apps/server/drizzle/, packages/shared/src/, render.yaml, .github/workflows/, scripts/, .feature-flow/, .claude/`
Profile: `standard`
Lanes: `auto`
Acceptance: `pnpm exec vitest run --root plans/brain-core/acceptance`
