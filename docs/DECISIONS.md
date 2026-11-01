# sky-brain: decision log

Each decision records what was chosen, why, and what was rejected. To change a decision, add a
new one that supersedes it; do not rewrite the old one.

The reasoning comes from a four-lens review on 2026-11-01: a platform architect, a security
red team, a product strategist and a local-first contrarian. Code findings were checked
against `pathly-adapters`.

---

### D1. A place for context, not for execution
**Chosen:** sky-brain stores and serves knowledge. It never runs agents, holds code or sends
commands.
**Why:**
- Agents need the code, and the board doesn't.
- If the cloud could tell a laptop what to run, one breach would mean commands running on every
  connected machine. Pathly's headless agents also run with permission prompts skipped.
**Rejected:** a cloud runner; Studio on a laptop listening to a cloud spawn stream.

### D2. Our own typed store, not Notion or a memory library
**Chosen:** our own entries table with kinds, statuses, supersede and expiry.
**Why:**
- Notion's API allows about 3 requests a second, and its edit webhooks arrive about a minute
  late. It has no supersede or provenance, and agent runs cost credits.
- mem0, Zep/Graphiti and Letta are built for one agent's memory. None of them settles
  conflicts between agents.
**Rejected:** Notion as the store; mem0, Zep/Graphiti or Letta as the store; forking AFFiNE or
AppFlowy.

### D3. Knowledge moves to the cloud; run data stays in Pathly
**Chosen:**
- **sky-brain holds:** rules, decisions, claims, questions and answers, artifacts, lessons and
  notes.
- **Pathly keeps:** tasks, task claims, FSM state, events and telemetry.
**Why:**
- Task claims need one lock in one place, and gates need the code.
- Splitting by kind avoids rewriting the 43 Pathly modules that read the board: only the
  fragments and `retrieve_board_context` change.
**Rejected:**
- Moving all of Pathly's board to the cloud: weeks of rewrite, and the gates can't follow it.
- Multi-writer sync (Turso Sync, CRDTs, ElectricSQL): it can't give one task to exactly one
  worker.

### D4. TypeScript for the whole stack
**Chosen:** Node and TypeScript for the server, and React for the web.
**Why:**
- Yjs, Hocuspocus and BlockNote, needed for Layer 2, are JavaScript.
- Pathly Studio's components are React and TypeScript and can be reused.
- One language across server, web and shared types.
**Rejected:** a Python server with FastMCP. It is easier for Google OAuth, but it would split the
stack in two once live editing arrives.

### D5. Render Postgres, not SQLite on a disk
**Chosen:** Render Postgres.
**Why:**
- This is new code for several users, so the reason to keep Pathly's SQLite code does not apply.
- A disk on Render rules out zero-downtime deploys and running more than one instance, and its
  automatic snapshot is daily.
- Postgres gives full-text search now and pgvector later.
**Sources:** [Render disks](https://render.com/docs/disks),
[Render Postgres extensions](https://render.com/docs/postgresql-extensions).
**Rejected:** SQLite with Litestream on a VM (right for lifting Pathly as it is, not for a new
multi-user service); Turso; Cloudflare D1.

### D6. One origin for API, MCP, auth and web
**Chosen:** one Render web service serves everything.
**Why:** no cross-site cookies, no wide CORS, one deploy, one health check. Layer 2's websocket
route fits on the same service.

### D7. Better Auth for sign-in and the MCP OAuth server; WorkOS AuthKit as fallback
**Chosen:**
- Better Auth with Google sign-in, the `mcp()`, `cimd()` and `jwt()` plugins, and device
  authorization for CLIs.
- It is proven end to end in ticket T0 before anything is built on it.
**Why:**
- claude.ai connectors need an OAuth server with PKCE and either dynamic client registration or
  a Client ID Metadata Document.
- Google supports neither, so our server must be the OAuth server and send people on to Google
  to sign in.
- Better Auth does this, self-hosted, with CIMD and JWT tokens checked against our own keys.
**Risk:** its MCP docs are partly in beta.
**Sources:** [Claude connector auth](https://www.claude.com/docs/connectors/building/authentication),
[Better Auth MCP plugin](https://better-auth.com/docs/plugins/mcp).
**Rejected for now:** WorkOS AuthKit, which is hosted and mature but a vendor dependency. It
is the fallback if T0 fails.

### D8. Identity comes from the token only; agents get short-lived run tokens
**Chosen:**
- People get sessions.
- MCP clients get JWTs.
- Headless agents get run tokens that last at most 30 minutes, minted for a logged-in device and
  bound to a workspace, project, role and verbs.
**Why:** Pathly today trusts any local caller and takes the author from the request body. Its
run tokens have no time limit, and the spawn stream sends them in the clear. None of that
survives the internet.

### D9. Trust tiers, quarantine and fenced context are in Layer 1
**Chosen:**
- Agents write `proposed`.
- Only people write rules or approve.
- Web-sourced and instruction-like text is quarantined.
- `context` renders entries as quoted data.
**Why:**
- A shared brain is read into every agent prompt, so one poisoned entry spreads everywhere.
- Pathly today puts board text into prompts unfenced, under "do not override".

### D10. A new repo, separate from pathly-adapters
**Chosen:** `hamilton-sky/sky-brain`.
**Why:**
- sky-brain serves Claude, Codex, claude.ai and feature-flow, not only Pathly.
- It is a public service, while pathly-adapters is built around "a local caller is trusted".
- Render redeploys on every push, so sharing a repo with Studio would redeploy the brain on
  unrelated commits.
- The Pathly client changes stay in pathly-adapters.

### D11. Live co-editing with Yjs, for documents only
**Chosen:** Yjs for page content (Layer 2). Entries stay in Postgres with one authority.
**Why:**
- Automatic merging is right for text that several people edit.
- It is wrong for decisions and claims, which need one place that decides.
**Licence note:** use BlockNote's core packages (MPL-2.0). Avoid `@blocknote/xl-*`, which are
GPL-3.0 or commercial.

### D12. The name is sky-brain, for now
**Chosen:** `sky-brain`.
**Why:**
- It ties to `hamilton-sky`: "sky" fits a cloud brain, and "brain" says what it is.
- `sky-brain` and `skybrain` are free on npm and PyPI.
**Known clash:** Skypoint sells "skyBrain", an AI memory product for healthcare that works with
Claude over MCP ([skypoint.ai](https://skypoint.ai/products/skybrain)). That is fine for our
own and open-source use. Pick a distinct product name before any commercial launch.
