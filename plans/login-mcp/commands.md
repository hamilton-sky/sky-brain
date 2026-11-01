# Commands: login-mcp

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
several FLOW_ settings at once (README, Profiles): `standard` (the default for a new plan: two reviewers side by side on each ticket, one review of the whole round at the end), `careful`, `normal` or `fast`. `Acceptance:` is optional: with it, a tester writes acceptance tests from the spec before the first ticket, and the flow runs this command once every ticket is resolved. `Lanes:` is how many tickets build side by side, each in its own worktree: `auto` (the plan's width, `flow-status.py login-mcp --width`, at most 4, and at most 2 with `careful`; `fast` batches instead) or a number from 1 to 4. `FLOW_LANES` overrides it. `Typecheck:` and `Security:` are optional extra gate commands, run after Lint. A `Check <path>:` line is a gate command for one part of the repo, run only for a ticket that changes a path it names (`Check web/: npm run e2e`); add as many as you need. `Floor:` relaxes the floor guard for the whole plan and needs a reason (`Floor: allow config, reason: we are upgrading eslint`). `Gate:` says when the full gate and the review run: `each` ticket, every N tickets (`batch N`), or once at the `end`; without the line the profile picks (`fast` end, `standard` batch 3, `careful` each). Each ticket still gets the cheap checks. It turns the gate off only as `Gate: off unsafe`, and eval and the report then say so. Delete a line
you do not have; a line left as a placeholder is skipped.


These are the root scripts brain-core ticket 01 created (`package.json`: `lint` is
`eslint . && prettier --check .`, `typecheck` is `pnpm -r --if-present typecheck`, `test` is
`pnpm -r --if-present test`, `build` is `pnpm -r --if-present build`) and the steps of
`.github/workflows/ci.yml`. The gate runs commands with `bash -c` on Linux and macOS. Smoke is
install plus typecheck, about 30 seconds here; it ran green on the base (81697be). Tickets that add
packages need the registry, which the builder and CI reach.

`Sensitive:` keeps brain-core's list: everything under `apps/server/src/` is reachable by a hostile
caller and holds identity, sessions, tokens and membership filters; the migrations, the shared
schemas, `render.yaml` (production settings and secrets) and the flow's own folders are always
level 3. `Shared:` adds the server's `package.json`, which every ticket that adds a dependency
changes.

Build: `pnpm install --frozen-lockfile && pnpm build`
Test: `pnpm test`
Lint: `pnpm lint`
Typecheck: `pnpm typecheck`
Smoke: `pnpm install --frozen-lockfile && pnpm typecheck`
Run: `pnpm dev`
Shared: `apps/server/src/app.ts, apps/server/package.json, pnpm-lock.yaml, docs/DECISIONS.md, docs/PLAN.md, CLAUDE.md`
Setup: `pnpm install --frozen-lockfile`
Sensitive: `apps/server/src/, apps/server/drizzle/, packages/shared/src/, render.yaml, .github/workflows/, scripts/, .feature-flow/, .claude/`
Profile: `standard`
Lanes: `auto`
Acceptance: `pnpm exec vitest run --root plans/login-mcp/acceptance`
