# sky-brain build plan (consolidated, 14 Nov 2026)

This is the one ordered plan for building the brain. It combines:

- [VISION.md](VISION.md) and [spec.html](spec.html): research, 12–13 Nov;
- [REVIEW-2026-11-14.md](REVIEW-2026-11-14.md): outside review of the architecture;
- [REVIEW-2026-11-14-cognition.md](REVIEW-2026-11-14-cognition.md): outside review of the cognitive design;
- the responses to both reviews.

It replaces the two build-order lists in VISION.md ("What I would build, in order" and
"Recommended build order"). It is still a proposal: nothing here is in `docs/DECISIONS.md` yet, and
the task board v1 (live) is the only part that exists.

## What sky-brain is

> sky-brain does not try to copy a human brain. It uses principles from human cognition to build
> a memory that is efficient, keeps evolving, and is shared by people and their AI agents.

The advantage is not vectors or a graph, which anyone can add. It is the combination of four
things for several agents working together:

- memory you can trust;
- a shared board;
- permissions;
- the ability to replay why a decision was made.

## Rules that hold for every step

1. **Postgres is the truth.** Markdown is each item's body format, an MCP vault view and a git
   export.
2. **Every item has a required `kind`:**
   - `fact`: verified;
   - `decision`: approved by a person;
   - `hypothesis`: inferred by an agent;
   - `external`: imported or from the web, quarantined.

   Only a person can raise an item's kind. Stewards and Workers never can, which extends hard
   rule 3. Importance may raise an item's priority, never its confidence. Repetition is not
   evidence: only independent sources count.
3. **Nothing is edited in place.** Changes go to an append-only `item_versions` table, and a
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

## Build order

Each step must be in daily use before the next one starts. "Done when" is the exit test.

### 0. Benchmark first

- **Questions:** about 100, with known answers, taken from sky-brain's own history: DECISIONS.md,
  PRs and threads. An example: "why did we choose Vercel over Render?"
- **Long-running tasks:** a set of tasks that span several sessions, where an agent comes back
  after a week.
- **Runner:** a harness that runs the same agent in three setups:
  1. plain RAG (word search over raw text);
  2. hierarchical memory (summaries, no board link);
  3. full sky-brain.
- **Metrics:**
  - task success;
  - correct retrieval;
  - earlier decisions kept;
  - contradictions;
  - tokens used;
  - latency.

**Done when:** plain RAG has baseline numbers. Every later step reports against them.

### 1. Memory core with provenance

This is brain-core tickets 05–11, kept narrow.

- **Items:** `tier` (inbox / deep), `kind`, `origin`, `confidence_at_encoding`, and a source.
- **Tables:**
  - an immutable `episodes` table for raw input;
  - the append-only `item_versions` table;
  - a `links` table with type, reason and proposed/accepted status.
- **Search and checks:** word search that works for Hebrew (`simple` config plus `pg_trgm`). The
  Gatekeeper is server code: it applies the kind rules, the secret scan and quarantine.

**Done when:** tests show the allowed and refused cases on every write path. An agent cannot create
or raise a `fact` or a `decision`, and it cannot edit an item in place.

### 2. MCP memory tools and the context packet

- **Tools:** `capture`, `search`, `get` and `context_for_task`, plus a read-only md vault.
- **The packet:** `claim_task` and `next_task` return a context packet with at most 4–5 chunks.
  Each chunk is a summary with a pointer to drill down. The packet is fenced, and its rules
  section holds only approved items.
- **Attention:** chunks are ranked by relevance and by how close they are to the claimed task's
  goal.
- **Metacognition:** the packet also says what the brain does *not* know:
  - "no approved decision on X";
  - "these two items contradict";
  - "this rests on one unverified source".

  The agent then asks or looks further instead of acting on a guess.

**Done when:** the benchmark runs on the full setup and beats plain RAG on decisions kept.

### 3. Hybrid search

- **Vectors:** pgvector (confirm first that Nanogres has it) and a multilingual embedding model.
- **Fusion:** RRF (k = 60) over word search and vector search.
- **Associative hops:** 1–2 hops over accepted links. Hops prefer causal and time links
  (`derived_from`, `depends_on`, `supersedes`), with fan damping (S − ln(fan)).

**Done when:** recall, precision and latency on the benchmark beat word search alone.

### 4. The loop between board and memory

- **Questions:** question items (from rule 4).
- **Lessons:** a finished goal proposes 0–3 lessons. Each is a `hypothesis` until you approve it.
- **Outcomes:** goals get an `expected_outcome`, and the gap at completion becomes a proposed
  lesson.
- **Resuming work:**
  - every released task gets a resume note;
  - an `intentions` table holds "when X, do Y" reminders, checked whenever a packet is built.

**Done when:** an agent that returns after a week answers the benchmark's "why" questions without
re-reading history.

### 5. Activation and forgetting

- **Use log:** a `uses` log records real uses only: cited, opened or confirmed.
- **Activation:** ACT-R activation, ln(n/0.5) − 0.5·ln(age), feeds the ranking. Old items rank
  lower and are never deleted.
- **Context:** a boost when an item's capture context matches the current task.

**Done when:** an ablation run (with it and without it) shows a gain. Otherwise it stays off.

### 6. The Consolidator, as one Steward

- **How it runs:** a scheduled routine in the person's model, with a budget.
- **What it does:**
  - works a priority queue: future need, surprise, importance;
  - merges duplicates;
  - writes the daily Digest with Keep, Wrong and Undo;
  - schedules spaced "still true?" checks on decisions (at 1, 7, 30 and 90 days);
  - runs a weekly Auditor report on contradictions, stale claims and orphans.
- **Limit:** it only proposes. Nothing it writes is above `hypothesis` until you keep it.

**Done when:** the benchmark shows no rise in contradictions after a month of nightly runs.

### 7. Growth

- **Summaries:** layered summaries (track, project card, "about me").
- **Retention:** by tier. Old episodes move to cold storage with a summary and a pointer.
- **Hard forget:** a deletion also removes the embedding and the summaries built on the item.
- **Archive:** whole projects go to a cold archive.
- **Export:** a git export of the md vault.

### 8. Beyond code

- **Ontology:** domain packs with versioned types.
- **Sharing:** per-project sharing, with deep memory private by default.
- **Imports:** Obsidian, Notion, Drive and chat history.
- **Files:** stored in Blob storage, with their text extracted.
- **Other audiences:** lawyers, designers and families.

## The comparison experiment

The comparison runs after step 6. The same agent does about 100 long-running tasks in three
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
- Deep memory private per person, board shared per project?
- Each new rule above, once accepted, gets its own entry in `docs/DECISIONS.md`. The rules are:
  `kind`, `item_versions`, question items, and the benchmark gate.
