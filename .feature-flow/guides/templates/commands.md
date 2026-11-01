# Commands: <feature>

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

Build: `<command>`
Test: `<command>`
Quick: `<optional: the fast subset of Test, run after the tickets in the middle of the plan; Test runs after the last ticket and before each handoff>`
Lint: `<command>`
Typecheck: `<optional: the type checker, such as tsc --noEmit or mypy>`
Security: `<optional: a security scan, such as semgrep --config auto --error>`
Check <path>: `<optional: a command for one part of the repo, run only when a ticket changes a path under it. replace <path> with it, e.g. Check web/: npm run e2e>`
Smoke: `<the quickest command that proves the base is healthy, run before every ticket>`
Run: `<command, if the feature has something to start>`
Shared: `<optional: paths many tickets change, comma separated, such as a changelog, a version file or a routes table. a ticket touching one is never built beside another>`
Setup: `<optional: what a fresh checkout needs before Build and Test run, such as npm ci or a venv install. run once in each lane worktree>`
Sensitive: `<optional: paths that make any ticket touching them level 3, comma separated. a folder ends with /, a * glob crosses folders. e.g. src/auth/, *token*, scripts/>`
Profile: `standard`
Lanes: `auto`
Floor: `<optional: allow <category>, reason: <why the bar moves for this plan>. categories: skip, suppress, empty-catch, test-delete, threshold, trivial-assert, config>`
Gate: `<optional: each, batch N or end (the profile's default without it); off unsafe only when the plan cannot run its commands at all>`
Acceptance: `<optional: the command that runs only the tests in plans/<feature>/acceptance/, which the tester writes from spec.md before the build. never part of Test>`
