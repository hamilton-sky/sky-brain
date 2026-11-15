# sky-brain: roadmap

Five layers. Each one is usable on its own.

**Two rules for moving on:**

1. A layer must be in daily use before the next one starts.
2. Each layer retires something in Pathly or feature-flow, so the total size goes down, not up.

Times are rough estimates for one person building with Claude.

**Where it stands (15 Nov 2026).** The goal, what is built and what comes next are in the
[README](../README.md#the-contract), which is the source of truth. In short: Layer 1 is partly
built (sign-in, the MCP connector and the deploy are live; the entries API and its MCP tools are
not), and Layer 1b (task board v1) is live. The rest of Layer 1 is replaced by the memory build
order (D21, [vision/BUILD-PLAN.md](vision/BUILD-PLAN.md)). Layers 2 to 5 wait until that order
reaches its last step, and each needs its own decision then. They are kept below as written.

| Layer | What you get | Rough time |
|---|---|---|
| 1. Brain core | Perminister sign-in, projects, typed entries, MCP connector, a simple web page, live on Vercel | Partly built |
| 1b. Task board | Goals and a task DAG in the cloud: agents propose, you approve on the web page, devices and MCP clients pull and claim | Built, live |
| Two-week test | Use it every day; decide go or stop | 2 weeks |
| 2. Pages | Block editor, live co-editing, comments, history; agents read and propose edits | 3–4 weeks |
| 3. Views and templates | Table, kanban and calendar views; saved views; templates | 2–3 weeks |
| 4. Sharing | Teams, guests, per-page permissions | 2–3 weeks |
| 5. Reach | Phone app polish, notifications, web clipper, GitHub and Slack | 1–2 weeks |

---

## Layer 1: Brain core

**Goal:** one brain that you, Claude Code, Codex, claude.ai and Pathly all read and write.

**Ships** (✅ built, 🟡 partly built, ⬜ not built):
- 🟡 Perminister sign-in (D17), one workspace per person and projects are built. Pending invites
  are accepted at sign-in, but no route sends one yet. Features exist in the schema only.
- 🟡 The `entries` table with full-text search, trust rules, secret scan and an audit log. The
  table, the guards and the audit log are built; the trust rules have no write path yet.
- ⬜ The REST API and six MCP tools: `context`, `search`, `get`, `post`, `supersede`, `ask`.
  BUILD-PLAN step 2 proposes `capture`, `search`, `get` and `context_for_task` instead.
- ✅ OAuth for the claude.ai connector (D18).
- 🟡 Device login with short-lived run tokens for headless agents: the API works; the browser page
  to approve a device code is not built.
- 🟡 A web page: the board page is built; browsing and approving entries is not.
- ✅ Deployed on Vercel with Postgres on Nanogres (D16).
- ⬜ Pathly connected: its fragments copy decisions, questions and lessons up, and every run
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

**Status:** built and live (task board v1, 11 Nov 2026). The Pathly client is still to do.

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
  pgvector 0.8.1 is already enabled on Nanogres (15 Nov 2026), and BUILD-PLAN step 3 proposes
  hybrid search as part of the memory.
- A verifier that re-checks decisions that point at code against the latest commit.
- Merging near-duplicate entries, ported from Pathly's consolidation pass.
- Notion export, for people who live in Notion.
- Offline mode, and native phone apps.
