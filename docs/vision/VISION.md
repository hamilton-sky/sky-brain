# What sky-brain should be: four perspectives

Research and recommendations, 12–13 Nov 2026. Not decided yet; nothing here is built.

**Current plan:** the ordered build plan is [BUILD-PLAN.md](BUILD-PLAN.md) (14 Nov). It folds in two outside reviews and replaces the build-order lists below. The latest review is [REVIEW.md](REVIEW.md).

> sky-brain does not try to copy a human brain. It uses principles from human cognition to build a memory that is efficient, keeps evolving, and is shared by people and their AI agents.

Live copies: [doc](https://claude.ai/artifact/GHqQhnKUHh1cWBq2crmACb) · visual spec: [spec.html](spec.html) ([live](https://claude.ai/artifact/ANQuhNF4JqcERjY99EG6nw))

## Bottom line

Your vision holds up: a personal brain with three kinds of memory, a shared board as working memory, and persona agents that read and write by responsibility. All four perspectives agree, and so does the research (Letta, Zep, mem0, Generative Agents, classic blackboard systems). Two parts of it need changing.

- **The brain is not md files.** It should *read* like md files: markdown bodies, a browsable vault for agents, and a git export you own. The truth must live in Postgres. Pathly already learned this. Its own rule says the DB is the one authority and files are only seeds or exports, and it needed a CI check to stop code reading its own md copies.
- **"The brain decides the links" needs a leash.** Agents propose links with a reason and a source. Links become real when you keep them or when retrieval actually uses them. Otherwise the brain fills with links nobody trusts.

The sharp first version is narrower than "digital self": **the memory and board that all your agents share, and that stays true.** It should still be built so non-code data fits later. Build the loop between board and memory first (finished goals become lessons, claimed tasks bring their context). Then add a daily Digest where you review what the agents changed.

## Four perspectives

Each persona researched the web and read the repos on its own. Their conclusions overlap more than they differ.

| Persona | Headline | Build first | Don't build |
| --- | --- | --- | --- |
| Product Owner | Second brains die from upkeep, not missing features. People stay for a job, not for memory. The wedge is "shared agent memory that stays true". | Finish brain-core 05-11 narrowly. Turn finished goals into draft lessons. Return context with each claimed task. Run a weekly lint. Add a markdown export. | Pages and views (a Notion rebuild), lifelogging and clippers, links the brain makes on its own, pgvector before search misses |
| Data specialist | Every memory system splits memory the same way: core/working, episodic, semantic. One table with a tier column, not three stores. | `episodes` (immutable raw input), `links` (typed, with provenance and two time ranges), nightly sleep job, hybrid search | Graph DB, entity extraction on every write, GraphRAG, a full truth-maintenance system |
| Architect | Postgres is the authority. Md is the interface: a virtual vault agents browse and edit by path, plus a git export. | Event log written with every change, personas as trigger rules, activations claimed like tasks, a sleep job on a schedule | Files as the source of truth; a persona clients can claim for themselves |
| Designer | Users never see "floating / working / deep". They see Inbox, Board, Memory and a daily Digest, and the Digest is the home screen. | A `capture` MCP tool for the phone, the Digest, bylines on everything, links shown as sentences with a reason | A global graph view, a whiteboard, confidence percentages, folders, approval for every write |

## The brain model

*Diagram: see "The brain model" in [spec.html](spec.html).*

The board is the blackboard: personas meet there and never call each other. The sleep agent takes what was used, kept or finished and turns it into deep memory. Everything else in the Inbox fades.

## Is the brain md files?

No for storage, yes for how the brain reads. All four personas reached this on their own. Markdown is the right format for each item's body, for agents browsing the brain, and for an export you own. It is the wrong place to keep the truth when many agents on many devices write at once on a serverless host.

**What Pathly got right with md:**

- Task files as self-contained prompts (Files, Done-when, refs). Its own review calls this the strongest single design.
- Short files with one purpose each (`map.md`, `spec.md`, `learnings.md`) that people, git and LLMs all read easily.
- Portability: the knowledge outlives the tool.

**Where md hurt Pathly (from the repo):**

- It had to forbid reading its own files. The `state-one-authority` rule and `check_no_mirror_reads.py` exist because disk copies drifted from the DB.
- `features/comms-board/STATE.json` still says `BUILDING` from June. A file can't say whether it is current.
- `lessons/` holds `LESSONS.md`, `LESSONS_CANDIDATE.md` and `LESSONS_CANDIDATE_1.md`. Plain files have no status, expiry, supersede or author, so nothing retires old knowledge.
- Identity came from file location, which caused the two-identity bug. Paths make bad ids: a rename breaks every link.

**What others do:**

| Tool | Where truth lives | Lesson for sky-brain |
| --- | --- | --- |
| Obsidian | Md files; Sync merges edits silently | Fine for one person's prose, risky for decisions |
| Logseq | Moving from md files to SQLite | Cited collaboration, renames, missing ids and lost sync data |
| Basic Memory | Md files, SQLite index | Works for one local writer; no conflict story |
| Anthropic memory tool | Your choice; a database is explicitly allowed | Md-shaped API in front of a database is the proven pattern |
| Letta, Zep | Database (blocks, temporal graph) | Contradicted facts are closed, not deleted |

**Recommendation:** Postgres stays the one authority. Each item's body is markdown, and its frontmatter is the row's metadata. Agents browse a virtual vault over MCP (`/brain/<project>/<track>/<goal>.md`) using the memory-tool commands. Each edit carries the version it started from: a stale edit is refused, and an accepted one becomes a versioned write or a proposal. A one-way export to git or a zip keeps the brain yours, which matters after Rewind/Limitless users lost access with two weeks' notice. A later Obsidian sync can treat each local change as an import proposal.

## Self-made links and keeping memory true

Let the brain propose links, but give each one a type, a reason and a source, and keep it as a proposal until it earns trust. Untyped links that an LLM makes on every write (A-MEM style) are where link spam starts, and the A-MEM paper admits quality "depends on the LLM".

**Who makes links.** Three writers, recorded on each link: you, rules ("task X produced entry Y"), and the Librarian during consolidation. Doer agents can only propose.

**A small fixed set of link types:** supports, contradicts, supersedes, derived\_from, answers, about, part\_of, depends\_on, plus a rare `related`.

**What each link records:** confidence, how it was made, a one-line reason, author and run, the raw input it came from, when it was true, and when the brain believed it. The last two let you ask "what did I believe on date X?", as Zep/Graphiti does.

**Against link spam:**

- At most about 3 LLM links per new item, chosen only from the top 5-10 search hits.
- New links stay proposed until you keep them, retrieval actually uses them, or a second run agrees.
- The sleep job prunes unused `related` links.

**Keeping memory true (Pathly's main gap: it kept claims, not truths):**

- `derived_from` links are the justifications. When an item is replaced, a recursive query flags everything built on it as needing review.
- When a new rule, decision or claim conflicts with an existing one, the brain adds a `contradicts` link and asks you a question. It picks a winner on its own only when one source clearly outranks the other.
- Deep memory is never silently deleted. Items are closed with an end date and stay searchable as history.
- Floating items fade on a forgetting curve: each time they are used they get stronger, and unused ones expire.

**Retrieval** in one Postgres: full-text plus vectors merged, then 1-2 hops over accepted links, then items the task names directly, then a rerank by recency, importance and relevance. Check first whether Nanogres offers pgvector; full-text alone is fine to start.

## Personas and agents

A persona is a role plus a set of read and write permissions, and the server enforces them. A prompt alone is not enough. Otherwise any MCP client can claim to be the Librarian, which repeats Pathly's "trusted, not enforced" gap.

| Persona | Reads | Writes | Never |
| --- | --- | --- | --- |
| You | Everything | Everything; only you approve goals, rules and decisions |  |
| Product Owner | Board, deep memory | Proposes projects, tracks and goals | Approves anything; does tasks |
| Librarian (data specialist) | Everything in its scope | Deep memory and links; proposals when unsure or contradicting | Touches the board |
| Doer | Its task plus the context sent with it | Task reports, floating notes, proposed links | Writes deep memory directly |

**How it works as a blackboard:**

- Every change writes an event row in the same transaction. Workers read events by position, since LISTEN doesn't work through Nanogres's PgBouncer.
- Each persona declares, as data, what it reacts to ("a goal finished", "a new Inbox item"). Matching events create activations that personas claim with a lease, exactly like tasks. Research found agents that volunteer for work beat central assignment.
- Transaction-level locks are fine under PgBouncer (`claim.ts` already uses one). Only session-level locks are ruled out.

**Where agents run.** Today sky-brain never runs an agent (decision D1); agents are MCP clients such as claude.ai, the phone app and Claude Code. The sleep/consolidation job is the first thing that wants to run on the server, through Vercel Cron and the Claude API. That reverses D1 and needs its own decision, with a daily token budget, proposals by default, and every run logged. Note that Vercel Hobby cron runs at most once a day; more often needs Pro or an outside pinger.

**Binding personas.** A persona is fixed when a token is issued, not claimed per call. Normal sign-ins get a low-privilege persona. Librarian and PO powers run only in server jobs acting for you, or after you approve the elevation on the web.

## How a person uses it

The design job is three habits: drop things in, glance at what changed, and correct the brain when it is wrong. Users see plain places, not tier names.

| Tier | Shown as | What it is |
| --- | --- | --- |
| Floating | Inbox | Raw captures and agent scratch notes; fades after some days unless kept |
| Working | Board | Project > Track > Goal > Task, as today, with a byline on each row |
| Deep | Memory | Decisions, rules, facts about you, lessons, people; each with links and history |
| (daily ritual) | Digest | What changed since you last looked, built by the sleep agent; the home screen |

**Capture from the phone.** One MCP tool, `capture`, in the Claude app: "remember that…" or a shared link goes to the Inbox with no questions asked. Backups are a `/new` page you add to the home screen and an email-in address. The Librarian suggests a type and project later, in the Digest.

**Reviewing agent work.** Changes that can be undone apply at once with a 7-day undo. Only proposed goals and deletes or replacements in Memory wait for you. The Digest shows at most about 10 items, approvals first.

**Links** appear as a sentence with its reason and source, marked Linked or Suggested, never a percentage. Each has Keep, Wrong and Change.

**Who wrote it.** Every item carries a byline chip (You, PO, Librarian, Doer · task 42), and the activity log filters by persona.

**Lessons from the research:** the Obsidian graph view is mostly decoration (a "brain health" list of orphans and conflicts is more useful); Mem's no-folders approach won on recall but lost on trust; ChatGPT's 2025 memory wipe showed people forgive a missing memory but not a wrong or lost one.

## Follow-up: metadata, links, search, audience, sharing

Your follow-up questions from 12 Nov, with my answers.

**1. Every write carries metadata.** Each item is a database row with columns for who wrote it, for whom, from which task and tool, when, how sure, and its status. Seen as an md file, those columns appear as frontmatter:

```markdown
---
id: 8f3c…
kind: decision
tier: deep
status: approved
author: Librarian (for the owner)
from: task 42 / claude.ai
created: 2026-11-12
confidence: high
links: [supports → "Postgres, no graph DB"]
---
Use Postgres for everything…
```

**2. Connections between data** live in a separate links table. Each link has a type (supports, contradicts, about, part of, came from, and a few more), a one-line reason, and who made it. Agents propose links and you keep or reject them. In the md view a link shows as `[[title]]`.

**3. Search: no separate vector database.** Postgres with the pgvector add-on keeps vectors next to the data. Search mixes word search (exact names) with vector search (similar meaning), then adds items linked to the hits. A separate vector database would copy your data to a second place and bypass the permission checks. First check whether Nanogres supports pgvector. Word search alone is enough to start.

**How the two searches become one score: Reciprocal Rank Fusion (RRF).** Word search and vector search each return a ranked list. RRF gives every item a score of 1/(k + rank) from each list and adds them up, with k = 60 as the usual default. An item near the top of both lists wins. RRF uses ranks, not raw scores, so the two very different score scales need no tuning. It runs as one SQL query in Postgres (Supabase's hybrid search is the reference). Graph hops and a recency and importance rerank come after the fused list.

**4. For everyone, not only developers.** The model is already general:

| Person | Project | Tracks | Example goal |
| --- | --- | --- | --- |
| Lawyer | A client | One per case | File the appeal by 1 Dec |
| Designer | A client | Campaigns, brand | Deliver the spring campaign |
| Parent | The household | Kids, health, school, money | Plan the summer camp |
| Developer | A product | Features | Ship sign-in |

Build it well for one kind of person first, then widen. Lawyers and health data need stronger privacy: encryption, export, and real deletion.

**5. Inviting others to your brain.** Share by project, not the whole brain. You invite someone to a project as viewer, editor or admin, roles Perminister already has. Your personal deep memory stays private unless you choose to share part of it. Another person's agents can only do what that person is allowed to do.

## Ontology: a light shared vocabulary

Yes to an ontology, but a light one: a small set of types and link types the brain and its agents agree on. A formal OWL or RDF system is too heavy for anyone to keep up in a personal brain.

| Layer | What it holds | Who changes it |
| --- | --- | --- |
| Core (every brain) | Item kinds: note, decision, rule, lesson, question, fact. Entity types: person, organization, place, event, document, topic, project (names borrowed from schema.org). Link types: supports, contradicts, about, part of, came from, depends on, mentions. | sky-brain releases only |
| Domain packs | Lawyer: Case, Court, Hearing, Client. Parent: Child, School, Doctor. Designer: Client, Brand, Campaign. Developer: Repo, Feature, Bug. Each adds fields and allowed links, e.g. hearing of → case. | Chosen per project; stored as data, not code |
| Learned types | Types the Curator notices repeating (five notes about "Camp") and proposes in the Digest | You keep or reject them |

**Rules that keep it light:**

- Nobody has to pick a type to capture something. Free text goes to the Inbox, and the Curator proposes the type later.
- Every type extends a core type (Hearing is an Event; Child is a Person), so agents that know only the core still understand it.
- Entities are merged when they are the same thing ("Dana" and "Dana Levi"), with the merge shown in the Digest.

**In the database:** one `types` table (name, parent, fields as JSON Schema, allowed link types, pack). Items carry `type_id` and a `props` jsonb validated against the type. No new table per type, and no graph database.

## How to build the brain

My recommendation (13 Nov): one Postgres database, a fixed generic schema that people configure with data, a separate family of Steward agents that keep the brain healthy, and growth handled by summaries and archiving rather than by compressing files.

### Graph database or Postgres?

Postgres. A graph database would add a second store that drifts, needs syncing and has its own permissions.

- **Scale:** a person makes perhaps 10k-100k items over years. A recursive query over an indexed links table answers 1-3 hops in milliseconds at that size.
- **One transaction:** an item, its links, its embedding and its event are written together or not at all.
- **One permission model and one backup**, on the Nanogres you already run.
- **Escape hatch:** the Apache AGE extension adds graph queries (Cypher) inside Postgres, if Nanogres allows it. A read-only export to a graph tool is another option for analysis.
- **When to revisit:** queries that need more than 3 hops, or graph algorithms such as PageRank over large shared brains.

The "see the connections" view for people doesn't need a graph database either. It is a query for one item's neighbours.

### Two families of agents

You're right that the Product Owner doesn't belong to the brain's own machinery. I'd split agents into two families with different names:

| Family | Job | Examples | Configurable? |
| --- | --- | --- | --- |
| **Stewards** | Keep the brain healthy. Built in, run in the background. | Curator (types, entities, merges, links) · Consolidator (nightly sleep, Digest) · Archivist (summaries, archiving) · Auditor (conflicts, stale facts) | Settings only |
| **Workers** | Do the person's work through the board. | Product Owner, Doer, Reviewer, Researcher, a lawyer's paralegal | Yes: each person defines their own |

The Gatekeeper (permissions, secret scan, quarantine of imported text) is plain server code, not an LLM. Start with one Steward that does the Curator and Consolidator jobs, and split it when the work grows.

### One brain, two kinds of reader

The same rows serve both:

- **Agents** use MCP tools (capture, search, get, context for a task, the board tools) and browse the md vault.
- **People** use the web app: the Digest, the Board, Memory pages rendered from markdown with backlinks, and a Connections panel that shows one item's neighbours 1-2 hops out. The git export gives the raw md files.

### Growth: compress meaning, not files

Storage is not the problem. 50k items at about 2 KB is about 100 MB of text. Embeddings at 1024 dimensions in half precision add about 100 MB more. The real problems are noise, and agents' limited context. Six measures:

1. **Layered summaries.** Items roll up into a track summary, a project memory card and an "about me" card. Agents read from the top and drill down. The Archivist regenerates a summary when its children change.
2. **Retention by tier.** Inbox items fade after N days unless used. Raw episodes (chats, reports) move to cheap file storage after about 90 days, keeping a summary and a pointer. Deep items are never deleted automatically, but closed and replaced ones leave default search.
3. **Merge duplicates** during the nightly sleep.
4. **Context budgets.** Each agent request names a token budget, and the server returns the best items that fit.
5. **Hard forget.** When a person deletes something, it is gone from the row, its embedding, the next export, and the summaries built on it (which are regenerated). Privacy law needs this.
6. **Cold archive** for whole finished projects, which can be restored.

### Tables: generic core, configured by data

People never create tables. The schema is fixed and generic. People configure types (domain packs), their Worker agents, views and retention, and all of that is stored as rows.

| Group | Tables |
| --- | --- |
| People and access | workspaces, members, projects (+ shares) |
| Board (live today) | tracks (new), goals, tasks, task\_events |
| Memory | items (+ type\_id, props, tier, validity), types, links, episodes, embeddings |
| Agents | agents (versioned prompts and permissions), activations, events, usage |

The blackboard loop: a change writes an event, and the event wakes the matching Stewards. A Worker that pulls a task gets the task plus a context slice: the project card, the decisions linked to the goal, and the top search hits within its budget.

### Blind spots

1. **Hebrew.** Postgres has no Hebrew stemmer, so word search needs the `simple` setting plus trigram matching. Vector search needs a multilingual embedding model. Mixed Hebrew and English notes will be your real data.
2. **Cost.** sky-brain calls no LLM itself (13 Nov). Stewards and Workers run inside each person's own connected model (Claude, Codex) and pull their jobs over MCP, so that person's subscription pays. A scheduled routine runs the nightly Consolidator. Only embeddings need a small server-side model (about $0.02 per million tokens), unless vectors are skipped.
3. **Privacy and never-delete conflict.** People need a real forget (above). Lawyers will ask for encryption, perhaps with a key per workspace.
4. **Memory poisoning.** Text stored today is fed to agents tomorrow. Imported and web text needs quarantine and must be marked as data, not instructions.
5. **The empty brain.** On day one there is nothing to recall. Imports (Obsidian or Notion md, Google Drive, chat history) are needed early.
6. **Files.** PDFs, images and voice notes need file storage (Vercel Blob or S3) and extracted text. Postgres should not hold the files themselves.
7. **No quality measure.** Keep a small test set of questions with known answers and run it on every change to search.
8. **Single points of failure.** Nanogres runs on one server, so keep off-site backups and practise a restore. Vercel also limits how long one function may run, which matters for nightly jobs.
9. **Same entity, different names.** Merging "Dana" and "Dana Levi" must be undoable.
10. **Changing a type.** Domain pack types need versions, so old items still validate after a change.

### What I would build, in order

1. **Schema v2:** types, extended items, links, episodes, events, and Hebrew-aware word search.
2. **MCP memory tools:** capture, search, get and context-for-task, plus a read-only md vault.
3. **One Steward:** a nightly job with a budget that writes the Digest page.
4. **Embeddings and RRF**, once pgvector is confirmed and a multilingual model is chosen.
5. **Summaries, archiving and hard forget.**
6. **Domain packs and per-project sharing.**
7. **Imports.**

## What brain science changes

The design already copies the brain's layout: a fast store (Inbox), a small workspace (Board), a slow integrated store (Memory) and an offline sleep pass. Cognitive psychology (research 13 Nov) sharpens eight parts of it. All of the scores below run as SQL on the server, so no LLM is needed for them.

| # | Human memory finding | Change in sky-brain |
| --- | --- | --- |
| 1 | Forgetting follows a power law, and how often something is needed again tracks its past use (Anderson & Schooler 1991; ACT-R) | Replace the exponential decay with ACT-R activation, B = ln(Σ tⱼ^−0.5), approximated as ln(n/0.5) − 0.5·ln(age). Count only real uses (cited, opened, confirmed) in a `uses` log. Forgetting means ranking low, never deleting. |
| 2 | People confuse where a memory came from; repetition and suggestion plant false memories; only first confidence predicts accuracy (Johnson; Loftus; Wixted & Wells) | Add `origin` (person said / external source / agent inferred / consolidated), freeze `confidence_at_encoding`, and count independent sources, not mentions. Search answers "know / partial / don't know". |
| 3 | Working memory holds about 4 chunks; the episodic buffer binds them (Cowan; Baddeley) | Each task gets a context packet of at most 4-5 chunks, each a summary with a drill-down pointer, stored for audit. |
| 4 | Sleep replays selectively, interleaves old with new, and new facts that fit a schema consolidate fast (McClelland; Tse 2007) | The Consolidator works a priority queue (future need, surprise, importance), reloads old neighbours when rewriting a summary, fast-tracks items that fit a well-linked topic, and proposes a new type when misfits cluster. |
| 5 | Prediction error drives new learning (Bein, Davachi) | Score surprise at write. Near-duplicates reinforce an existing item; surprising ones get priority. Goals get an `expected_outcome`, and the gap at completion becomes a lesson. |
| 6 | If-then plans help people remember to act later (Gollwitzer, d = .65); unfinished tasks are not better remembered, but the urge to resume them is real | An `intentions` table for "when X, do Y" reminders, checked whenever a context packet is built. A resume note on every released task. |
| 7 | Memory works best when the original context returns (encoding specificity); deeper processing is remembered better | Store each item's capture context and boost items whose context matches the current task. The Curator adds a "why it matters" line and 2-3 likely future questions. |
| 8 | Activation spreads along links and weakens through busy hubs (Collins & Loftus; ACT-R fan effect) | Link expansion with fan damping, S − ln(fan), plus a short boost for items touched in the last hours. |

**Where not to copy the brain:** humans rewrite memories when recalling them, drift toward the gist during sleep, and treat repetition as truth. sky-brain must never edit a source in place, must keep summaries linked to their sources, must count only independent evidence, and must not raise confidence because something was recalled often. Importance may raise priority, never confidence.

**Also from the research:** spaced "still true?" checks on decisions in the Digest (at 1, 7, 30 and 90 days), a learned "who knows what" map for routing questions (transactive memory), and a weekly recap so the person still knows *what* was decided, not only *where* to find it.

## Where they disagree, and decisions for you

The four mostly agree. Here are the real differences and how I'd settle them.

| Topic | The tension | My recommendation |
| --- | --- | --- |
| Approval | The PO wants only you to approve rules and decisions. The designer wants most agent changes to apply at once with undo. | Both: rules, decisions and goals need you; notes and links apply with a 7-day undo. |
| Floating memory | The PO says no separate floating store in v1. The designer wants an Inbox. | A `tier` column on the existing entries, shown as the Inbox. No new store. |
| Name for the middle level | "Stream" clashes with feeds and event streams. The PO liked Area or Track; the designer argued against Area (in PARA it means a responsibility that never ends). | **Track**, and make it optional so small projects stay Project > Goal > Task. |
| Server-side agents | The architect says the sleep agent needs the server and the Claude API, which reverses D1. | Start on the pull side: the agent that reports a goal's last task also proposes its lessons. Add a server sleep job later as its own decision. |
| How many personas | The PO says start with two roles; the vision has four or more. | Start with Doer and Librarian, then add the PO once goals are proposed often. |
| Scope | "Digital self" for anyone vs. a wedge for your own agents. | Keep digital self as the direction, build the wedge first, and keep the data model open to non-code items. |

**Questions for you:**

- [ ] Do you accept "Postgres is the truth, md is the view and export"?
- [ ] Rename the middle level to Track, and make it optional?
- [ ] Is deep memory private per person while the board is shared per project?
- [ ] Should sky-brain run agents on its own server (reversing D1) now, or later?

## Recommended build order

Each step should be in daily use before the next starts, which is the roadmap's own rule.

1. **Deep memory core.** Finish brain-core 05-11, kept narrow. Add a `tier` column, an immutable `episodes` table for raw input, and a `links` table with types, reasons and proposed/accepted status.
2. **Board to memory loop.** `claim_task` and `next_task` return the relevant approved decisions and rules. When a goal finishes, 0-3 lessons are proposed as drafts you approve.
3. **Capture and Digest.** A `capture` MCP tool for the phone, an Inbox view, and a daily Digest page with Keep, Wrong and Undo.
4. **Lint and truth.** A weekly read-only report of contradictions, stale claims and orphans, plus `derived_from` review flags.
5. **Vault and export.** The md vault over MCP and a git export.
6. **Later, each as its own decision:** server-side sleep agent, pgvector, the PO persona, non-code domains.

**How to tell it works** (extends the roadmap's two-week test): at least 30% of reads come from a different tool than the writer; returned context is used in at least 40% of claimed tasks; you paste context by hand almost never; at least 20% of recent entries get read again; fewer than one wrong-memory incident a month.

**Don't build yet:** Pages and Views (a Notion rebuild), lifelogging and web clippers, a global graph view, a whiteboard, confidence percentages, folders, a separate graph database, entity extraction on every write.

## Sources

Pages the persona agents opened, grouped by topic. Repo evidence comes from hamilton-sky/pathly-adapters (`docs/BLACKBOARD_ARCHITECTURE.md`, `docs/ARCHITECTURE_ONE_AUTHORITY.md`, the blackboard assessment) and hamilton-sky/sky-brain (`docs/PLAN.md`, `ROADMAP.md`, `DECISIONS.md`).

**Agent memory systems:** [Letta sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime/index.md) · [Letta on agent memory](https://www.letta.com/blog/agent-memory) · [Zep / Graphiti paper](https://ar5iv.labs.arxiv.org/html/2501.13956) · [Graphiti notes](https://zby.github.io/commonplace/sources/graphiti-temporal-knowledge-graph) · [A-MEM](https://arxiv.org/html/2502.12110v9) · [mem0](https://www.emergentmind.com/papers/2504.19413) · [Generative Agents memory stream](https://agentpatterns.ai/patterns/agent-design/generative-agents-memory-stream/) · [HippoRAG](https://www.emergentmind.com/papers/2405.14831) · [LazyGraphRAG](https://www.microsoft.com/en-us/research/blog/lazygraphrag/) · [LangChain memory concepts](https://docs.langchain.com/oss/python/concepts/memory) · [MemoryBank forgetting curve](https://ar5iv.labs.arxiv.org/html/2305.10250) · [Reason maintenance](https://kiwix.lema.org/wikipedia_en_all_mini_2024-02/A/Reason_maintenance) · [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)

**Blackboard architecture:** [LbMAS blackboard for LLM agents](https://arxiv.org/html/2507.01701v1) · [Agents volunteering vs assignment](https://arxiv.org/abs/2510.01285v2) · [The blackboard is back](https://tianpan.co/blog/2026/07/02/the-blackboard-is-back) · [Blackboard system](https://en.wikipedia.org/wiki/Blackboard_system)

**Files vs database:** [Anthropic memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) · [Claude Code memory](https://code.claude.com/docs/en/memory) · [Basic Memory](https://docs.basicmemory.com/technical/technical-information) · [Logseq database version](https://discuss.logseq.com/t/why-the-database-version-and-how-its-going/26744) · [Obsidian Sync conflicts](https://obsidian.md/help/sync/troubleshoot) · [PgBouncer features](https://www.pgbouncer.org/features) · [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)

**Product and market:** [The new Mem](https://get.mem.ai/blog/the-new-mem) · [Why we stopped using Mem](https://blog.myicor.com/why-weve-stopped-using-mem-as-our-pkms-shallow-thinking-tool-at-the-paperless-movement) · [Rewind/Limitless acquired by Meta](https://9to5mac.com/2025/12/05/rewind-limitless-meta-acquisition/) · [Second brain deleted](https://flowingdata.com/2025/07/10/second-brain-deleted/) · [Write-only second brain](https://www.toolsforhumans.ai/blog/your-second-brain-is-write-only-heres-why-most-notes-never-get-revisited) · [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) · [Claude memory launch](https://dataconomy.com/2025/10/24/anthropic-gives-claude-a-real-memory-and-lets-users-edit-it-directly) · [ChatGPT memory wipe](https://www.webpronews.com/chatgpts-fading-recall-inside-the-2025-memory-wipe-crisis)

**Design:** [Is Obsidian's graph view useful](https://codeculture.store/blogs/developer-culture/obsidian-graph-view-useful) · [In defense of the graph view](https://www.eleanorkonik.com/its-not-just-a-pretty-gimmick-in-defense-of-obsidians-graph-view) · [Heptabase journal](https://wiki.heptabase.com/three-ways-to-make-sense-of-your-fleeting-thoughts-in-journal) · [Tana capture](https://outliner.tana.inc/learn/features/tana-capture) · [Capacities GTD](https://docs.capacities.io/reference/use-cases/getting-things-done) · [Mem one year on](https://dev.to/pickuma/mem-review-ai-organized-notes-one-year-on-4h83) · [Google PAIR explainability](https://pair.withgoogle.com/chapter/People%20+%20AI%20Guidebook%20-%20Explainability%20+%20Trust.pdf) · [Control room for AI coding](https://blog.helix.ml/p/what-a-control-room-for-ai-coding) · [Workstreams](https://clickup.com/blog/workstreams-in-project-management/)

**Cognitive science:** [Anderson & Schooler 1991](https://dyurovsky.github.io/learning-humans-machines/class/13-class/papers/anderson1991.pdf) · [ACT-R equations](https://www.ai.rug.nl/~niels/publications/taatgenLebiereAnderson.pdf) · [Cowan, 3-5 chunks](https://pmc.ncbi.nlm.nih.gov/articles/PMC2864034) · [Complementary learning systems](https://web.stanford.edu/~jlmcc/papers/KumaranHassabisMcClelland16FinalMS.pdf) · [Tse et al. 2007, schemas](https://pubmed.ncbi.nlm.nih.gov/17412951/) · [Sleep and memory review](https://www.frontiersin.org/articles/10.3389/fpsyg.2015.00622/full) · [Murre & Dros 2015, forgetting curve](https://journals.plos.org/plosone/article%3Fid%3D10.1371/journal.pone.0120644) · [Roediger & Karpicke 2006, testing effect](https://psychology.ecu.edu/wp-content/pv-uploads/sites/216/2019/03/Roediger-Karpicke-2006.pdf) · [Loftus 2005, misinformation](https://www.motionpictures.org/wp-content/uploads/2013/09/LoftusLearningMemoryMisinfo05.pdf) · [Source monitoring](https://memlab.yale.edu/sites/default/files/files/2009_Mitchell_Johnson_PsychBull.pdf) · [Wixted & Wells 2017, confidence](https://www.psychologicalscience.org/?p=132254) · [Gollwitzer & Sheeran 2006, if-then plans](https://kops.uni-konstanz.de/entities/publication/2e749bfb-8533-437c-8203-7e788c910c5f) · [Bein, Duncan & Davachi, prediction error](https://www.biorxiv.org/content/10.1101/740563v1.full.pdf) · [Wegner 1991, transactive memory](https://scholar.harvard.edu/sites/scholar.harvard.edu/files/dwegner/files/wegnererberraymond1991.pdf) · [Sparrow 2011, Google effect](https://news.columbia.edu/node/999) · [Clark & Chalmers, extended mind](https://protevi.com/PhilMind/ClarkChalmers.pdf)
