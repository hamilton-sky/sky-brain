# sky-brain

A digital brain for a person or an organization: one memory that you, your team and every AI
model you connect read and write, each by its role. Its design follows research on how human
memory encodes, keeps and retrieves ([docs/vision/HUMAN-MEMORY.md](docs/vision/HUMAN-MEMORY.md)).

## The contract

This section is the source of truth for where sky-brain stands. The other docs point here.

### Goal

sky-brain turns how a human brain remembers into a digital brain, built on findings from
cognitive psychology (memory layers, consolidation, cue-based retrieval, source of each memory).
It serves one person or a whole organization, for anything you want to remember and work on, not
only code. Each person has one brain, and an organization shares memories and boards between its
members. It holds a board of work (projects, goals, tasks) and memories (decisions,
facts, lessons, questions) with links it finds itself. Any model you connect (Claude, Codex, claude.ai) works from it over
MCP: Workers such as a product owner, a doer or a reviewer do your work, and Stewards keep the
memory healthy. You hold the top authority: agents propose, and only you approve.

Three rules shape everything:

- **Context, not execution.** sky-brain sends data, never commands. Agents run where they run
  and pull their work; nothing is pushed to a machine.
- **sky-brain calls no LLM.** Agents and Stewards run in the model you connect. The agent that
  writes an entry also writes its short summary. The only model the server uses is for embeddings,
  and it embeds that summary, never the whole body.
- **Postgres is the truth.** Markdown is how an item reads and how the brain exports.

### The memory model (proposed 23 Nov 2026)

One brain per person, holding **memories**. A memory is a container with a fixed layer.
Full design: [docs/vision/schema/MEMORY-SCHEMA.md](docs/vision/schema/MEMORY-SCHEMA.md).

| Layer | Name in the app | How many | Who writes | Fades? |
|---|---|---|---|---|
| core | **About me** | exactly one per person | only you | never; always loaded, small |
| long | **Notebooks** | many (one default) | agents propose, you approve | never |
| short | **Inbox** | many (one default) | anyone; agents land as proposed | yes, unless used or kept |
| working | **Board** | one per project | agents and people, per goal and task | cleared when the goal closes |

- **Entries never move.** Keeping an Inbox item makes a new Notebook entry that points back to it
  (`derived_from`). Text, trust and summaries are append-only histories.
- **Search:** keyword search on the full body (Hebrew-aware), plus one vector per entry made from
  its summary. Both run in Postgres with pgvector, fused with RRF.
- **Sharing is per memory.** You invite someone to one memory (say "Family" or "Kitchen remodel")
  as viewer, contributor or editor. About me is never shared, except entries you mark for your
  profile.
- **Agents never pick a layer.** They write to an Inbox or to the board of the task they hold.
  Moving up a layer is a proposal you keep or drop in the Digest.

The human-memory research behind this is [docs/vision/HUMAN-MEMORY.md](docs/vision/HUMAN-MEMORY.md).

### What we have (23 Nov 2026)

Live at https://sky-brain.vercel.app, on Vercel with Postgres on Nanogres (D16).

| Part | State |
|---|---|
| Sign-in with Perminister, one workspace per person (D17) | ✅ Built |
| Invites to another person's workspace | 🟡 Partly built: an invite is accepted at sign-in, but nothing creates one yet |
| MCP connector at `/mcp` (OAuth 2.1, CIMD, PKCE) with `whoami` | ✅ Built; claude.ai and the phone app verified, Claude Code and Codex not yet |
| Task board v1 (D20): goals, task DAG, claims with leases, ten MCP board tools, web page with Approve | ✅ Built |
| Device login and run tokens for headless agents (Pathly) | 🟡 Partly built: the API works, but there is no browser page to approve a device code |
| Gatekeeper base checks: workspace filter, secret scan, quarantine, size caps, rate limits, audit log | 🟡 Partly built: the rate limit is per server instance, not shared |
| Memory core, thin step 1: About me, Inbox and Notebook per person, entries with kind, trust, versions and summaries, word search; MCP tools `capture`, `search`, `get`, `list_memories` | ✅ Built and live (PR #19) |
| Memory loop, thin step 2: a fenced context packet on `claim_task` (About me, rules, relevant entries, what is not known) and up to 3 proposed lessons on `report_task` | ✅ Built and live (PR #20). No Digest page yet; the two-week measurement is in [docs/MEASURE-STEP2.md](docs/MEASURE-STEP2.md) |
| Agents: identity per agent (D26): you name roles (Product owner, Doer, Reviewer…) on the Agents tab and bind each connected app to one; everything it writes is signed `mcp/<app>/<role>` | ✅ Built and live |
| Approval through the connected model, step 1 (D31): `request_approval` and `approval_status` MCP tools, a link to `/a/<id>`, an Approvals tab | ✅ Built and live (PR #32). Web push alerts (D36) built; email next |
| Agents: permissions, skills and board triggers per agent | ⬜ Proposed in [docs/vision/AGENTS.md](docs/vision/AGENTS.md) (D25, open) |
| Hybrid search, step 4 (D47): one vector per entry from its title, summary and questions, fused with word search by RRF in `search`, `context` and `claim_task` | 🟡 Built; on once `EMBEDDINGS_API_KEY` is set on Vercel. Bench: Recall@5 0.62 to 0.74 with a stand-in model |
| Pathly client | ⬜ Not started (lives in pathly-adapters) |
| Benchmark (step 0): 50 questions and a keyword-search baseline in [bench/](bench/README.md) | ✅ Baseline set: Recall@5 0.66, MRR 0.50 |

### What we build next

One sequence (D21). Each step is in daily use, and passes its test, before the next starts.
Details: [docs/vision/BUILD-PLAN.md](docs/vision/BUILD-PLAN.md).

| # | Step | Done when |
|---|---|---|
| 0 | Benchmark: ~100 questions with known answers, plus an unseen project | Plain word search has baseline numbers |
| 1 | Reliable memory: `memories` (one About me per person, Inboxes, Notebooks, Boards), entries with kind and trust level (D22), append-only versions, events and summaries, links, episodes; keyword search on the body; entries API and MCP tools `capture`, `search`, `get` | Tests prove an agent cannot approve, change a kind, write About me or edit in place, an agent write without a summary is refused, and other brains cannot read |
| 2 | The full agent loop: a context packet with each claimed task, evidence on report, proposed lessons, blocking questions, a Digest with Keep, Wrong and Undo | An agent back after a week answers "why" questions without re-reading history |
| 3 | Measure gate | sky-brain beats plain retrieval on decisions kept, or the loop is fixed first |
| 4 | Hybrid search: one vector per entry from its summary (chunks only for long bodies), RRF with keyword search, typed link hops | Recall, precision and latency beat word search alone |
| 5 | Cognitive signals, one at a time: attention, activation, capture context | Each one shows a gain, or is switched off |
| 6 | The Consolidator, one Steward, as a nightly routine in your model; it only proposes | A month of nightly runs adds no contradictions |
| 7 | Growth and export: summaries, retention, hard forget, md vault, git export | |
| 8 | Beyond code: domain packs, sharing per memory (earlier if D23 says so), imports, files | |

**Trust (D22).** Every memory item has a **kind** (fact, decision, hypothesis, observation with
evidence, external) and a **trust level** (quarantined, proposed, approved). Agents and Stewards
write at `proposed`. Only you raise trust; nothing is promoted automatically.

**Not now:** Pages, Views and Reach (Layers 2–5 in the roadmap), a graph database, and
sky-brain calling an LLM on its own. Sharing waits for step 8 unless you decide otherwise (D23,
open).

## The intended experience

This is what sky-brain is for once the memory steps land. Today only the board works this way.

- **Knowledge has a type.** A decision is not a hypothesis, and an observation carries its
  evidence.
- **Knowledge stays true.** A decision ends only when a newer one supersedes it. Every change is
  kept, so you can ask why you thought otherwise a month ago.
- **You hold the top authority.** Agents propose; you approve. Only you write rules and About me.
- **You choose who sees what.** Each memory is yours until you share it, one memory at a time.
- **Every tool shares one brain.** Claude, Codex, claude.ai and Pathly read the same memory and
  work from the same board.

## How you reach it

| Who | How | State |
|---|---|---|
| You and your team, on web or phone | Sign in with Perminister at https://sky-brain.vercel.app | Live |
| claude.ai, Claude desktop, Claude phone app | Add the custom connector `https://sky-brain.vercel.app/mcp` | Live (claude.ai and phone app verified) |
| Claude Code and Codex CLIs | Add the same MCP server | Built, not yet verified |
| Pathly | Device login and run tokens; its client lives in pathly-adapters | Server API built (no device approval page yet), client not started |

Setup and the verified list: [docs/CONNECT.md](docs/CONNECT.md).

## Docs

**The design:**

- [docs/vision/BUILD-PLAN.md](docs/vision/BUILD-PLAN.md): the build order above, step by step
- [docs/vision/schema/MEMORY-SCHEMA.md](docs/vision/schema/MEMORY-SCHEMA.md): the proposed memory
  schema (core, long, short, working), its SQL and tests, and the red/blue team review behind it
- [docs/vision/HUMAN-MEMORY.md](docs/vision/HUMAN-MEMORY.md): how human memory retrieves and
  preserves, and what sky-brain takes from it
- [docs/vision/HATS-AND-APPROVAL.md](docs/vision/HATS-AND-APPROVAL.md): hats (one brain, several
  identities) and approval through the connected model (D30, D31, design agreed).
- [docs/vision/AGENTS.md](docs/vision/AGENTS.md): agent profiles: who each agent is, what it may
  touch, its skills, and the board events that wake it (proposed, D25)
- [docs/vision/hub/](docs/vision/hub/README.md): the architecture page and the other design pages
- [docs/vision/VISION.md](docs/vision/VISION.md) and [docs/vision/REVIEW.md](docs/vision/REVIEW.md):
  the research and the latest outside review

**What is built, and why:**

- [docs/PLAN.md](docs/PLAN.md): how the built parts work and the rules they follow
- [docs/DECISIONS.md](docs/DECISIONS.md): the choices made so far, and why
- [docs/ROADMAP.md](docs/ROADMAP.md): the layers and what each one ships
- [docs/layer-1/TICKETS.md](docs/layer-1/TICKETS.md): Layer 1's tickets and where each stands

## License

MIT. See [LICENSE](LICENSE).
