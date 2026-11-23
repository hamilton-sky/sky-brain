# Agents in sky-brain: identity, permissions, skills and board triggers

**Status:** part 1 (identity) is built and live (D26, 23 Nov 2026). Parts 2 to 4 (scopes, skills,
triggers) are still a proposal under D25 in [`docs/DECISIONS.md`](../DECISIONS.md).

sky-brain is a brain shared by a person (or an organization) and the AI agents they connect.
For agents to share it safely, the server has to know four things about each one: **who it is**,
**what it may touch**, **how it should work**, and **when it should wake up**. This file fills
the gap between [VISION.md § Personas and agents](VISION.md#personas-and-agents) (the idea) and the
code (what runs today). It came out of a comparison with Notion's agents (Nov 2026), which ship the
same four pieces for team documents.

## Where we stand today

| Piece | Today (code) | Gap |
| --- | --- | --- |
| **Identity** | **Built (D26).** A person creates profiles and binds each connected app to one (`apps/server/src/agents/`). A bound MCP caller is `mcp/<client host>/<slug>` with a `profile` on its actor, recorded by audit rows, task events and entry authors; `whoami` shows it. An unbound app is the Guest agent. | One role per app per person; run tokens (devices) have no profile yet; bylines are not yet drawn as chips on the board. |
| **Permissions** | Server rules for every agent: no approve, reject, release, delete or global writes (hard rule 3, `actor/require-human.ts`). Run tokens carry verbs (`read`, `plan`, `claim`, `report`) and a role capped at `editor` (`packages/shared/src/run-tokens.ts`, `run-tokens/run-scope.ts`). | Same rights for every agent. No way to say "the Doer may write only to the board of the task it holds" or "the Librarian may read Notebooks but never the board". |
| **Skills** | None. Instructions live in each client (`CLAUDE.md`, `.claude/agents/*.md`, `AGENTS.md`). | No shared, versioned "how this agent works", so two models doing the same role drift apart. |
| **Board triggers** | Every task change writes an append-only `task_events` row (`tasks/task-events.ts`), and every entry change writes an append-only `entry_versions` row (`db/memory-schema.ts`). | Nothing reacts to them, and memory has no event log yet. An agent learns about new work only when a person asks it to call `next_task`. |

## The proposal

One new concept, the **agent profile**: a row the person creates (or accepts from a template)
that holds identity, scope, skills and triggers together. Agents never create or edit profiles
(hard rule 3); only the person does, on the web.

### 1. Identity: who wrote this

- As built (D26): table `agent_profiles` (`id`, `user_id`, `slug`, `display_name`, `kind`
  worker or steward), unique on `(user_id, slug)`; a profile belongs to a person, not a
  workspace. Table `agent_bindings` (`user_id`, `client_id`, `profile_id`).
- **The profile is bound by the person, never claimed by the agent** (VISION.md "Binding
  personas"). The binding is kept on the server per connected app and looked up on every call,
  rather than written into the token on the consent page: it takes effect at once and does not
  touch the sign-in flow. Run tokens get the same later.
- `Actor` gains an optional `profile`, and `agent_id` becomes `mcp/<client host>/<slug>`, so
  every existing author column names the role: "po via claude.ai, for shammai".
- Every entry, version, task event and audit row records the profile. The web shows it as the
  byline chip (You, PO, Librarian, Doer · task 42).
- A token without a profile gets the built-in **Guest agent**: today's rights, nothing more.
  Existing connectors keep working.

Cognitive basis: source monitoring. People misremember *who* told them something more often than
*what* they were told; sky-brain keeps the source on every row so trust can depend on it
([HUMAN-MEMORY.md](HUMAN-MEMORY.md), principle 4: store the encoding context, persona included).

### 2. Permissions: what each agent may touch

- Table `agent_scopes`: `profile_id`, `target` (`memory:<id>`, `project:<id>`, `layer:<core|long|short|working>`),
  `access` (`read` or `propose`). There is no `approve` value. Hard rule 3 stays in code and
  overrides any scope.
- **Start from nothing.** A new profile reads and writes nothing until the person ticks targets.
- The effective right of a call is the **lowest** of: the person's role in that memory or project,
  the run token's role, and the profile's scope. Same pattern as `effectiveRole` today.
- Default scopes by template (the person can change them):

| Profile | Reads | Proposes into | Never |
| --- | --- | --- | --- |
| Product owner (worker) | Board, Notebooks | Goals (as `proposed`), Inbox | Doing tasks, approving |
| Doer (worker) | Its claimed task and the context packet | That task's board, Inbox | Notebooks directly |
| Reviewer (worker) | The task under review and its evidence | Review reports, Inbox | Changing the task's output |
| Librarian / Consolidator (steward) | Inbox, Notebooks | Proposed gists, links, merges, Digest cards | The board, About me |

### 3. Skills: how each agent works

- Table `agent_skills`: `id`, `workspace_id`, `name`, `body` (markdown), `version`, append-only
  like entry versions. A profile lists the skills it uses (`agent_profile_skills`).
- Served two ways, both read-only to agents: as MCP **prompts** (clients that support them show
  them as slash commands) and as the tool `get_skills`, which returns the bound profile's skills.
  The `claim_task` context packet names the skills that apply to the task.
- Skills are data, not commands (hard rule 1): sky-brain hands the text over; the agent's own
  model decides how to use it. Skills are fenced like every other context (hard rule 7) and only
  the person edits them.
- An optional export writes them as `.claude/agents/<slug>.md` or `AGENTS.md` for clients that
  read files.

Cognitive basis: procedural memory. Knowing *how* to do a job is kept apart from knowing *what*
happened, is learned slowly, and runs without being re-explained each time.

### 4. Board triggers: when each agent wakes up

- Table `agent_triggers`: `profile_id`, `on` (one of `task.ready`, `task.reported`,
  `goal.approved`, `goal.finished`, `entry.captured`, `schedule`), an optional filter (project,
  memory, kind), and `status`.
- When a matching event row is written, the same transaction inserts an **activation** row:
  `profile_id`, `event_id`, `state` (`open`, `claimed`, `done`, `expired`), lease fields. This is
  the blackboard pattern: agents never call each other; they meet on the board.
- An agent asks `next_activation` (MCP) and claims it with a lease, exactly like `claim_task`.
  Clients that cannot wait run it from a schedule (a Claude routine, a cron on the person's
  device). sky-brain **never pushes** a run to anyone (hard rule 1; D1 and D20 stand). Events are
  read by position, since LISTEN does not work through Nanogres's PgBouncer.
- Limits: one open activation per `(profile, event)`, a daily cap per profile, and expiry after
  24 hours, so a busy board cannot flood an agent.

Cognitive basis: prospective memory, the "remember to do X when Y happens" system. A cue in the
environment, not constant checking, brings the intention back.

## How it fits the rules

- Agents still only propose; nothing here lets an agent raise trust, approve a goal or edit About
  me. Profiles, scopes, skills and triggers are written only by people (`requireHuman`).
- Every new query is filtered by workspace and needs a cross-workspace test (hard rule 4). Every
  scope check needs an allowed and a refused test.
- Works the same for one person and for an organization: in an organization the owner defines
  shared profiles; each member's connected agents bind to one of them.

## When to build it

The memory loop (steps 1 and 2) is live and is being measured for two weeks (step 3). Profiles do
not change that measurement, so the suggested order is:

1. **Identity + Guest agent** (small): profile table, consent "Connect as", `profile_id` in
   tokens and audit rows, bylines. Useful at once, because the measurement can then tell which
   role wrote what.
2. **Scopes**, together with step 6, because the Consolidator is the first agent that needs
   narrower rights than a Doer.
3. **Skills** (MCP prompts + `get_skills`).
4. **Triggers and activations**, once two or more profiles are in daily use.

Each part ships with its tests and a `docs/PLAN.md` update in the same PR.

## Learned from Notion (Nov 2026)

Notion's Custom Agents have their own identity and their own permissions, start with no access,
wake on database, schedule, Slack and mail triggers, and sync "skills" to other agents over MCP.
Notion 3.8 adds attribution and one-click restore of agent edits. What sky-brain keeps different:
agents propose before anything changes (Notion lets agents write and offers undo afterwards),
sky-brain never runs a model or pushes a run, and memory is layered and governed by trust, not a
pile of pages.
