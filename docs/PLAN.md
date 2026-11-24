# sky-brain: the plan

_Written 2026-11-01. This is a living document: when the code changes what it describes,
update it in the same commit._

**What is built (15 Nov 2026):** the [README](../README.md#the-contract) holds the goal, the
built/partly built table and the build order; this plan explains how the built parts work. Built:
sign-in (§ 9), the MCP endpoint with `whoami` and the task board tools (§ 8), the device flow and
run tokens as an API (no approval page yet), the Vercel deploy (§ 12), the schema of § 5 and the
write guards. **Not built yet:** the entries API, the entry MCP tools of § 8 and the
`context` packet (§ 7). Sections that describe them are the contract for that work.

**Next:** the memory, in the order of D21 ([vision/BUILD-PLAN.md](vision/BUILD-PLAN.md)):
extend the `entries` table (kind and trust level as two fields, D22; evidence, validity dates, a
tier) and add `entry_versions`, `links`, `episodes`, `uses` and `intentions`; Stewards (Curator,
Consolidator, Archivist, Auditor) that run in the person's own model and only propose; and the
Gatekeeper as server code checking every write. sky-brain calls no LLM except for embeddings.
The order and the trust model are decided; the rest of the design is a proposal until its step
is built, and this plan changes with the code.

## 1. What it is

sky-brain is a shared brain for people and AI agents. It is one place in the cloud where
people, Claude, Codex, claude.ai and Pathly read and write the same knowledge.

Three ideas carry it:

1. **Context, not execution.** sky-brain stores and serves knowledge. It never runs an agent,
   never holds a code checkout, and never sends a command to any machine. Agents run where the
   code is and connect to sky-brain to read and write.
2. **Typed knowledge that stays true.** Every entry has a kind (rule, decision, claim,
   question, answer, artifact, lesson, note) and a status. A decision ends only when a newer
   one supersedes it. Unconfirmed claims expire. Nothing is edited in place after approval.
3. **People hold the top authority.** Agents propose. People approve, reject and write rules.

It is the blackboard idea from Pathly, lifted out of the local app so every tool and every
device can reach it.

## 2. Who uses it, and how they get in

| Who | Where | How they get in |
|---|---|---|
| You and your team | Browser, phone | Sign in with Perminister |
| claude.ai (web, desktop, phone app) | Anthropic's servers | Custom connector, OAuth 2.1 |
| Claude Code, Codex CLI (interactive) | Laptop or cloud session | MCP over HTTPS, OAuth or device token |
| Headless agents (Pathly runs, `claude -p`, `codex exec`) | Wherever the code is | Short-lived run token |
| Pathly | Laptop | REST, through its fragments |

## 3. Architecture

```
 Browser / phone ───── Perminister sign-in (cookie) ──┐
 claude.ai connector ─ OAuth 2.1 (CIMD + PKCE) ───────┤
 Claude Code / Codex ─ MCP + OAuth or device token ───┼──▶  sky-brain on Vercel (one origin, D16)
 Pathly runs ───────── REST + run token ──────────────┘       ├─ /api/v1     REST API
                                                              ├─ /mcp        MCP (streamable HTTP)
                                                              ├─ /api/auth   Better Auth (Perminister, OAuth server)
                                                              ├─ /           web app (React build)
                                                              └─▶ Nanogres Postgres
```

One Node service serves the API, the MCP endpoint, the auth routes and the web app from one
origin. One origin means no cross-site cookies and no wide CORS. Layer 2 adds a websocket
route for live editing to the same service.

**What stays out of sky-brain:** running agents, code checkouts, build and test gates, FSM
state, run events and cost telemetry. Those belong to Pathly, next to the code, because gates
need the code. The goals and task DAG with its claims moved in (D20): sky-brain is the one lock,
and it is pull-only. Workers ask for ready tasks and claim them; sky-brain never contacts a
machine.

## 4. Scopes

Three levels, like Pathly's boards:

- **Workspace** (the "global" scope): rules and decisions for everything you do.
- **Project**: one codebase or product. Identified by its normalized git remote when it has one,
  so every machine finds the same project.
- **Feature**: one piece of work inside a project.

An agent reads down the chain (feature + project + workspace) and writes mostly to the feature
and project. Agents never write to the workspace scope.

## 5. Data model (Layer 1)

Better Auth owns its own tables (users, sessions, accounts, OAuth clients and tokens, JWKS).
sky-brain adds:

| Table | Columns (short) |
|---|---|
| `workspaces` | id, name, created_at |
| `members` | workspace_id, user_id, role (`owner` \| `editor` \| `viewer`) |
| `invites` | workspace_id, email, role, invited_by, accepted_at |
| `projects` | id, workspace_id, slug, name, git_remote (normalized, unique per workspace) |
| `features` | id, project_id, slug, name, archived_at |
| `memories` | id, workspace_id, layer (`core` \| `long` \| `short` \| `working`), name, is_default. One `core` (About me) per workspace |
| `entries` | see below |
| `entry_versions` | every version of an entry's text, kind and summary. Append-only |
| `audit_log` | seq, workspace_id, actor, action, target_id, at, details. Append-only. |
| `devices` | id, user_id, name, created_at, last_seen_at, revoked_at, secret_hash (the `sbd_` device token's SHA-256) |
| `device_codes` | the device flow (RFC 8628): device_code_hash, user_code, client_name, expires_at, interval, approved_by, device_id, issued_at |
| `run_tokens` | token_hash, device_id, workspace_id, project_id, role, verbs, expires_at (at most 30 minutes) |
| `goals` | id, workspace_id, project_id, feature_id, title, body, executor, status (`draft` \| `approved` \| `cancelled`), assignee, approved_by, approved_at, quarantined_because, author_kind, author, on_behalf_of |
| `tasks` | id, goal_id, title, body, lane, files, context_refs, position, status (`pending` \| `in_progress` \| `done` \| `failed` \| `blocked`), attempts, max_attempts, holder, lease_expires_at, claim_seq, text_hash, approved_hash, proof, fail_reason |
| `task_deps` | task_id, depends_on_id (the DAG; no cycles, same goal) |
| `task_events` | task_id, kind (`created` \| `claimed` \| `renewed` \| `released` \| `done` \| `failed` \| `reclaimed`), actor, device_id, claim_seq, at. Append-only. |

### `entries` (memory core, BUILD-PLAN step 1)

The full design is [vision/schema/MEMORY-SCHEMA.md](vision/schema/MEMORY-SCHEMA.md); this is the thin
part that is built.

| Column | Meaning |
|---|---|
| `id`, `seq` | uuid; `seq` moves on every insert and change, a "what changed since" cursor |
| `workspace_id`, `memory_id`, `layer` | the memory it lives in, for life; `layer` is a copy of the memory's, held by a composite foreign key |
| `kind` | `fact`, `decision`, `hypothesis`, `observation` (needs a ref as evidence), `external` (D22) |
| `topic` | optional: `rule`, `question`, `answer`, `lesson`, `note`, `artifact` |
| `trust` | `quarantined`, `proposed`, `approved`, `rejected` (D22) |
| `version`, `title`, `body`, `summary`, `summary_source`, `questions`, `refs` | the current version; every version is also in `entry_versions` |
| `author_kind`, `author`, `on_behalf_of`, `source` | who wrote it; `source` is `human`, `agent`, `web` or `import` |
| `quarantined_because` | why the text is held (`web_source` or a quarantine pattern), or null |
| `expires_at` | Inbox (short) entries only: 30 days after capture they leave agents' default search |
| `search` | generated: title (A), summary and questions (B), body (C), `simple` config with `sb_norm` for Hebrew |

Database guards (migration 0008): an entry never moves or changes author; its text changes only
together with a new `entry_versions` row; `entry_versions` is append-only (a workspace delete still
cascades); an agent-written row can never sit in About me; web or imported text must be kind
`external`. Each workspace gets About me, a default Inbox and a default Notebook at its first
sign-in (and by migration for older ones).

`audit_log.workspace_id` has no foreign key, so audit rows outlive a deleted workspace. A
database trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log`.

## 6. Trust rules

Built for the memory core (step 1), on the server and with tests for the allowed and refused case:

| Who | Writes into | Lands as | Can also |
|---|---|---|---|
| An agent | an Inbox only (the default one, or one named) | `proposed`; a summary is required | read `proposed` and `approved` entries |
| A person (owner or editor) | any memory they can see | `approved`; a fallback summary if none is sent | approve, reject, write a new version |
| The owner, in person | About me | `approved` | |
| A viewer | nothing | | read |

On top of the table:

- About me is the owner's alone: other members of the workspace never see it.
- Nothing is edited in place. A person's change is a new version; the old ones stay readable.
- Only a person approves, rejects or revises, or changes a kind (hard rule 3, D22).
- Web-sourced text, and text that reads like instructions to an agent ("ignore previous",
  tool-call syntax, imperative orders to the reader), lands as `quarantined`. Agents never read
  quarantined or rejected entries; a person releases one by approving it.
- Every write is scanned for secrets (API keys, private keys, tokens, `.env` lines) in the title,
  body, summary, questions and refs. A hit rejects the write.
- Inbox entries fade from agents' search after 30 days; a person still finds them.

## 7. How agents use it

**Before work**, the agent claims a task, and `claim_task` returns a `context` packet with it
(thin step 2). The packet is built from the task's title and body, budgeted to 6,000 characters:

1. About me: approved entries of the person's About me (only the workspace owner gets them).
2. Rules in force: approved entries with topic `rule`, outside About me.
3. Relevant to this task: up to 4 entries found by word search on the task text, approved or
   proposed (labelled "proposed, unverified"); never quarantined, rejected or faded ones.
4. Not known: what the brain could not find, for example that nothing matched, or that a
   decision shown is only proposed.

The text rendering sits between `<sky-brain-context>` and `</sky-brain-context>`. Each entry is
one line of quoted data with its topic or kind, trust, author, source, date and id; newlines and
fence tags inside stored text are flattened, so stored text cannot leave the fence. When the
budget runs out, whole entries are dropped from Relevant first, then Rules. The agent uses `get`
with an id for the full text. Open questions and decisions in force as their own sections come
later (step 4).

**During work**, it calls `ask` to post a question. It can carry on, or check back later.

**After work**, `report_task` with outcome `done` may carry up to 3 `lessons` (kind, title,
body, summary). Each is captured into the default Inbox of the task's workspace with topic
`lesson` and a ref `task:<id>`, in the same transaction as the report: an agent's lessons are
proposed until the person approves them, and a lesson that is refused (a secret, no summary)
refuses the whole report. A repeated `done` adds no lessons. Other things it learned go in with
`capture`.

## 8. MCP tools and REST API (Layer 1)

The memory tools are built (step 1). The `context` packet on `claim_task` and lessons on
`report_task` are built (thin step 2); the Digest is not yet.

| MCP tool | REST | Does |
|---|---|---|
| `capture` | `POST /api/v1/entries` | save into an Inbox (or a named memory, for people) with kind, title, body, summary, questions, refs |
| `search` | `GET /api/v1/entries?q=` | word search, any word may match, ranked; returns summaries, not bodies |
| `get` | `GET /api/v1/entries/:id` | one entry with its body, every version and the person's comments |
| `list_memories` | `GET /api/v1/memories` | About me, Notebooks, Inboxes |

People only: `POST /api/v1/memories` (a new Inbox or Notebook), `POST /api/v1/entries/:id/versions`,
`/approve` and `/reject`. Run tokens have no verb for these routes, so a device cannot reach them
yet; MCP clients can.

`/mcp` serves MCP over streamable HTTP (`createMcpHandler`, `legacy: "stateless"`, so 2025-era
clients work too); today it has `whoami`, the connection check, and the task board tools below. An MCP caller is the
agent `mcp/<client host>` acting for the token's subject, across all of that person's workspaces.

**Agent profiles (D25 part 1, D26).** A person names the roles their agents play (Product owner,
Doer, Reviewer, Librarian, or any other) on the web page's Agents tab, and picks which role each
connected app acts as. The binding is stored on the server (`agent_profiles`, `agent_bindings`,
keyed by the person and the token's `azp`), so an agent never chooses its own role (hard rule 2).
On every `/mcp` call the server looks the binding up; a bound app becomes the agent
`mcp/<client host>/<slug>` with a `profile` on its actor, so audit rows, task events, claims and
entry authors name the role with no other schema change. An unbound app is the Guest agent, as
before. `whoami` returns `agent: { agent_id, profile }`. Changing a binding takes effect at the
next call; a task claimed under the old role must be reported under it, so it waits for its lease.
Profiles give no extra rights yet: scopes, skills and triggers are D25 parts 2 to 4
([docs/vision/AGENTS.md](vision/AGENTS.md)).

People only, under `/api/v1/agents`: `GET /` (profiles and connected apps), `POST /profiles`
(`slug`, `display_name`, `kind` worker or steward), `DELETE /profiles/:id` (its bindings go with
it) and `POST /bind` (`client_id`, `profile_id` or null). A person sees and binds only their own
profiles and only apps they allowed on the consent page.

The REST API under `/api/v1` mirrors these. It adds routes only people can call: approve,
reject, release, answer, invite, export and delete.

### Approval requests (D31, step 1)

An agent asks the person to approve exact draft goals or proposed entries, and gets a link to
sky-brain's own page. The person decides there, signed in; no tool approves, and chat text or a
tool argument is never an approval (hard rule 3). Design: [vision/HATS-AND-APPROVAL.md](vision/HATS-AND-APPROVAL.md).

| MCP tool | REST | Who |
|---|---|---|
| `request_approval` | `POST /api/v1/approvals` (`items`: up to 20 of `{kind: goal or entry, id}`, `reason`) | writers; run tokens refused |
| `approval_status` | `GET /api/v1/approvals/:id` | members of that brain |
| | `GET /api/v1/approvals` | pending requests in the person's brains |
| | `POST /api/v1/approvals/:id/approve`, `/reject` | people only, owners and editors |

- Table `approval_requests` (migration 0010): the items with a **pin** each (a goal's status,
  last change and its tasks' last change; an entry's trust and version), status `pending`,
  `approved`, `rejected`, `expired` or `superseded`, who decided and when.
- **What the person saw is what is applied.** Approving checks every pin first; if anything
  changed, the request becomes `superseded` and nothing is applied. Then, in one transaction, each
  goal goes through `approveGoal` and each entry through `setTrustInTx`, so every rule of the
  person's own buttons (quarantine, role, About me owner only) holds. Rejecting applies nothing:
  the items stay drafts and proposals.
- A request expires after 60 minutes (410 `expired`), is decided once (409 after), and one agent
  may have at most 10 open per person (429 `too_many_open`). Every step writes an audit row.
- Web: an **Approvals** tab lists what is waiting (refreshed every 20 seconds), and `/a/<id>` shows
  one request with Approve and Reject. A signed-out visit to `/a/<id>` returns there after
  sign-in.
- **Web push alerts (D36).** On the Approvals tab, "Tell me when an agent asks" turns alerts on
  for that browser (permission asked only after the click; on iPhone after Add to Home Screen,
  with `manifest.webmanifest`). Routes, people only: `GET /api/v1/push/key`,
  `POST /api/v1/push/subscribe` (the browser's `PushSubscription`, `https` endpoint only) and
  `POST /api/v1/push/unsubscribe` (own rows only). Table `push_subscriptions` (migration 0012).
  When an **agent** creates a request, every subscription of its person gets a push with no item
  text ("An agent is waiting for your approval.") and the `/a/<id>` path; the send is awaited
  (4-second timeout) and never fails the request; 404 and 410 answers delete the subscription.
  The service worker (`apps/web/public/sw.js`) shows Approve and Review buttons; Approve posts
  with the session cookie like the page's button, and opens the page if that fails. Push is on
  only when `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are set. Email comes later.

### The task board (D20)

| MCP tool | Does |
|---|---|
| `list_projects` | the projects of the person's workspaces |
| `list_goals` / `get_goal` | a project's goals with task counts; one goal with its tasks |
| `propose_goal` | a draft goal (only a person approves it) |
| `add_tasks` | tasks with `depends_on` and `files`; a task added to an approved goal waits for approval |
| `next_task` | the next task the person may take now in a project, or null |
| `claim_task` / `renew_task` / `release_task` | a 10-minute lease and its `claim_seq`; `claim_task` also returns the `context` packet (§7) |
| `report_task` | `done` with proof and up to 3 proposed `lessons`, or `failed` with a reason |

The MCP tools call the REST routers in process with the verified MCP actor, so both doors make
the same checks. REST routes:

| Route | Who |
|---|---|
| `GET /api/v1/me` | anyone signed in (the web page) |
| `GET /api/v1/projects`, `POST /api/v1/projects` | list: members; create: people who are owners or editors |
| `POST /api/v1/goals`, `GET /api/v1/goals?project_id=`, `GET /api/v1/goals/:id` | writers create drafts; members read |
| `POST /api/v1/goals/:id/tasks` | writers |
| `POST /api/v1/goals/:id/documents` | writers (people and agents); the entry must be one the caller may read, in the goal's workspace |
| `DELETE /api/v1/goals/:id/documents/:entryId` | people only |
| `POST /api/v1/goals/:id/approve`, `/cancel`, `/release` | people only |
| `GET /api/v1/tasks/ready`, `GET /api/v1/tasks/:id` | members (a run token: its project) |
| `POST /api/v1/tasks/:id/claim`, `/renew`, `/release`, `/done`, `/fail` | writers; `renew` to `fail` need the holder's `claim_seq` |
| `POST /api/v1/tasks/:id/release-text` | people only |

A task is ready when its goal is approved by the caller's own person and not held, its text is
the text that was approved, every dependency is done, and it is pending (or its lease ran out).
A claim also waits while another live lease in the project holds an overlapping file. A browser
session's writes must send `application/json` (415 `json_required` otherwise), so a cross-site
form cannot approve anything. The web page at `/` is built for fast review. "Today" is a digest
of up to ten goals waiting for the person (drafts and held goals, longest-waiting first) with a
one-line summary of the last day; "All goals" is a card board with four columns (Needs you,
Running, Waiting to start, Done); hovering a card shows its summary and opening one shows its
tasks in a dialog. Approve and reject (reject
cancels the goal) work on one goal or a selection; the page sends one request per goal, so bulk
review adds no new route and each goal keeps its own checks. Held goals are never approved in
bulk: the person reads and releases them one by one.

A goal can carry up to 20 documents: entries (markdown with the writer's summary) linked to it
in `goal_documents`. An agent writes one with `capture` and links it with the `attach_document`
MCP tool; `GET /goals` and `GET /goals/:id` return each goal's documents as summaries, never
bodies, and agents see only proposed or approved ones. On the board, hovering a card shows the
summaries; opening a document goes to its own page, `/docs/<entry id>` (D34). The page reads
the markdown with a small renderer that never inserts HTML, and edits it in four views (Read,
Sections, Source, Split) with a formatting bar, section moves, splits and merges, and undo; Save
writes a new version through `POST /entries/:id/versions`. A held document is shown as plain
text. People comment on a document (`entry_comments`): a note in a color on a selected passage
or on the whole text, resolved, reopened or deleted by people with a writer role
(`POST /entries/:id/comments`, `POST /entries/:id/comments/:commentId/resolve`,
`DELETE /entries/:id/comments/:commentId`, people only; secret-scanned, 2,000 characters, 200 per
entry). Whoever may read the entry reads its comments (`GET /entries/:id/comments`, and in
`GET /entries/:id`), so the model sees them with `get`. PDFs are not stored yet.

## 9. Auth

Better Auth runs inside the server.

- **People** sign in with Perminister's OpenID Connect flow (D24). The app client's registration
  policy is "Public registration", so anyone with a Perminister account and a verified email may
  enter (`mayEnter`, D29); no organization or invitation is needed. Each person gets their own
  private workspace, as `owner`, with About me, an Inbox and a Notebook, at their first sign-in.
  A sky-brain invite adds such a person to another owner's workspace and is accepted at their
  next sign-in. An account without a verified email sees "No access".
  A session lasts 7 days from sign-in and is never extended by use, so access taken away in
  Perminister ends at the latest when the session runs out.
- **MCP clients** (claude.ai, Claude Code, Codex): Better Auth's `mcp()` plugin makes the server
  an OAuth 2.1 authorization server. claude.ai registers with a Client ID Metadata Document
  (`cimd()` plugin), uses PKCE, and returns to `https://claude.ai/api/mcp/auth_callback`. The
  login page is the same Perminister sign-in. Access tokens are JWTs whose audience is
  `https://<host>/mcp`, checked against the server's own keys. Dynamic client registration
  stays off unless a client we need cannot use CIMD (checked in ticket T0). The scopes
  `brain:read` and `brain:write` are advertised but not required on `/mcp` until write tools land.
- **Headless agents**: a person logs a machine in once, with the OAuth device flow:
  `POST /api/device/code`, the person approves the user code (`POST /api/v1/devices/approve`),
  and the machine polls `POST /api/device/token` for its device token (`sbd_`). Pathly then
  calls `POST /api/v1/run-tokens` with that device token and gets a run token (`sbr_`) that
  lasts at most 30 minutes and is bound to one workspace, one project, one role and a list of
  verbs: `read`, `plan` (create goals and tasks), `claim` (claim, renew, release) and `report`
  (done, fail). A device token may only mint. `GET /api/v1/devices` lists a person's devices and
  `POST /api/v1/devices/:id/revoke` ends one and every run token it minted.
- **Fallback**: if Better Auth's MCP support fails the T0 test, WorkOS AuthKit becomes the OAuth
  server and the rest of the design stays the same.
- **Dev header** (D15): sign-in is the real path; `/api/v1` knows the caller from the session
  cookie. The `X-Dev-Actor` header stays for `pnpm dev` only, when `NODE_ENV=development` and on
  127.0.0.1; otherwise the header is refused with 401, even next to a valid session.

## 10. Security bar

All of this is in place before real project data goes in:

- HTTPS only. Tokens only in the `Authorization` header. CORS limited to the app's own origin.
- Identity from the token or session only, never from the request body.
- Every query filtered by workspace membership, with tests proving one workspace cannot read
  another.
- The trust rules in section 6 enforced on the server, with tests.
- Secret scan, size caps and per-token rate limits on writes.
- Quarantine for web-sourced and instruction-like text.
- Fenced rendering in `context`.
- Append-only audit log.
- Export and hard delete for a whole workspace.
- No endpoint that can start, stop or steer anything outside sky-brain.

## 11. Tech stack

- **Language:** TypeScript everywhere, Node 22 LTS, pnpm workspaces.
- **Server:** Express 5, the MCP TypeScript SDK (streamable HTTP), Better Auth (`mcp`, `cimd`,
  `jwt`, device authorization, generic OAuth for Perminister sign-in), Drizzle ORM with drizzle-kit migrations, zod.
- **Database:** Postgres on Nanogres (D16). Full-text search with `tsvector` now. pgvector
  0.8.1 is enabled on the database (`halfvec`, HNSW indexes) and not used yet.
- **Web:** React and Vite, TanStack Query. Components from Pathly Studio are copied in where
  they fit, not imported.
- **Tests:** Vitest. PGlite (Postgres running inside the test process) so tests need no Docker.
  One smoke test against a real Postgres in CI.
- **Layer 2 additions:** Yjs, BlockNote core packages (MPL-2.0; avoid `@blocknote/xl-*`, which
  are GPL-3.0 or commercial), Hocuspocus.

### Layout

```
apps/server      API, MCP, auth; serves the web build
apps/web         React app
packages/shared  entry types and zod schemas, used by the server, the web app and Pathly
docs/            plan, roadmap, decisions, tickets
vercel.json      Vercel project: build, function, rewrites (D16)
api/index.mjs    the Vercel function: the Express app
```

## 12. Deploy on Vercel

- `vercel.json` sets everything: install, build (web, server bundle, migrations), the
  function and the rewrites (D16). Setup is Add New → Project → import this repo, with the
  default settings.
- Environment variables, set in the Vercel project by hand:
  - `DATABASE_URL`: Nanogres app role (PgBouncer port 6432).
  - `MIGRATION_DATABASE_URL`: Nanogres migrate role (port 6433). Used only by the build.
  - `MIGRATION_DATABASE_ROLE`: the owner role from the migrate role's Nanogres snippet; the
    build runs `SET ROLE` to it before the migrations.
  - The auth settings from login-mcp: `PUBLIC_URL`, `BETTER_AUTH_SECRET`,
    `PERMINISTER_BASE_URL`, `PERMINISTER_APP_CLIENT_ID` and `PERMINISTER_APP_CLIENT_SECRET` (the
    names Perminister hands out; the older `PERMINISTER_CLIENT_ID` and `PERMINISTER_CLIENT_SECRET`
    are still read as a fallback). Values and steps are in [CONNECT.md](CONNECT.md).
- Production deploys from `main`. Other branches get preview URLs; previews never migrate.
- Health check at `/healthz`.
- Backups: test a restore before any real use.

## 13. Pathly integration

This work lives in `pathly-adapters`, not in this repo.

- **Settings:** `PATHLY_BRAIN_URL`, plus a device credential from a one-time `pathly brain login`.
- **Project id:** the normalized git remote.
- **Write:** the posting fragment copies decision, question and lesson rows to sky-brain. One
  way only at first.
- **Read:** `retrieve_board_context` adds the sky-brain `context` packet (rules and decisions in
  force) to every prompt.
- **Outbox:** if sky-brain cannot be reached, writes go to `pathly/outbox/<run_id>.jsonl` and are
  sent later. They are never dropped silently.
- **Tasks (D20):** a project linked to sky-brain (`.pathly/brain-link.json`) uses the
  cloud board as its only task store: Pathly pulls ready tasks with a run token, claims them, renews
  the lease while it works, and reports done with proof or failed. Unlinked projects keep
  Pathly's local board unchanged. The client that does this is a separate plan in
  pathly-adapters (plans/cloud-task-board/map.md § Follow-up: Pathly client).
- **Unchanged:** FSM state, events and telemetry stay in Pathly.
- **After the two-week test passes:** sky-brain becomes the only store for those entry kinds,
  and Pathly stops keeping them locally.

## 14. Risks

1. **Size.** This is a big product. Each layer must be in daily use before the next starts,
   and each layer must retire something in Pathly or feature-flow.
2. **Poisoned memory.** One bad entry reaches every agent that reads it. Trust rules, quarantine,
   fenced rendering and human-only rules are the answer; they are in Layer 1, not later.
3. **A brain nobody reads.** A connector being available does not make an agent call it. Reads
   are forced: Pathly fragments inject `context` into every run; a Claude Code SessionStart hook
   calls it; claude.ai project instructions say "check sky-brain first".
4. **Auth churn.** Better Auth's MCP support is new and parts of its docs are in beta. Ticket T0
   proves it end to end before anything is built on it. WorkOS AuthKit is the fallback.
5. **The name.** Skypoint sells "skyBrain", an AI memory product for healthcare. That is fine for
   our own and open-source use. Pick a distinct product name before any commercial launch.
