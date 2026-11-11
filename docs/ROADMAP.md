# sky-brain: roadmap

Five layers. Each one is usable on its own.

**Two rules for moving on:**

1. A layer must be in daily use before the next one starts.
2. Each layer retires something in Pathly or feature-flow, so the total size goes down, not up.

Times are rough estimates for one person building with Claude.

| Layer | What you get | Rough time |
|---|---|---|
| 1. Brain core | Google sign-in, projects, typed entries, MCP connector, a simple web page, live on Render | 2–3 weeks |
| 1b. Task board | Goals and a task DAG in the cloud: agents propose, you approve on the web page, devices and MCP clients pull and claim | 1–2 weeks |
| Two-week test | Use it every day; decide go or stop | 2 weeks |
| 2. Pages | Block editor, live co-editing, comments, history; agents read and propose edits | 3–4 weeks |
| 3. Views and templates | Table, kanban and calendar views; saved views; templates | 2–3 weeks |
| 4. Sharing | Teams, guests, per-page permissions | 2–3 weeks |
| 5. Reach | Phone app polish, notifications, web clipper, GitHub and Slack | 1–2 weeks |

---

## Layer 1: Brain core

**Goal:** one brain that you, Claude Code, Codex, claude.ai and Pathly all read and write.

**Ships:**
- Google sign-in, invites, one workspace, projects and features.
- The `entries` table with full-text search, trust rules, secret scan and an audit log.
- The REST API and six MCP tools: `context`, `search`, `get`, `post`, `supersede`, `ask`.
- OAuth for the claude.ai connector, and device login with short-lived run tokens for headless
  agents.
- A web page: browse by scope, kind and status; answer questions; approve, reject, release,
  supersede.
- Deployed on Render from `render.yaml`.
- Pathly connected: its fragments copy decisions, questions and lessons up, and every run
  pulls rules and decisions down.

**Done when:**
- You answer an agent's question from your phone.
- claude.ai, through the connector, reads a decision and posts a claim.
- Claude Code on a second machine reads that decision.
- A Pathly run's prompt contains the approved decisions for its project.
- A restore from backup works.

**Retires:** feature-flow's `decisions.md`; using `BOARD.json` exports to carry decisions
between machines.

Tickets: [layer-1/TICKETS.md](layer-1/TICKETS.md).

## Layer 1b: Task board

**Goal:** one board of goals and tasks that every machine and agent works from (D20).

**Ships:**
- Goals (draft, approved, cancelled) and a task DAG with dependencies and file lists, per project.
- Pull-only work: ready list, a 10-minute lease with a fencing number, renew, release, done with
  proof, failed with retries; a failed task's dependents are blocked.
- Device login and short-lived run tokens for Pathly; MCP board tools for claude.ai, the phone
  app and Claude Code.
- The web board page: projects, goals, tasks, and the person-only Approve.

**Done when:**
- An agent proposes a goal over MCP, you approve it from your phone, and a worker on another
  machine claims and finishes its first task.
- Two workers racing for one task: exactly one wins (tested on real Postgres).

**Retires:** Pathly's local task board for projects linked to sky-brain.

## The two-week test (between Layer 1 and Layer 2)

Use sky-brain every day on at least two machines, the phone and cloud sessions.

- **Go** if at least 30% of reads come from a different machine or tool than the one that
  wrote the entry, and at least 10 answers given from the phone unblocked work.
- **Go** also needs this: at least one goal a week is run from the cloud board.
- **Stop and rethink** if fewer than 15% of reads cross machines or tools, or if you catch
  yourself pasting decisions into `CLAUDE.md` instead.

The server logs every read with the reader's tool and device, so these numbers come from
data, not memory.

## Layer 2: Pages

**Goal:** long documents that people and agents write together, linked to the typed knowledge.

**Ships:**
- A page tree per workspace, project and feature.
- The BlockNote editor with live co-editing (Yjs, Hocuspocus over a websocket on the same
  service).
- Comments, ported from Pathly's notebook.
- Version history: snapshots, plus a diff view reused from Pathly's notebook.
- Markdown export.
- MCP tools for agents:
  - `page_read` returns a page or one section as markdown.
  - `page_propose` returns an edit as a diff that a person accepts or rejects piece by piece.
- **"Send to brain":** select a paragraph and post it as a rule, decision or claim, linked to
  that section.

**Done when:**
- Two people edit one page at the same time.
- An agent's proposed edit is accepted piece by piece.
- A decision links back to the paragraph it came from.

**Retires:** keeping shared plans as local-only markdown files in the Pathly notebook.

## Layer 3: Views and templates

**Goal:** see the brain the way you need it.

**Ships:**
- Table, kanban (by status) and calendar (by created or expiry date) views over entries.
- Filters and saved views.
- Page templates: plan, spec, decision record, retro.
- Entry forms with sensible defaults.

**Done when:**
- You run a week of planning from a saved kanban view.
- You start a new feature from a template.

**Retires:** Studio's Command Center board view for projects that use sky-brain.

## Layer 4: Sharing

**Goal:** more people, with the right access.

**Ships:**
- Teams.
- A `commenter` role.
- Guests invited by email to one project or one page.
- Per-page permissions.
- Isolation tests extended to pages and guests.

**Done when:** a guest sees exactly the page shared with them and nothing else, and a test
proves it.

## Layer 5: Reach

**Goal:** sky-brain wherever you are.

**Ships:**
- An installable phone app (PWA) with a phone-first layout.
- Push notifications for new questions.
- A web clipper browser extension. Clipped pages land as `quarantined` web entries with their
  source URL.
- GitHub: PR and commit links in `refs`, with previews.
- Slack alerts for new questions.
- Outgoing webhooks.

## Later, only when there is a real need

- Vector search with pgvector, when full-text search starts missing things in real use.
- A verifier that re-checks decisions that point at code against the latest commit.
- Merging near-duplicate entries, ported from Pathly's consolidation pass.
- Notion export, for people who live in Notion.
- Offline mode, and native phone apps.
