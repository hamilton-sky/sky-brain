# sky-brain

Your digital self: one brain that you and every AI model you connect read and write, each by
its role.

## The contract

This section is the source of truth for where sky-brain stands. The other docs point here.

### Goal

sky-brain is a personal brain for anything you want to remember and work on, not only code. It
holds a board of work (projects, goals, tasks) and a memory (decisions, facts, lessons, questions)
with links it finds itself. Any model you connect (Claude, Codex, claude.ai) works from it over
MCP: Workers such as a product owner, a doer or a reviewer do your work, and Stewards keep the
memory healthy. You hold the top authority: agents propose, and only you approve.

Three rules shape everything:

- **Context, not execution.** sky-brain sends data, never commands. Agents run where they run
  and pull their work; nothing is pushed to a machine.
- **sky-brain calls no LLM.** Agents and Stewards run in the model you connect. The only model
  the server uses is for embeddings.
- **Postgres is the truth.** Markdown is how an item reads and how the brain exports.

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
| Memory: the `entries` table | 🟡 Table only: no API, no MCP tools, no context packet |
| Memory design: four layers (About me, Inbox, Notebooks, Board), per-memory sharing | 🟡 Designed, not built: proposal with tested SQL in PR #15 (not merged) |
| Benchmark (step 0) | ⬜ Not started |
| pgvector 0.8.1 (`halfvec`, HNSW) | ✅ Enabled on the database, not used yet |
| Pathly client | ⬜ Not started (lives in pathly-adapters) |

### What we build next

One sequence (D21). Each step is in daily use, and passes its test, before the next starts.
Details: [docs/vision/BUILD-PLAN.md](docs/vision/BUILD-PLAN.md). As of 23 Nov, no step has
started: the time since 15 Nov went into design (human memory research, memory schema review).

| # | Step | Done when |
|---|---|---|
| 0 | Benchmark: ~100 questions with known answers, plus an unseen project | Plain word search has baseline numbers |
| 1 | Reliable memory: extend `entries` with kind and trust level (D22), versions, links, episodes; entries API and MCP tools `capture`, `search`, `get` | Tests prove an agent cannot approve, change a kind or edit in place, and other workspaces cannot read |
| 2 | The full agent loop: a context packet with each claimed task, evidence on report, proposed lessons, blocking questions, a Digest with Keep, Wrong and Undo | An agent back after a week answers "why" questions without re-reading history |
| 3 | Measure gate | sky-brain beats plain retrieval on decisions kept, or the loop is fixed first |
| 4 | Hybrid search: embeddings, RRF, typed link hops | Recall, precision and latency beat word search alone |
| 5 | Cognitive signals, one at a time: attention, activation, capture context | Each one shows a gain, or is switched off |
| 6 | The Consolidator, one Steward, as a nightly routine in your model; it only proposes | A month of nightly runs adds no contradictions |
| 7 | Growth and export: summaries, retention, hard forget, md vault, git export | |
| 8 | Beyond code: domain packs, sharing per project, imports, files | |

**Trust (D22).** Every memory item has a **kind** (fact, decision, hypothesis, observation with
evidence, external) and a **trust level** (quarantined, proposed, approved). Agents and Stewards
write at `proposed`. Only you raise trust; nothing is promoted automatically.

**Memory layers (proposal, PR #15).** Each person has one brain. It holds one **About me**
(core: small, always loaded, only you write it), many **Inboxes** (short: recent captures that
fade unless used or kept), many **Notebooks** (long: gists you approved) and one **Board** per
project (working: scratch for a goal, cleared when it closes). Entries never move between
layers: consolidation writes a new entry linked to its source. Search uses words on the full
body and a vector of a short summary. You share one memory at a time, never About me. See
[MEMORY-SCHEMA.md on the PR branch](https://github.com/hamilton-sky/sky-brain/blob/docs/memory-schema-review/docs/vision/schema/MEMORY-SCHEMA.md).

**Not now:** Pages, Views, Sharing and Reach (Layers 2–5 in the roadmap), a graph database, and
sky-brain calling an LLM on its own.

## The intended experience

This is what sky-brain is for once the memory steps land. Today only the board works this way.

- **Knowledge has a type.** A decision is not a hypothesis, and an observation carries its
  evidence.
- **Knowledge stays true.** A decision ends only when a newer one supersedes it. Every change is
  kept, so you can ask why you thought otherwise a month ago.
- **You hold the top authority.** Agents propose; you approve. Only you write rules.
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
- [docs/vision/hub/](docs/vision/hub/README.md): the architecture page and the other design pages
- [docs/vision/VISION.md](docs/vision/VISION.md) and [docs/vision/REVIEW.md](docs/vision/REVIEW.md):
  the research and the latest outside review
- [docs/vision/HUMAN-MEMORY.md](docs/vision/HUMAN-MEMORY.md): how human memory encodes, keeps and
  retrieves, and the design principles taken from it
- Memory schema proposal (core, long, short, working memory, sharing): PR #15, not merged yet

**What is built, and why:**

- [docs/PLAN.md](docs/PLAN.md): how the built parts work and the rules they follow
- [docs/DECISIONS.md](docs/DECISIONS.md): the choices made so far, and why
- [docs/ROADMAP.md](docs/ROADMAP.md): the layers and what each one ships
- [docs/layer-1/TICKETS.md](docs/layer-1/TICKETS.md): Layer 1's tickets and where each stands

## License

MIT. See [LICENSE](LICENSE).
