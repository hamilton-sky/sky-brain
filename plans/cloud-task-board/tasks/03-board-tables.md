# Add the board tables: goals, tasks, task_deps and append-only task_events

Type: task
Status: resolved
Blocked by: 02
Test first: yes
Level: 3
Builder: backend
Touches: apps/server/src/db/tasks-schema.ts, apps/server/src/db/tasks-schema.test.ts, apps/server/src/db/schema.ts, apps/server/drizzle/, apps/server/src/testing/task-seeds.ts, apps/server/src/testing/task-seeds.test.ts, apps/server/src/tasks/task-text.ts, apps/server/src/tasks/task-text.test.ts, packages/shared/src/tasks.ts, packages/shared/src/tasks.test.ts

Repo: sky-brain. The data of spec.md § Interfaces → Wire types and § Events and audit. Blocked by
02 because both generate drizzle migrations into one journal, so they must land in order, and
because `Verb` comes from 02's `packages/shared/src/run-tokens.ts` (new in ticket 02).

- `apps/server/src/db/tasks-schema.ts` (new), re-exported from `db/schema.ts`:
  - `goals`: id, workspace_id, project_id (composite FK to `projects (id, workspace_id)`),
    feature_id (nullable, composite FK to `features (id, project_id)`), title, body, executor
    enum (`single` | `loop` | `team`), status enum (`draft` | `approved` | `cancelled`),
    assignee, approved_by, approved_at, quarantined_because, author_kind, author,
    on_behalf_of, created_at, updated_at.
  - `tasks`: id, goal_id (FK cascade), workspace_id, project_id (copied from the goal, for the
    filters and the advisory lock key), title, body, lane, files (text array, nullable),
    context_refs (text array, default `{}`), status enum (`pending` | `in_progress` | `done` |
    `failed` | `blocked`), attempts (default 0), max_attempts (default 3, check 1..10),
    holder_actor, holder_person, holder_device (uuid, nullable), lease_expires_at, claim_seq
    (bigint default 0), text_hash, approved_hash, quarantined_because, proof (jsonb), fail_reason,
    position, created_by fields as goals, created_at, updated_at. Indexes for (project_id,
    status) and (goal_id, position).
  - `task_deps`: task_id, depends_on_id (both FK tasks cascade), primary key on the pair, check
    that they differ.
  - `task_events`: seq identity, workspace_id (no FK, like `audit_log`), task_id, kind enum
    (`created` | `claimed` | `renewed` | `released` | `done` | `failed` | `reclaimed`), actor,
    on_behalf_of, device_id, claim_seq, at, details jsonb default `{}`.
- Generate the migration, then add a custom SQL migration (`drizzle-kit generate --custom`)
  with a trigger that raises on `UPDATE`, `DELETE` and `TRUNCATE` of `task_events`, copied from
  `0001_audit-append-only.sql`.
- `apps/server/src/tasks/task-text.ts` (new): `taskTextHash({title, body, files,
  context_refs})`, SHA-256 hex over a canonical JSON of those four (so `files: null` and
  `files: []` hash differently), the one function every insert and the approve route use
  (spec.md § Decisions: a generated column is not possible on PGlite).
- `packages/shared/src/tasks.ts` (new): the enums, the strict zod request schemas and
  size caps of spec.md § Routes and § Size caps, and the `Goal`, `Task` and `Proof` wire types.
  It does not define `Verb`: ticket 02 defines it once in `packages/shared/src/run-tokens.ts` (new),
  and anything here that needs it imports it from there.
- `seedGoal` and `seedTask` in `apps/server/src/testing/task-seeds.ts` (new on this branch) as spec.md § Interfaces
  names them (`seedTask` sets `text_hash`, and `approved_hash` too when pinned).

Tests: `tasks-schema.test.ts` (new): `UPDATE`, `DELETE` and `TRUNCATE` of `task_events` raise;
a task with a project of another workspace is refused by the foreign key; a self-dependency is
refused. `task-text.test.ts`: the hash changes with each of the four fields. `tasks.test.ts`
in shared: an unknown field, an over-cap title and an over-cap `files` list are refused.

## Not in this ticket

- Any route: tickets 04-07.
- `device_codes` and `run_tokens`: tickets 01 and 02.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/db/tasks-schema.test.ts src/tasks/task-text.test.ts src/testing/task-seeds.test.ts`
  passes, covering the cases listed under Tests.
- `pnpm --filter @sky-brain/shared exec vitest run src/tasks.test.ts` passes.
- All existing tests still pass, and `pnpm lint` and `pnpm typecheck` exit 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/db/tasks-schema.test.ts src/tasks/task-text.test.ts src/testing/task-seeds.test.ts
prints passed
$ pnpm --filter @sky-brain/shared exec vitest run src/tasks.test.ts
prints passed
$ pnpm test
$ pnpm lint
$ pnpm typecheck
```

## Reference

- spec.md § Interfaces, § Decisions (pinned hash, Pathly's overlap rule)
- `apps/server/src/db/schema.ts` (`entries` foreign keys), `apps/server/drizzle/0001_audit-append-only.sql`
- map.md § Decisions so far (the PGlite spike)

## Answer

Work started at `19572ae9d15095cb4fa0d82b2d82151028785699`. Test-only commit `e120697`: the four
test files, failing on `Cannot find module` for `./tasks.ts`, `../tasks/task-text.ts` and the
seeds' imports.

**Built**
- New: `apps/server/src/db/tasks-schema.ts` (`goals`, `tasks`, `taskDeps`, `taskEvents` and the
  enums `goal_executor`, `goal_status`, `task_status`, `task_event_kind`), re-exported at the end
  of `apps/server/src/db/schema.ts`.
- New migrations: `apps/server/drizzle/0005_board-tables.sql` (`drizzle-kit generate --name
  board-tables`) and `0006_task-events-append-only.sql` (`--custom`, the trigger copied from
  `0001`), with `meta/0005_snapshot.json`, `meta/0006_snapshot.json` and `_journal.json`.
- New: `apps/server/src/tasks/task-text.ts` (`taskTextHash`, `TaskText`).
- New: `packages/shared/src/tasks.ts` (enums, `TASK_CAPS`, `tooLargeField`, strict
  `GoalCreateRequestSchema`, `GoalsListQuerySchema`, `TaskInputSchema`, `TasksAddRequestSchema`,
  `ReadyQuerySchema`, `ClaimRequestSchema`, `LeaseRequestSchema`, `ProofSchema`,
  `DoneRequestSchema`, `FailRequestSchema`; wire `Goal`, `Task`, `TaskHolder`, `Proof`).
- Changed: `apps/server/src/testing/task-seeds.ts` (adds `seedGoal`, `seedTask`; the existing
  exports are untouched).
- Tests: `apps/server/src/db/tasks-schema.test.ts`, `apps/server/src/tasks/task-text.test.ts`,
  `apps/server/src/testing/task-seeds.test.ts`, `packages/shared/src/tasks.test.ts`.

**Proof** (all run fresh after the last edit)
- `pnpm --filter @sky-brain/server exec vitest run src/db/tasks-schema.test.ts
  src/tasks/task-text.test.ts src/testing/task-seeds.test.ts`: 3 files, 22 tests passed. Covers
  `UPDATE`, `DELETE` and `TRUNCATE` of `task_events` raising `append-only: <op>` with the rows
  unchanged; a task with a project of another workspace refused by
  `tasks_project_in_workspace_fk`; a self-dependency refused by `task_deps_not_self`; plus a
  task whose project is not its goal's (`tasks_goal_in_project_fk`), goal project/feature FKs,
  `max_attempts` 0 and 11 refused, 1 and 10 stored, and events surviving the delete of their goal
  and task. `task-text.test.ts`: the hash changes with each of title, body, files, context_refs;
  `null` vs `[]` differ. Seeds: defaults, pinned by default under an approved goal, `pinned`
  both ways, positions 0,1,2, deps written, unknown goal throws.
- `pnpm --filter @sky-brain/shared exec vitest run src/tasks.test.ts`: 15 tests passed (unknown
  field, over-cap title as `title`, over-cap `files` as `tasks.1.files`, body cap in bytes,
  over-cap path, task count, gate summary, reason; non-cap failures give `tooLargeField` null).
- `pnpm test`: shared 3 files / 30 tests, server 26 files / 344 tests, exit 0.
- `pnpm lint` exit 0; `pnpm typecheck` exit 0.

**Decisions**
- `author_kind` on goals and tasks is `text` with a check (`goals_author_kind`,
  `tasks_author_kind`), not schema.ts's `author_kind` enum: the same circular-load trap ticket 02
  hit. The four new enums are defined in `tasks-schema.ts` itself, so they are safe.
- Tasks have two composite FKs instead of a plain `goal_id` FK: `tasks_goal_in_project_fk`
  (`goal_id, project_id` → `goals (id, project_id)`, cascade; needs the new
  `goals_id_project_unique`) and `tasks_project_in_workspace_fk`. Together they force a task's
  project and workspace to be its goal's.
- `task_events` has no FK on `task_id` or `workspace_id` (as `audit_log`): with one, deleting a
  goal or workspace would cascade into the trigger and fail. One index `(task_id, seq)`.
- `holder_device` is a plain nullable uuid (no FK), as the ticket says.
- `taskTextHash` hashes `JSON.stringify([title, body, files, context_refs])`: a fixed-order array,
  so key order cannot vary, and file order counts.
- Size caps: `tooLargeField(error)` returns the dotted path of the first over-cap issue (string or
  array `too_big`, or the body's byte check marked `params.too_large`), else null for a 400. A
  number out of range (`limit`, `max_attempts`) is 400, not 413. Titles count UTF-16 units
  (`.max`). `lane`, `assignee` and `depends_on` have no cap in the spec, so none here (the 64 KB
  body cap bounds them). `commit` is 7-64 hex; `pr_url` must be `https`.
- `seedTask` copies workspace, project and author from the goal, appends at position = current
  task count, defaults `files` to null and writes no event (seeds insert rows only).

**Shortcuts taken**
- No index on `task_deps.depends_on_id`: a task delete scans `task_deps` for dependents, and
  ticket 07's "transitive dependents blocked" walks it backwards. Fine at today's sizes; add the
  index when a goal has many tasks.
- `seedTask` does not pass `context_refs` (the spec's signature has none); it always hashes `[]`.

**For later tickets**
- 04-07: map a failed `safeParse` with `tooLargeField(error)`: non-null is 413 `too_large` with
  that `field`, else 400 `invalid_request`. `ReadyQuerySchema.limit` coerces the query string.
- 05: `depends_on` entries are `int >= 0 | uuid`; the route still checks "earlier index or a task
  of this goal".
- Every insert or text update of a task must write `text_hash = taskTextHash(...)`; approve copies
  it to `approved_hash`.
