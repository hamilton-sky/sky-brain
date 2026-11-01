# sky-brain: the plan

_Written 2026-11-01. This is a living document: when the code changes what it describes,
update it in the same commit._

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
| You and your team | Browser, phone | Sign in with Google |
| claude.ai (web, desktop, phone app) | Anthropic's servers | Custom connector, OAuth 2.1 |
| Claude Code, Codex CLI (interactive) | Laptop or cloud session | MCP over HTTPS, OAuth or device token |
| Headless agents (Pathly runs, `claude -p`, `codex exec`) | Wherever the code is | Short-lived run token |
| Pathly | Laptop | REST, through its fragments |

## 3. Architecture

```
 Browser / phone ───── Google sign-in (cookie) ───────┐
 claude.ai connector ─ OAuth 2.1 (CIMD + PKCE) ───────┤
 Claude Code / Codex ─ MCP + OAuth or device token ───┼──▶  sky-brain server (one Render web service)
 Pathly runs ───────── REST + run token ──────────────┘       ├─ /api/v1     REST API
                                                              ├─ /mcp        MCP (streamable HTTP)
                                                              ├─ /api/auth   Better Auth (Google, OAuth server)
                                                              ├─ /           web app (React build)
                                                              └─▶ Render Postgres
```

One Node service serves the API, the MCP endpoint, the auth routes and the web app from one
origin. One origin means no cross-site cookies and no wide CORS. Layer 2 adds a websocket
route for live editing to the same service.

**What stays out of sky-brain:** running agents, code checkouts, build and test gates,
Pathly's task list and task claims, FSM state, run events and cost telemetry. Those belong to
Pathly, next to the code. Task claims need one lock in one place, and gates need the code;
both are reasons they stay local.

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
| `entries` | see below |
| `audit_log` | seq, workspace_id, actor, action, target_id, at, details. Append-only. |
| `devices` | id, user_id, name, created_at, last_seen_at, revoked_at |

### `entries`

| Column | Meaning |
|---|---|
| `id` | uuid |
| `seq` | monotonic number, used as a "what changed since" cursor |
| `workspace_id`, `project_id`, `feature_id` | the scope; a null project or feature means a wider scope |
| `kind` | `rule`, `decision`, `claim`, `question`, `answer`, `artifact`, `lesson`, `note` |
| `status` | `proposed`, `approved`, `open`, `answered`, `superseded`, `expired`, `rejected`, `quarantined` |
| `title` | one line, up to 200 characters |
| `body` | markdown, up to 16 KB |
| `author_kind` | `human` or `agent` |
| `author` | a user id, or an agent identity such as `claude-code/builder` |
| `on_behalf_of` | the person whose session or device wrote it |
| `source` | `human`, `agent`, `code`, `web`, `import` |
| `refs` | links: URLs, `path@commit`, PR links, other entry ids |
| `reply_to` | for an answer: the question it answers |
| `supersedes` | the entry this one replaces |
| `confidence` | optional, 0 to 1, from the writer |
| `expires_at` | claims get a default expiry; rules and approved decisions do not |
| `created_at`, `updated_at` | |
| `search` | generated full-text vector over title and body, with a GIN index |

Text is never edited after approval. A change is a new entry that supersedes the old one.
Every status change goes through the API and lands in the audit log.

## 6. Trust rules

| Kind | People write it as | Agents write it as | Who can move it on |
|---|---|---|---|
| `rule` | `approved` | not allowed | people only |
| `decision` | `approved` | `proposed` | people approve or reject |
| `claim` | `proposed` | `proposed` | people promote it to a decision, or it expires |
| `question` | `open` | `open` | answered by a person; by an agent only if the asker allows it |
| `answer` | allowed | only for questions an agent asked | |
| `artifact`, `lesson`, `note` | `approved` | `proposed` | people approve or reject |

On top of the table:

- Agents never write to the workspace scope, and never approve, reject, release or delete.
- If an agent supersedes an approved entry, the new entry is `proposed`. The old one stays in
  force until a person approves the new one.
- Web-sourced text, and text that reads like instructions to an agent ("ignore previous",
  tool-call syntax, imperative orders to the reader), lands as `quarantined`. Quarantined
  entries are never served in context until a person releases them.
- Every write is scanned for secrets (API keys, private keys, tokens, `.env` lines). A hit
  rejects the write.
- Claims expire after 30 days unless a person confirms them. The workspace can change this.

## 7. How agents use it

**Before work**, the agent calls `context` with its scope and a short task description. It
gets back one packet, budgeted to about 6 KB:

1. Rules in force (workspace, then project, then feature).
2. Decisions in force (approved, not superseded, not expired).
3. Open questions in scope.
4. Relevant entries found by full-text search on the task text: claims (marked unverified),
   artifacts and lessons.

Each entry is rendered as quoted data with its kind, status, author, source and date. Only
approved rules sit in the rules section. Everything else is labelled as information, not
instructions.

**During work**, it calls `ask` to post a question. It can carry on, or check back later.

**After work**, it calls `post` for what it learned (claims, a proposed decision, a lesson, an
artifact summary with links) and `supersede` when it found something newer than an old entry.

## 8. MCP tools and REST API (Layer 1)

| MCP tool | Does |
|---|---|
| `context` | the ranked, fenced packet for a scope and a task |
| `search` | full-text search with filters: scope, kind, status, since |
| `get` | one entry, with its supersede chain and answers |
| `post` | create an entry: kind, scope, title, body, refs |
| `supersede` | propose a replacement for an entry |
| `ask` | post a question; returns its id and any answer so far |

The REST API under `/api/v1` mirrors these. It adds routes only people can call: approve,
reject, release, answer, invite, export and delete.

## 9. Auth

Better Auth runs inside the server.

- **People** sign in with Google. Only invited emails get into a workspace. Anyone else sees
  "no access". The first owner is set by the `BOOTSTRAP_OWNER_EMAIL` setting.
- **MCP clients** (claude.ai, Claude Code, Codex): Better Auth's `mcp()` plugin makes the server
  an OAuth 2.1 authorization server. claude.ai registers with a Client ID Metadata Document
  (`cimd()` plugin), uses PKCE, and returns to `https://claude.ai/api/mcp/auth_callback`. The
  login page is the same Google sign-in. Access tokens are JWTs whose audience is
  `https://<host>/mcp`, checked against the server's own keys. Dynamic client registration
  stays off unless a client we need cannot use CIMD (checked in ticket T0).
- **Headless agents**: a person logs a machine in once, with the OAuth device flow. Pathly then
  calls `POST /api/v1/run-tokens` with that device credential and gets a token that lasts at
  most 30 minutes and is bound to one workspace, one project, one role and a list of verbs.
- **Fallback**: if Better Auth's MCP support fails the T0 test, WorkOS AuthKit becomes the OAuth
  server and the rest of the design stays the same.

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
  `jwt`, device authorization, Google sign-in), Drizzle ORM with drizzle-kit migrations, zod.
- **Database:** Render Postgres. Full-text search with `tsvector` now; pgvector later (Render
  supports it).
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
render.yaml      Render Blueprint: web service + Postgres
```

## 12. Deploy on Render

- `render.yaml` Blueprint: one web service and one Render Postgres. Setup is New → Blueprint →
  pick this repo.
- Use a paid instance. Free instances sleep when idle, and the connector would time out
  waiting for the service to wake.
- Settings:
  - `DATABASE_URL` comes from the database.
  - `BETTER_AUTH_SECRET` is generated.
  - `PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `BOOTSTRAP_OWNER_EMAIL` are
    set by hand.
- Deploys on every push to `main`. Health check at `/healthz`. Migrations run in the pre-deploy
  command.
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
- **Unchanged:** tasks, claims, FSM state, events and telemetry stay in Pathly.
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
