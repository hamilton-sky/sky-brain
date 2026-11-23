# sky-brain build plan (consolidated 14 Nov, order settled 15 Nov, memory model updated 23 Nov 2026)

This is the one ordered plan for building the brain. It combines:

- [VISION.md](VISION.md) and [spec.html](spec.html): research, 12–13 Nov;
- two outside reviews of the architecture and the cognitive design (14 Nov, in git history);
- the responses to both.

The latest outside review, of this plan itself, is [REVIEW.md](REVIEW.md). The memory model
(23 Nov) comes from the red/blue team review in [schema/MEMORY-SCHEMA.md](schema/MEMORY-SCHEMA.md)
and the research in [HUMAN-MEMORY.md](HUMAN-MEMORY.md). Where this plan and the schema differ on
tables or columns, the schema wins.

It replaces the two build-order lists in VISION.md ("What I would build, in order" and
"Recommended build order"). The build order (D21) and the trust model (D22) are decided; the rest is still a proposal.
What runs today is the outer shell: Perminister sign-in, the MCP connector, the task board v1
and the Gatekeeper's base checks (workspace filter, secret scan, quarantine, size caps, rate
limits). The `entries` table exists with no API or tools. `docs/PLAN.md` lists what is built.

## What sky-brain is

> sky-brain does not try to copy a human brain. It uses principles from human cognition to build
> a memory that is efficient, keeps evolving, and is shared by people and their AI agents.

The advantage is not vectors or a graph, which anyone can add. It is the combination of four
things for several agents working together:

- memory you can trust;
- a shared board;
- permissions;
- the ability to replay why a decision was made.

## The memory model

Each person has one brain (today's workspace, with a unique owner). It holds **memories**, which
are containers, each with a fixed layer:

- **core**, shown as **About me**: exactly one per person, written only by that person, always
  loaded, small.
- **long**, shown as **Notebooks**: many. Agents propose, people approve. Never fades.
- **short**, shown as **Inbox**: many. Captures land here and fade after a while unless used or
  kept.
- **working**, shown as **Board**: one per project, scoped per goal and task, cleared when the
  goal closes.

Entries never move between memories. Keeping or consolidating makes a new entry with a
`derived_from` link. Agents never choose a layer: they write to an Inbox or to their task's
board. Sharing is per memory, never a whole layer, and About me is never shared.

## Rules that hold for every step

1. **Postgres is the truth.** Markdown is each item's body format, an MCP vault view and a git
   export.
2. **Two fields: `kind` and trust level (D22).**
   - `kind`: `fact`, `decision`, `hypothesis`, `observation` (needs evidence) or `external`
     (imported or from the web).
   - Trust level: `quarantined`, `proposed` or `approved`.

   Agents write at `proposed` (external text at `quarantined`). Only a person raises trust or
   changes a kind; Stewards and Workers never can, which extends hard rule 3. Nothing is promoted
   automatically. Importance may raise an item's priority, never its trust. Repetition is not
   evidence: only independent sources count.
3. **Nothing is edited in place.** Changes go to an append-only `entry_versions` table, and a
   replaced decision gets a `supersedes` link. "Why did we think otherwise a month ago?" is an
   as-of query.
4. **Agents coordinate through the board.** An urgent need becomes a blocking *question* item,
   addressed to a role, that wakes whoever can answer. The answer lands on the board. A
   notification is data, never a side channel that holds state, and never a command (hard rule 1).
5. **sky-brain calls no LLM.** Agents run in the person's connected model (Claude, Codex) and pull
   their work over MCP. The only exception is server-side embeddings.
6. **Each cognitive mechanism is a ranking signal or a packet field, not a subsystem.** Each one can
   be switched off, and it stays only if the benchmark shows it helps.
7. **Build and measure on code projects first.** The data model stays generic (types as data), so
   other audiences fit later without a rewrite.
8. **Summaries are written by agents, embedded by the server.** An agent's write must carry a
   short summary (up to 600 characters, plus up to 3 "questions this answers"). The vector is of
   the summary, keyword search is on the full body. A person's write without a summary gets a
   fallback (title plus the start of the body) and chunk vectors until the Consolidator writes a
   real one.

## Build order

This is the one sequence (D21). It matches the architecture page (§ 8). Each step must be in daily
use before the next one starts. "Done when" is the exit test.

### 0. Benchmark first

- **Questions:** about 100, with known answers, taken from sky-brain's own history: DECISIONS.md,
  PRs and threads. An example: "why did we choose Vercel over Render?"
- **Unseen project:** tasks from Pathly, a project the brain has never seen.
- **Long-running tasks:** tasks that span several sessions, where an agent comes back after a week.
- **Runner:** the same agent in three setups: plain RAG (word search over raw text), hierarchical
  memory (summaries, no board link), and full sky-brain.
- **Metrics:** task success, correct retrieval, earlier decisions kept, contradictions, tokens,
  latency, approvals you had to give, stale or wrongly promoted items, and how often agents ask for
  more context.

**Done when:** plain RAG has baseline numbers. Every later step reports against them.

### 1. Reliable memory

This is brain-core tickets 05–11, widened. The proposed schema for all four memory levels (core,
long, short, working), from the 23 Nov red/blue team review, is
[schema/MEMORY-SCHEMA.md](schema/MEMORY-SCHEMA.md).

- **Memories:** a `memories` table with a fixed layer; one About me per person (enforced by the
  database), a default Inbox and Notebook made at sign-in, one Board per project.
- **Entries:** today's empty `entries` table is replaced. Each entry has `kind` and trust level
  (D22) and belongs to one memory for life.
- **Append-only streams:** `entry_versions` (text and kind), `entry_events` (trust and lifecycle),
  `entry_summaries` (one per version, kept or proposed), plus `entry_evidence`, `entry_links`
  (type, reason, proposed/accepted) and an immutable `episodes` table for raw input.
- **Logs that can't be backfilled start now:** `entry_uses` (real uses per reader), `packets` and
  `packet_items`. Nothing reads them until step 5.
- **Gatekeeper:** server code applies the kind and trust rules, the evidence check, the secret scan
  and quarantine, with an edit check so two agents cannot overwrite each other.
- **API and tools:** the entries REST API and the MCP tools `capture`, `search` and `get`.
- **Search:** word search on the body that works for Hebrew (`simple` config, the `sb_norm`
  normalizer, `pg_trgm` on titles).
- **Forget:** one owner-only `forget_entry` function that scrubs every copy of the text.

**Done when:** tests show the allowed and refused case on every write path: an agent cannot reach
`approved`, change a kind, write About me or edit in place; an agent write without a summary is
refused; and another brain cannot read.

### 2. The full agent loop

- **Packet:** `claim_task` and `next_task` return a fenced context packet of about 4–5 chunks, each
  a summary with a pointer to drill down. Only approved items are ground truth; its rules section
  holds only approved rules. The agent may ask for a bigger budget.
- **What we don't know:** the packet says "no approved decision on X", "these two items
  contradict", "this rests on one unverified source".
- **Report:** `report_task` takes evidence. A finished goal proposes 0–3 lessons and observations,
  each at `proposed` until you keep it. Goals get an `expected_outcome`; the gap becomes a proposed
  lesson.
- **Questions:** an urgent need becomes a blocking question item addressed to a role.
- **Resuming:** every released task gets a resume note; an `intentions` table holds "when X, do Y"
  reminders, checked whenever a packet is built.
- **Digest:** a page with Keep, Wrong and Undo.

**Done when:** an agent coming back after a week answers the benchmark's "why" questions without
re-reading history.

### 3. Measure gate

Run the benchmark three ways: plain retrieval, hierarchical memory, and sky-brain so far.

**Done when:** sky-brain beats plain retrieval on decisions kept. If it doesn't, fix the loop
before adding anything.

### 4. Hybrid search

- **Vectors:** pgvector (enabled on Nanogres, version 0.8.1 with `halfvec` and HNSW, 15 Nov) and a
  multilingual embedding model. Embeddings are the one thing the server computes with a model.
  One vector per entry, of its title, summary and questions; chunk vectors (at most 8) only for
  long bodies or fallback summaries. HNSW on Notebooks only; Inboxes use exact search. 768 or 1024
  dimensions is decided by the Hebrew/English benchmark.
- **Fusion:** RRF (k = 60) over word search and vector search.
- **Associative hops:** 1–2 hops over accepted links, preferring `derived_from`, `depends_on` and
  `supersedes`, with fan damping (S − ln(fan)).

**Done when:** recall, precision and latency on the benchmark beat word search alone.

### 5. Cognitive signals, one at a time

Before this step the benchmark grows to at least 300 questions, with the expected gain of each
signal written down in advance (R4-18 in the schema review).

Attention (closeness to the claimed task's goal), then activation (a `uses` log of real uses only,
ACT-R ln(n/0.5) − 0.5·ln(age)), then the capture-context boost. Old binding decisions never fade
out of rank: activation only orders what is still valid and in scope.

**Done when:** each signal shows a gain in a run with it and a run without it, or it is switched
off.

### 6. The Consolidator, as one Steward

- **How it runs:** a scheduled routine in the person's own model, with a budget.
- **What it does:** works a priority queue (future need, surprise, importance), replays new Inbox
  items next to related Notebook entries and proposes gists, writes missing summaries, merges
  duplicates, fills the daily Digest (a budget of about 10 cards), raises "still true?" checks when
  something changes (not on a fixed 1/7/30/90-day ladder), and writes a weekly Auditor report on
  contradictions, stale claims and orphans.
- **Limit:** it only proposes. Nothing it writes is above `proposed` until you keep it (D22). It
  counts sources by lineage.

**Done when:** a month of nightly runs adds no contradictions.

### 7. Growth and export

Layered summaries (track, project card); retention by layer, with old episodes moved to
cold storage behind a summary and a pointer; hard forget that also removes the embedding and the
summaries built on the item; a cold archive for whole projects; the md vault and a git export.

### 8. Beyond code

Domain packs with versioned types, sharing per memory (viewer, contributor, editor; About me never
shared; ready as its own SQL file, so D23 can move it earlier), imports
(Obsidian, Notion, Drive, chat history), files in Blob storage with their text extracted, and other
audiences: lawyers, designers and families.

## The comparison experiment

The full comparison runs after step 6; step 3 is its first, smaller run. The same agent does about 100 long-running tasks in three
setups: plain RAG, hierarchical memory and full sky-brain. One more run switches off each mechanism
in turn: attention, metacognition, typed hops, activation and consolidation. A mechanism that
doesn't pay for its tokens and latency is removed.

## Not now

Each of these needs its own decision later:

- a graph database (Apache AGE is the escape hatch);
- sky-brain calling an LLM on its own server;
- Pages and Views (a Notion rebuild);
- a global graph view;
- lifelogging;
- entity extraction on every write;
- confidence percentages shown to people.

## Still open for the owner

- Postgres is the truth, md is the view and export: accept?
- Rename the middle level to Track, and make it optional?
- ~~Deep memory private per person, board shared per project?~~ Answered by the memory schema:
  everything is private until you share one memory at a time.
- The schema's own open decisions: sharing before step 8 (D23), 768 or 1024 dimensions, roles,
  who sees the profile slice of About me, and the Digest budget
  ([MEMORY-SCHEMA.md § 13](schema/MEMORY-SCHEMA.md#13-open-decisions-for-the-owner)).
- Each remaining rule above, once accepted, gets its own entry in `docs/DECISIONS.md`:
  `entry_versions`, question items, and the benchmark gate. (`kind` and trust: D22. Order: D21.)
