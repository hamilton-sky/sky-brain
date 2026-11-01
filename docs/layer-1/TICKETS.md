# Layer 1: tickets

Order matters. T0 goes first because login is the riskiest part: if it fails, the fallback
changes how T3 and T6 are built.

| # | Ticket | Depends on | Size |
|---|---|---|---|
| T0 | Auth spike: claude.ai connector login end to end | — | S |
| T1 | Monorepo scaffold, CI, `render.yaml` | — | S |
| T2 | Database schema and migrations | T1 | M |
| T3 | People: Google sign-in, workspace, invites | T0, T2 | M |
| T4 | Entries API with trust rules | T2, T3 | L |
| T5 | The `context` packet | T4 | M |
| T6 | MCP server | T0, T4, T5 | M |
| T7 | Device login and run tokens | T3, T4 | M |
| T8 | Web page v1 | T4 | M |
| T9 | Deploy, connect every client, read logging | T6, T7, T8 | S |
| T10 | Pathly client (in pathly-adapters) | T5, T7 | M |

---

### T0. Auth spike: claude.ai connector login end to end
**Goal:** prove that Better Auth (Google sign-in plus `mcp()`, `cimd()` and `jwt()`) works as
the OAuth server for a claude.ai custom connector before building on it.

**Scope:**
- A throwaway server with one MCP tool, `whoami`, that returns the signed-in email.
- Deployed to Render.
- Google OAuth client set up.

**Done when:**
- claude.ai adds the connector, sends you to Google, and `whoami` returns your email.
- The same works from the Claude phone app.
- Claude Code CLI connects to the same URL.
- Write down whether Codex CLI and Claude Code need dynamic client registration (DCR) or
  can use CIMD. Turn DCR on only if a client we need requires it.
- **If any of these fails and cannot be fixed in two days:** switch to WorkOS AuthKit, and
  record that as a new decision.

**Needs from you:** a Google OAuth client ID and secret, and a Render account connected to
GitHub.

### T1. Monorepo scaffold, CI, `render.yaml`
**Scope:**
- pnpm workspaces with `apps/server`, `apps/web` and `packages/shared`, all in strict
  TypeScript.
- ESLint and Prettier.
- Vitest.
- GitHub Actions running lint, typecheck and tests.
- `render.yaml` with the web service and Postgres.
- A `/healthz` route.
- The commands section of `CLAUDE.md` filled in.

**Done when:** CI is green on a fresh clone, and `pnpm dev` serves `/healthz` and an empty web
page from one port.

### T2. Database schema and migrations
**Scope:**
- Drizzle schema for `workspaces`, `members`, `invites`, `projects`, `features`, `entries`,
  `audit_log` and `devices`, matching PLAN.md section 5.
- A generated `tsvector` column on `entries` with a GIN index.
- A monotonic `seq` column.
- drizzle-kit migrations.
- A PGlite test harness.

**Done when:**
- Migrations apply to an empty PGlite database and to Render Postgres.
- A test inserts an entry and finds it by full-text search.

### T3. People: Google sign-in, workspace, invites
**Scope:**
- Better Auth with Google sign-in on the web.
- `BOOTSTRAP_OWNER_EMAIL` creates the first owner and workspace.
- Owners invite by email with a role.
- Uninvited sign-ins see "no access".

**Done when:** tests show the following.
- An invited email gets in with the right role.
- An uninvited email gets no workspace.
- A viewer cannot write.

### T4. Entries API with trust rules
**Scope:**
- `/api/v1` routes: post, get, search, supersede, ask.
- Human-only routes: approve, reject, release, answer, export, delete.
- The trust rules in PLAN.md section 6.
- Secret scan, a 16 KB body cap and a 200-character title cap.
- Per-token rate limits.
- Quarantine detection for instruction-like and web-sourced text.
- Default claim expiry.
- Audit log rows for every write and every status change.
- Membership filtering on every query.
- The project lookup by normalized git remote.

**Done when:** tests show the following.
- An agent cannot write a rule, approve, or write to the workspace scope.
- An agent's supersede of an approved decision stays `proposed`, and the old decision stays in
  force.
- A body containing an API key is rejected.
- "Ignore previous instructions…" lands as `quarantined`.
- Workspace A cannot read workspace B, in every route.
- The author always comes from the token, even when the body claims another author.

### T5. The `context` packet
**Scope:**
- Walk the scope chain: feature, then project, then workspace.
- Collect, in order: rules in force, decisions in force, open questions, and full-text matches
  on the task text.
- Budget the packet (default 6 KB) and rank the entries.
- Render it fenced: each entry is quoted data with kind, status, author, source and date. Only
  approved rules go in the rules section.
- Exclude quarantined, rejected, expired and superseded entries.
- Return it both as markdown and as JSON.

**Done when:** tests show the following.
- Superseded and quarantined entries never appear.
- The budget holds.
- A newline-and-header injection inside a body cannot forge a section.

### T6. MCP server
**Scope:**
- Streamable HTTP at `/mcp`.
- Six tools: `context`, `search`, `get`, `post`, `supersede`, `ask`.
- Each tool calls the same service layer as REST.
- Protected by the T0 auth, with the audience checked.
- Clear tool descriptions, so agents know to call `context` before work.

**Done when:** claude.ai and Claude Code can each run all six tools against a test workspace.

### T7. Device login and run tokens
**Scope:**
- OAuth device flow to log in a machine.
- A `devices` list in the web page, with revoke.
- `POST /api/v1/run-tokens` mints a token that:
  - lasts at most 30 minutes;
  - is bound to one workspace, one project, one role and a list of verbs.
- Revoking a device kills its run tokens.

**Done when:** tests show the following.
- An expired run token is refused.
- A token for project A cannot read project B.
- A token without the `post` verb cannot post.
- A revoked device's run tokens stop working.

### T8. Web page v1
**Scope:**
- Sign in.
- Pick a project and feature.
- List entries by kind and status, with search.
- Act on an entry: answer, approve, reject, release, supersede.
- A "since" cursor so the page refreshes when it comes into focus.
- A device list.
- A layout that works on a phone.

**Done when:** you can answer an open question and approve a proposed decision from your
phone.

### T9. Deploy, connect every client, read logging
**Scope:**
- Deploy with the Blueprint.
- Write a `docs/CONNECT.md` with exact steps for claude.ai, Claude Code CLI, Codex CLI and
  Claude Code cloud sessions (including the Allowed domains setting).
- Log every read with its tool and device, for the two-week test numbers.
- Test a backup restore.

**Done when:** every Layer 1 "done when" item in ROADMAP.md passes.

### T10. Pathly client (in pathly-adapters)
**Scope:**
- `pathly brain login`, using the device flow.
- `PATHLY_BRAIN_URL` setting.
- Project id from the normalized git remote.
- The posting fragment copies decision, question and lesson rows up, one way only.
- `retrieve_board_context` adds the sky-brain `context` packet.
- An outbox at `pathly/outbox/<run_id>.jsonl` for when sky-brain cannot be reached.

**Done when:**
- A Pathly run's prompt contains the project's approved decisions from sky-brain.
- An unreachable brain fills the outbox instead of losing writes.
