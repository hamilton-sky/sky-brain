# Map: cloud-task-board (round one)

## Destination

sky-brain holds each workspace's goals and task DAG as the one authority. A machine logs in once
with the device flow, mints run tokens of at most 30 minutes bound to a device, workspace,
project, role and verbs, and with them pulls ready tasks, claims one with a 10-minute lease and
a `claim_seq` fencing number, renews it, and reports done with proof or failed. Only a person
approves a goal, approval pins the task text, and a device only sees goals its own person
approved or was assigned. sky-brain never contacts a machine. This plan changes sky-brain only;
the Pathly client is a follow-up plan in pathly-adapters (below).

**The bar.** On a fresh clone,
`pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` exits 0, with tests
proving the eight properties in spec.md "Goal and the bar", and
`pnpm --filter @sky-brain/server test:pg` passes against a real Postgres (CI runs it). The
acceptance ticket (13, the last in the graph) runs both. The live half of the brief's bar
(Pathly runs a three-task goal while the phone shows it) moves to the Pathly follow-up and
round two (R2-10); the user confirmed this at plan approval (Decisions so far).

## Which repo each ticket changes

All tickets (01-08, 10, 13) change sky-brain only, on branch `claude/cloud-task-board`. Numbers
09, 11 and 12 were the Pathly tickets; they left this plan (plan review round 1) and are not
reused.

## How to work this

- See what is ready: `python3 scripts/flow-status.py cloud-task-board`. Take the lowest numbered READY ticket.
- Claim: set `Status: claimed` in the ticket and save before starting.
- Resolve: write the result under `## Answer`, set `Status: resolved`, then add one line to
  Decisions so far below.
- See the graph: `python3 scripts/flow-status.py cloud-task-board --mermaid` (coloured by status, drawn on demand).
- Commands live in `commands.md` (frozen). Lessons live in `learnings.md` (append only).
- Status lives only in the ticket files. This map never repeats it.

## Dependencies outside this plan

- **brain-core 05-11** (entries routes, context packet) are not merged on this branch. They also
  change `apps/server/src/app.ts`, `apps/server/src/testing/harness.ts`,
  `apps/server/src/db/schema.ts` and `apps/server/drizzle/`. This plan adds its tables in new
  files and its seeds in `testing/task-seeds.ts` to keep the overlap small; whoever merges
  second rebases and renumbers drizzle migrations (`drizzle-kit generate` again).
- **login-mcp** (Google sign-in, allowlist, per-person workspaces, `/mcp`, Better Auth) is a
  parallel plan, not on this branch. It plugs its session and JWT resolvers in behind
  `options.resolveActor`; this plan's resolver only claims `sbd_`/`sbr_` bearer tokens. It may
  add decisions D16-D18; whoever merges second renumbers the new decision (ticket 10).

## Follow-up: Pathly client (its own plan, in pathly-adapters)

A separate feature-flow plan, run inside `hamilton-sky/pathly-adapters` with that repo's own
`commands.md` (its gate: `python -m pytest tests/ -q`, `black --check src/ tests/`,
`mypy src/ --ignore-missing-imports --no-strict-optional`, `python scripts/check_file_size.py`,
`lint-imports`, from its CLAUDE.md and `.github/workflows/`). It starts once this plan's routes
are merged. Outline, in order:

1. Route every raw task-row writer through the query facade, behaviour unchanged: move
   `retry_task`'s requeue (with its `redact_run_tokens` and 4000 cap) and the deadlock marker out
   of `supervisor/task_retry.py`, and `_release_claim` out of
   `http_server/blueprints/comms/tasks.py`, into a new `db/queries/comms_task_writes.py`
   re-exported like `fail_task`; a test fails on any raw `UPDATE comms_messages SET task_status`
   outside `db/queries/`. Level 3 there (claim release, requeue and deadlock writers).
2. A sky-brain client, `pathly_orchestrator/db/brain/`: `settings.linked_project()` reads
   `.pathly/brain-link.json` (`{"url", "project_id"}`) in the project root; the device token
   lives in `~/.pathly/brain/device_token` (mode 0600) or `PATHLY_BRAIN_DEVICE_TOKEN`;
   `BrainClient` (stdlib `urllib`) mints run tokens and refreshes them 60 s before expiry;
   `leases` keeps `claim_seq` per task and renews every 180 s. Level 3 (tokens).
3. The linked-project switch: for a linked project, `get_ready_tasks`, `claim_task`,
   `complete_task` and `fail_task` call this plan's REST routes; work stops when renew answers
   `lease_lost`; `reclaim_stale_claims` does nothing; the `require_tasks_done` gate fails closed
   when the cloud board cannot be read (today `fsm/gates/tasks.py` fails open). Unlinked
   projects keep local SQLite exactly as before. Level 3.
4. Its acceptance: the live half of the brief's bar, together with round two's R2-10.

## Round two (`plans/cloud-task-board-round-two/`, planned later)

Its own map links back here. Rows, not yet tickets:

- R2-01 Devices web page with revoke, and the device approval page at `verification_uri`
  (T7's "devices list in the web page"; needs login-mcp sign-in).
- R2-02 Web goals page: the DAG, each task's status, holder ("on laptop 1"), device, attempts and
  proof; approve and cancel from the phone (needs login-mcp sign-in).
- R2-03 People's edit, reorder, block and cancel of single tasks (re-pins on approve).
- R2-04 MCP tools `task_next`, `task_claim`, `task_done`, `task_fail`, goal and task creation,
  with fenced rendering of task text (needs login-mcp `/mcp`).
- R2-05 FSM run summary: Pathly sends current stage and final result one way; read-only on the board.
- R2-06 Live push to the board page.
- R2-07 `pathly brain login` (device flow CLI), the outbox for reports while offline, and Pathly
  picking up newly approved goals by itself (T10 pieces).
- R2-08 Run tokens on brain-core's entries routes: those routes check the run token's project,
  then the verb table adds them (`read`, `post`), with T7's "a token without `post` cannot post".
- R2-09 One-shot import of a local Pathly board into a linked project (last).
- R2-10 The live bar: Pathly on a laptop runs a three-task goal from the cloud board, and the
  phone shows each task go pending, in progress, done with proof (needs the Pathly follow-up
  and R2-02).

## Decisions so far

- plan — Spike (scratch folder, not committed) on PGlite 0.5.14: a generated column using
  `sha256(convert_to(...))` or `array_to_string(...)` fails with "generation expression is not
  immutable", so the pinned-text hash is computed in the app. `pg_advisory_xact_lock(
  hashtextextended('task-claim:p1', 0))` works inside `transaction()`, and three concurrent
  `transaction()` calls doing `UPDATE ... WHERE status='pending'` gave exactly one winner
  (PGlite serializes them, so it cannot show a real interleaving).
- plan — Under Read Committed a second `UPDATE` of the same row waits for the first, then
  re-evaluates its `WHERE` on the new row version and skips the row if it no longer matches:
  the conditional claim has one winner. docs: https://www.postgresql.org/docs/current/transaction-iso.html
- plan — Transaction-level advisory locks (`pg_advisory_xact_lock`) are held until the
  transaction ends; the one-bigint and two-int key spaces do not overlap, so use one form only.
  docs: https://www.postgresql.org/docs/current/functions-admin.html,
  https://www.postgresql.org/docs/current/explicit-locking.html (scout finding, not re-read)
- plan — RFC 8628: the authorization response has `device_code`, `user_code`,
  `verification_uri`, optional `verification_uri_complete`, `expires_in` and optional
  `interval` (default 5 s); the token request uses `grant_type`
  `urn:ietf:params:oauth:grant-type:device_code`; errors `authorization_pending`, `slow_down`
  (the client adds 5 s), `access_denied`, `expired_token`; user codes should be rate limited
  and may use the base-20 set `BCDFGHJKLMNPQRSTVWXZ` (8 characters, about 34.5 bits); device
  codes need high entropy. docs: https://www.rfc-editor.org/rfc/rfc8628
- plan — A fencing token must rise with every new lease and be checked by the storage on every
  write; checking expiry before writing does not fix a paused client. docs:
  https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html (scout finding)
- plan — GitHub Actions service container for a job on the runner: `services.postgres` with
  `image`, `env.POSTGRES_PASSWORD`, `options: --health-cmd pg_isready --health-interval 10s
  --health-timeout 5s --health-retries 5`, `ports: ["5432:5432"]`, reached at `localhost`.
  docs: https://docs.github.com/actions/guides/creating-postgresql-service-containers
- plan — Postgres 16 server binaries are installed on this host (`/usr/lib/postgresql/16/bin`)
  and Docker is present, so a builder can run `test:pg` locally; CI uses the `postgres:18` image,
  the major Render and PGlite run.
- plan — pathly-adapters (55b05ff), for the follow-up plan: raw task writers outside the facade are
  `supervisor/task_retry.py` (`retry_task`, the deadlock marker) and
  `http_server/blueprints/comms/tasks.py` (`_release_claim`); `db/queries/comms_tasks.py` is 388
  lines against a 400-line ratchet (`scripts/check_file_size.py`); `fsm/gates/tasks.py` returns
  0 unfinished tasks on any error (fail-open); `supervisor/file_claims.py` defines the overlap
  rule this plan copies; HTTP calls use stdlib `urllib`; pytest is not installed on this host.

- user (approval 2, 2026-11-02) — shammai approved ticket 10's new CLAUDE.md hard rule 1
  wording (a device may pull, and run without confirmation at the device, tasks from goals its
  own person approved; sky-brain never pushes them). Ticket 10 applies it.
- user (approval 2, 2026-11-02) — the live half of the brief's bar (Pathly on a laptop runs a
  three-task goal; the phone shows each task go pending, in progress, done with proof) is out of
  this plan's bar; it belongs to the pathly-adapters follow-up and round two (R2-10).
- user (approval 2, 2026-11-02) — agent goal proposals stay option A: an agent creates a goal
  only as `draft`, only a person approves, and an agent never approves (ticket 04, spec.md).
- plan — `attempts` counts fails only: claim and a takeover after an expired lease leave it
  unchanged; fail adds 1 and compares the new value with `max_attempts` (plan review round 2;
  spec.md § Decisions, tickets 06 and 07).
- plan — Vitest 5.0.5 (pinned in `pnpm-lock.yaml`): `test.exclude` defaults to
  `['**/node_modules/**', '**/.git/**']`, and "manually setting `exclude` in your config will
  replace the default value", so ticket 08 writes `exclude: [...configDefaults.exclude,
  "**/*.pg.test.ts"]` with `configDefaults` from `vitest/config`. `--config <file>` picks the
  second config for `test:pg`. docs: https://vitest.dev/config/exclude (also the installed
  `vitest/dist/config.d.ts` and `defaults` chunk, `defaultExclude`).
- 01 — Device flow at /api/device (flat RFC 8628 errors, own body-error handler), human devices routes at /api/v1/devices; device code and `sbd_` token stored as SHA-256 only; user code unique while `device_id IS NULL`; device audit rows use the nil workspace uuid.
- 01 — Review round 1: per-address limits on /api/device (`trust proxy` 1 in app.ts), expired unapproved codes purged on /code, approve is a fixed 15-minute window, a revoked or 60 s-late approved code is handled at poll.
- 01 — Review round 2: `createApp({ trustProxyHops })` (default 1, forced 0 with the dev actor header, D15), device-flow limits key IPv6 by /64, optional `publicBaseUrl` for `verification_uri`, partial index on pending `expires_at`; Render's real hop count is unverified.
- 02 — Run tokens `sbr_` (hash only, `run_tokens.role` text+check since schema.ts enums are undefined in auth-schema at load), resolver chained before `options.resolveActor`, full verb table in `run-tokens/verbs.ts` mounted after `express.json`; a person calling mint gets 403 `verb_not_allowed`; `assertRunScope`/`effectiveRole` in `run-tokens/run-scope.ts` for 04-07.
- 02 — Review round 2: mint is rate-limited per actor and device (default limiter) and purges the device's expired run tokens; the bearer scheme is case-insensitive; HEAD needs the GET verb.

## Open questions

- architect: when login-mcp lands Better Auth, does its device authorization plugin replace
  this plan's `/api/device/*` routes, or does sky-brain keep its own? The routes follow RFC 8628
  names so Pathly's client survives either way.
- The draft docs text at https://claude.ai/artifact/A5fT85ZwmHv5QH5yda3ywn could not be read by
  the planner (no tool for it); ticket 10's builder reconciles its wording with the ticket.
