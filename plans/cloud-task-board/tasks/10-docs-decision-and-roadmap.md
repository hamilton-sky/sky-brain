# Record the new decision, and update PLAN and ROADMAP for the task board

Type: task
Status: resolved
Blocked by: —
Test first: no
Level: 3
Builder: docs
Touches: docs/DECISIONS.md, docs/PLAN.md, docs/ROADMAP.md, CLAUDE.md

Repo: sky-brain. The brief's docs scope and its Decided lines. Level 3 because it rewrites the
contract (D1, D3, hard rule 1) that every other ticket is held to. It can land any time: it
describes spec.md, not code.

- `docs/DECISIONS.md`: add a new decision, numbered D19 (or the next free number if login-mcp's
  D16-D18 are not merged yet; whoever merges second renumbers, and says so in the decision).
  Title: "Goals and tasks move to sky-brain; devices pull approved work". **Chosen:** the
  goals and task DAG (tasks, dependencies, claims, file claims, attempts) of a linked project
  live in sky-brain, one authority per workspace; workers pull ready tasks and claim them with a
  10-minute lease and a fencing number; only a person approves a goal, approval pins the task
  text, and a device sees only goals its own person approved or was assigned. **Supersedes D3**
  (tasks and task claims; FSM state, events and telemetry stay in Pathly) **and narrows D1 and
  CLAUDE.md hard rule 1**: a device may pull and run, without confirmation at the device, tasks
  from goals its own person approved in the cloud; sky-brain still never pushes, starts, stops
  or steers anything, and never contacts a machine. **Why:** shammai's ask (brief), two
  machines splitting one goal, a crashed laptop's task coming back by itself; D3's "one lock in
  one place" holds, as the place is now sky-brain's Postgres. **Rejected:** brainstorm options
  B (goal checkout), C (registered runners) and D (mirror with local accept), with the
  brainstorm's one-line reasons. Do not edit D1 or D3 themselves (the log is append-only).
- `docs/PLAN.md`: section 3 ("What stays out" no longer lists task list and task claims for
  linked projects; one sentence on pull-only), section 5 (the new tables in the table:
  `goals`, `tasks`, `task_deps`, `task_events`, `device_codes`, `run_tokens`, `devices.secret_hash`),
  section 8 (the goal and task REST routes, written as spec.md § Interfaces names them, the MCP
  task tools as round two), section 9 (device flow routes and run-token verbs `read`, `plan`, `claim`, `report`), section 13 (a linked
  project uses the cloud board as its only task store; unlinked projects unchanged; the Pathly
  client that does this is a separate pathly-adapters plan, map.md § Follow-up: Pathly client).
- `docs/ROADMAP.md`: a row and a section "Layer 1b: Task board" after Layer 1 and before the
  two-week test (what ships, done when, what it retires: Pathly's local board for linked
  projects), and the two-week test gains the line "at least one goal a week is run from the
  cloud board".
- `CLAUDE.md` hard rule 1: the user approved this wording at plan approval (brief, Decided,
  approval 2; map.md § Decisions so far). Replace the rule's text with: "**Context, not
  execution.** No endpoint may start, stop or steer a run, a process or a command anywhere. sky-brain sends data, never
  commands. A device may pull, and run without confirmation at the device, tasks from goals its
  own person approved in sky-brain (D19); sky-brain never pushes them." Use the new
  decision's real number if it is not D19.
- Reconcile wording with the draft text at https://claude.ai/artifact/A5fT85ZwmHv5QH5yda3ywn if
  you can read it; the brief's Decided lines win over it.

## Not in this ticket

- `docs/layer-1/TICKETS.md`: T7 is unchanged; the plan's tickets implement its server side.
- A new `docs/CONNECT.md` and Pathly docs: round two.

## Done when

- `grep -n "Supersedes D3" docs/DECISIONS.md` prints the new decision's line, and D1 and D3
  read exactly as before (`git diff docs/DECISIONS.md` only adds lines).
- `grep -n "Layer 1b: Task board" docs/ROADMAP.md` prints its heading, and the two-week test
  holds the new line.
- `docs/PLAN.md` names the new tables and routes: `grep -c` finds `task_events`, `task_deps`,
  `run_tokens` and `device_codes` (section 5), `/api/v1/tasks/:id/claim` and
  `/api/v1/goals/:id/approve` (section 8), `/api/device/token` (section 9), and `cloud board`
  (section 13); none is in PLAN today, and each grep below prints a match.
- `grep -n "run without confirmation at the device" CLAUDE.md` prints the new hard rule 1
  sentence.
- `pnpm lint` exits 0.

```check
# The conductor runs this block before review.
$ grep -n "Supersedes D3" docs/DECISIONS.md
prints Supersedes D3
$ grep -n "Layer 1b: Task board" docs/ROADMAP.md
prints Layer 1b: Task board
$ grep -n "at least one goal a week is run from the cloud board" docs/ROADMAP.md
prints at least one goal a week
$ grep -n "task_events" docs/PLAN.md
prints task_events
$ grep -n "task_deps" docs/PLAN.md
prints task_deps
$ grep -n "run_tokens" docs/PLAN.md
prints run_tokens
$ grep -n "device_codes" docs/PLAN.md
prints device_codes
$ grep -n "/api/v1/tasks/:id/claim" docs/PLAN.md
prints /api/v1/tasks/:id/claim
$ grep -n "/api/v1/goals/:id/approve" docs/PLAN.md
prints /api/v1/goals/:id/approve
$ grep -n "/api/device/token" docs/PLAN.md
prints /api/device/token
$ grep -n "cloud board" docs/PLAN.md
prints cloud board
$ grep -n "run without confirmation at the device" CLAUDE.md
prints run without confirmation at the device
$ pnpm lint
```

## Reference

- The brief's Decided lines (quoted in spec.md § Goal and § Risks); brainstorm.md § Chosen and § Rejected
- `docs/DECISIONS.md` D1, D3, D8; `docs/PLAN.md`; `docs/ROADMAP.md`

## Answer

Resolved 2026-11-11 in the task board v1 session (branch `claude/cloud-task-board-v1`; the
first build of this ticket was lost with its container and never pushed, so this is a rebuild).

- The decision is **D20**: login-mcp took D16 to D19 first. It also records shammai's answer to
  the open question from the first build: a device (and an MCP client) runs only goals its own
  person approved; the assignee path is dropped from `eligibleTask`, with
  `tasks/ready-claim.test.ts` and `acceptance/claim.test.ts` updated.
- `docs/PLAN.md` § 3, § 5, § 8 (new "The task board" subsection, with the MCP board tools that
  were round two here and landed in this session), § 9 and § 13; `docs/ROADMAP.md` row, "Layer 1b:
  Task board" section and the two-week test line; `CLAUDE.md` hard rule 1 as approved, with D20.
- Every grep in the check block prints its match, and `git diff docs/DECISIONS.md` only adds lines.
