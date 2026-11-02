# Add the board tables: goals, tasks, task_deps and append-only task_events

Type: task
Status: open
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
