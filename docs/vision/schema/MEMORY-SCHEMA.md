# Memory schema: core, long-term, short-term and working memory

Status: **proposal**, 23 Nov 2026. Nothing here is decided or built. It is the result of a
red/blue team review: 4 blue team designers and 4 red team attackers, each with its own lens,
plus the human-memory research thread
([research doc](https://claude.ai/artifact/XeikKAahzyCFfoRv8wdoRZ)). The eight team reports are in
[review/](review/). The recommended SQL is in [sql/](sql/), and its tests pass on PostgreSQL 16
(section 12).

The design follows the build plan ([BUILD-PLAN.md](../BUILD-PLAN.md)): D21 sets the order and D22
sets `kind` + trust level. It also keeps the hard rules in [CLAUDE.md](../../../CLAUDE.md). Where
the owner's requests of 23 Nov move work earlier than the plan, section 11 says so.

---

## 1. The owner's five points, answered

| # | Asked | Answer |
|---|---|---|
| 1 | The vector should not be of the whole body. Keyword search on the body, vector on a summary. | **Yes.** The agent that writes an entry also writes its summary, and the server embeds that summary. Word search stays on the full body. A person's entry without a summary gets a fallback (title + start of body) right away, plus chunk vectors so it is findable (section 5). |
| 2 | 8 agents, 4 blue and 4 red, each with its own lens. | Done. Blue: data model, retrieval, sharing, lifecycle and psychology. Red: security, data integrity, scale and cost, product sense. 64 findings, every one resolved or deferred (section 10). |
| 3 | Research how human memory works: how to pull and how to preserve. | Folded in from the research thread and blue-4 (section 8). Every mechanism is a switchable ranking signal (BUILD-PLAN rule 6). |
| 4 | Invite other people to different parts of the brain. | **Per memory**, not per layer. You invite someone to "Family" or "Kitchen remodel" as viewer, contributor or editor. Core is never shared, except a slice of it you mark as your profile (section 6). |
| 5 | One person: one core memory, many working, short and long memories. | **Yes**, enforced by the database. One core per person, as many inboxes, notebooks and boards as you like. Everything is yours, and you choose who sees which memory. |

---

## 2. The model

Each person has one **brain**. Today's `workspaces` row becomes that brain, with a new unique
`owner_user_id`. A brain holds **memories**, which are containers. Each memory has a fixed
**layer**. The layer belongs to the memory, and an entry's layer is a read-only copy of it.

| Layer | Name in the app | How many | Who writes | Fades? | How agents get it | In psychology terms |
|---|---|---|---|---|---|---|
| `core` | **About me** | exactly 1 | the person only | never | always loaded, small (≤ 60 items) | self-schema |
| `long` | **Notebooks** | many (one default) | people approve, agents propose | never; "still true?" checks later | search, ranked by meaning and use | semantic memory, gists |
| `short` | **Inbox** | many (one default) | anyone; agents land as proposed, web text quarantined | yes, after a TTL unless used or kept | search with a recency boost | the recent-episode (hippocampal) store, days to weeks, not "seconds" |
| `working` | **Board** | one per project | agents and people, scoped to a goal or task | cleared when the goal closes | in the claim packet for the task | working memory, about 4 chunks |

People never see the words "core", "short" or "long" (R4-03). Agents never choose a layer: they
capture into the inbox, or into the board of the task they hold (R4-04). Moving between layers
is the Consolidator's proposal and the person's Keep.

---

## 3. Tables at a glance

```
workspaces (= brain, owner_user_id unique)
 └── memories (layer fixed; 1 core; 1 board per project)
      ├── entries            identity + head cache (served version, trust, lifecycle, summary)
      │    ├── entry_versions   append-only CONTENT: title, body, kind, valid time, provenance
      │    ├── entry_summaries  append-only: the summary per content version, who wrote it, kept/proposed
      │    ├── entry_events     append-only: trust and lifecycle changes (D22), race-safe
      │    ├── entry_evidence   per content version: episode / entry / url + origin_key (lineage)
      │    ├── entry_links      typed, reasoned, version-pinned, inside one brain
      │    ├── entry_uses       real uses per reader (cited, acted on...): activation later
      │    └── entry_vectors    step 4: one gist vector per entry (+ chunks for long bodies)
      ├── episodes           immutable raw input (chat, report, web page, CI run)
      └── memory_grants      sharing, per memory (step 8, or earlier by D23)
packets / packet_items   what each context packet showed (ids only, 90 days)
goals.memory_id          the board's working memory; tasks inherit through their goal
```

The full SQL is in [sql/01-memory-core.sql](sql/01-memory-core.sql) (steps 1–2),
[sql/02-vectors.sql](sql/02-vectors.sql) (step 4) and [sql/03-sharing.sql](sql/03-sharing.sql)
(sharing).

---

## 4. The key decisions, and why

1. **The brain stays the workspace.** It gets `owner_user_id text UNIQUE`. `projects`, `goals`,
   `tasks`, `run_tokens` and `audit_log` already key on `workspace_id` with composite foreign
   keys. Those keys are what make a row that crosses two brains impossible. Better Auth user ids
   are `text`, so blue-2 and blue-4's `owner_id uuid` could not have held them (R2 key types).
2. **One core per person, enforced three ways:** a partial unique index (at most one), a
   deferred trigger (at least one, checked when the sign-in transaction commits) and a delete
   guard. Tested.
3. **The layer belongs to the memory and never changes.** An entry carries a copy, kept honest
   by a composite foreign key, so per-layer `CHECK`s work on one row.
4. **An entry never moves.** Moving or consolidating creates a new entry in the target memory,
   with a `derived_from` link pinned to the source version. The source is marked
   `consolidated`. Three reasons:
   - A move changes who can read the text without anyone deciding it.
   - Every derived row (vectors, uses, links) would go stale at once (R2-04, R1-09).
   - The verbatim episode and the gist should both survive (psychology: gist vs verbatim).
5. **Three append-only streams instead of one.**
   - `entry_versions` gets a row only when the text or kind changes.
   - Trust and lifecycle changes are `entry_events`.
   - Summaries are `entry_summaries`.

   A re-summary or an approval therefore never copies a 256 KB body (R3-07). It also never
   bumps the version, so it cannot make a person's open edit fail as stale (R4-09).
6. **The head cache is written only from inside triggers** (a `pg_trigger_depth()` check), not
   when a setting is switched on. The blue design let any session switch its guard off with
   `set_config` (R1-10, R2-01, both proven).
7. **What readers get is the last clean version.** A quarantined new version is stored, but the
   entry keeps serving the previous one. Only a person can release it (R1-03).
8. **Fading is computed, not stored.** Short entries have `expires_at`. Retrieval for *agents*
   leaves out expired entries. A person's own search still finds them, and the filter is a
   switch (rule 6, R4-11).
9. **Logs that cannot be backfilled start now** (`entry_uses`, `packets`, `packet_items`,
   `capture_context`). Everything that reads them waits for the step whose exit test needs it.
10. **Per reader, never shared:** uses, activation and packets belong to the person who read.
    A collaborator cannot see what you read, and cannot pump your ranking (R1-05).

---

## 5. Summaries and vectors (owner's rule, 23 Nov)

- **An agent's write must include a summary** for the version it writes (≤ 600 characters, plus
  up to 3 "questions this answers"). A deferred check refuses a commit where a clean version has
  no summary. The Gatekeeper secret-scans it, checks its length and checks that it is not
  instruction-like. A bad summary quarantines **itself**, never the entry (R1-04).
- **A person's write without a summary:** the server writes a `fallback` (title + the first
  ~500 characters, cut at a sentence). It is queued for the Consolidator in
  `summaries_needing_work`. Because a web-only person may never run a Consolidator, the entry
  also gets **body chunk vectors at once** (R4-07).
- **Each summary belongs to one content version.** A summary written for another version is
  refused, not stamped fresh (R2-08). The head can only point at its own entry's summary
  (composite FK).
- **Which summary agents read.** The writer's own summary of its own new text is `kept`. The
  person approves the summary together with the text, and the approval card shows it. A
  steward's or another agent's re-summary is `proposed` and is not served or embedded until a
  person keeps it. Without this rule, an agent could invert an approved decision through its
  summary (R1-04, R4-08). Approving an entry requires a kept summary for that version.
- **Vectors (step 4):** one vector per entry, of title + summary + questions. Chunk vectors (at
  most 8) only for bodies over ~8k characters, or for fallback entries. Use 768 dimensions if
  the Hebrew/English benchmark holds. HNSW only on long memory; short memory uses exact search.
  This cuts vector storage from ~100 GB to ~25 GB at 300 people × 30k entries (R3-04, R3-05).
- Vectors are deleted **in the same transaction** that quarantines, rejects or forgets an
  entry, not later through the outbox (R1-03). Writes from the embedding worker are monotonic,
  so an old job can never overwrite a newer vector (R2-08).
- **Word search** uses the `simple` config with `sb_norm`, which strips niqqud and joins
  gershayim acronyms (צה"ל → צהל). Weights: title A, summary B, body C. Trigram matching runs on
  titles. The migration refuses a non-UTF8 database, where `sb_norm` would erase Hebrew
  (R2-10.7).

---

## 6. Sharing

- **You share one memory at a time.** There are no grants on a whole layer or a tag:
  - A layer grant would silently share memories you create later.
  - It would make consolidation a sharing act.
  - Tag grants would let an agent share something just by tagging it.

  "Share all my notebooks" in the UI writes one grant per memory that exists now (blue-3, upheld
  by R1, R2 and R4).
- **Roles:** viewer < contributor (writes land as proposed) < editor. Admin waits for a real
  need. The owner has no grant row.
- **Core is never shared** (`CHECK (layer <> 'core')`). The owner can mark single core entries
  `in_profile`. Only people who share at least one memory with the owner see them, and only
  approved ones. Only the owner, as a person, can set the flag, and only on core (R1-07, proven).
- **Packets:** your agent loads **your** core, never the board owner's (R1-06). Collaborators'
  unapproved scratch on a shared board goes in its own "from collaborators, unapproved" section
  (R1-14.4). A rule is served as a rule only to agents of the person who approved it.
- **Invites:**
  - An email invite is bound to a person at sign-in, from a verified email (`accountLinking` is
    off, so no takeover).
  - A grant is live only after the grantee accepts it.
  - Terms never change: a role change is a revoke plus a new grant.
  - Every change is audited by the database.
- **The flow rule:** text never moves to a wider audience without a person. It is checked on
  derived writes, Consolidator replay sets, board sealing and grants (R1-08).
- **Enforcement:**
  - Row-level security is the fail-closed default for every query.
  - Search runs through `SECURITY DEFINER` functions owned by a `sky_search` role, with the
    readable-memories filter written inside. Under RLS, Postgres skips the full-text and trigram
    indexes: 490 ms instead of 5 ms, measured (R3-01).
  - Workers get their own `sky_worker` role (R1-02).
  - `sky_app` gets its own login URL, so nothing does a session-level `SET ROLE` through
    PgBouncer (R1-15).
- **Grants cannot go live before RLS is enforced.** `accept_grant` refuses until the
  `rls_enforced` flag is set (R1-02).
- `members` becomes owner-only. All other access is a grant on a non-core memory (R1-06.3).
- **Revoking** stops all reads at once (grants are checked on every statement, with no cache).
  Some things cannot be taken back:
  - What a person already read.
  - Derived copies their agents made. These are flagged "source access revoked" (R1-12).
  - Summaries sent to a third-party embedding provider. The share dialog must say so, or shared
    memories use a self-hosted model.

---

## 7. How memory moves (lifecycle)

```
capture ──► Inbox (short, proposed, expires_at = now + TTL)
              │ used on separate days → expiry stretches          (computed, step 5)
              │ Consolidator proposes a gist / lesson             (step 6, only proposes)
              ▼ person Keeps (one Digest card; "keep all from this goal" = one card)
            Notebook (long): NEW entry, derived_from Inbox@v, source → consolidated
              │ person promotes a stable preference
              ▼
            About me (core): NEW entry written by the person
Board (working): scratch per goal/task ─ goal closes ─► outcome sealed as an episode
                                                        in the board's own audience
```

- **Trust (D22):** agents write `proposed`, web text arrives `quarantined`, and only a person
  approves, rejects, closes or supersedes. Server rules may only quarantine, or mark an entry
  `consolidated` when a person accepts. Repetition is not evidence: independent sources are
  counted by `origin_key` over the evidence and `derived_from` closure (step 6).
- **Reconsolidation:** a used entry that turns out wrong is corrected by a new version (by a
  person) or by a superseding entry (by an agent). Nothing is edited in place, and recall itself
  never edits. Blue-4's "labile window" rule was cut: it was a permission rule with a borrowed
  name (R4-14).
- **Approval load:** one Digest queue with a daily budget (default 10 cards):
  - Agent-made links make no cards.
  - There is no time-based review ladder.
  - Steward re-summaries wait in the queue.

  Without this, the blue designs add up to 60–90 cards a day (R4-10).

---

## 8. Human memory research: what we use, and when

From the research thread's 12 findings and blue-4's sources (each is a switchable signal, kept
only if the benchmark shows a gain):

| Principle | What it becomes | When |
|---|---|---|
| Cue overlap (Tulving & Thomson 1973) | Several cue routes fused with RRF: words on the body, vector on the gist, title trigrams | step 1 (words), step 4 (vectors) |
| Gist vs verbatim (fuzzy-trace) | The episode stays verbatim and immutable; the long entry is a gist with `derived_from` | step 1 |
| Encoding context (Godden & Baddeley 1975) | `capture_context` jsonb on every version; a `context_match` signal later | column now, signal step 5 |
| Only real retrieval strengthens (Roediger & Karpicke 2006) | `entry_uses` logs cited / acted on / confirmed; showing up in a packet counts for nothing | log now, signal step 5 |
| Recency, frequency, spacing (Anderson & Schooler 1991; ACT-R) | Activation per reader from `entry_uses`; one definition, picked at step 5 | step 5 |
| Spreading activation (Collins & Loftus 1975) | 1–2 hops over accepted links, outward from the seeds; fan damping aware of relation type, so topic nodes are not silenced (R4-16) | step 4 |
| Consolidation by replay (McClelland et al. 1995) | The Consolidator proposes gists by replaying new items next to old ones, limited to memories the target's readers can see | step 6 |
| Spacing (Cepeda et al. 2008) | Short-term expiry stretches with use on separate days. "Still true?" checks are event-driven, not a fixed 1/7/30/90 ladder, because spacing research is about forgetting, not about how fast the world changes (R4-13) | step 5 / 6 |
| Capacity (Cowan 2001) | Packet: About me + rules + ~4 gists with drill-down pointers; the budget can grow on request. An analogy, not a law (R4-17) | step 2 |
| Self-schema | Core: small, always loaded, changed only by the person | step 1 |
| Two strengths (Bjork) | Deferred: neither strength changes v1 behaviour (R4-15) | step 5, if measured |
| Source monitoring | `source`, `author`, frozen confidence shown in the fenced packet | step 1 |

---

## 9. Migration from today's tables

1. Add `workspaces.owner_user_id`. Change `onSignIn` from "no `members` row" to "no workspace
   owned by me", and make it create the core, the default inbox and the default notebook in the
   same transaction (R2-10.5).
2. Add the at-least-one-core trigger in the *next* deploy, after that code is live. Otherwise
   sign-ins during the deploy window get no brain, silently (R2-10.3).
3. Today's `entries` has no API and no rows. The migration checks that it is empty, drops it and
   creates the new one, so no legacy copy is needed (R2-10.2).
4. Create a board (working memory) for every existing project **before** `goals.memory_id`
   becomes `NOT NULL` (R2-10.4).
5. **Drizzle:**
   - Generated migrations cover tables, composite FKs and partial indexes.
   - A following `--custom` migration covers what Drizzle can't express: triggers, deferred
     constraints, `ON DELETE SET NULL (col)`, RLS and partitions, the same pattern as
     `0001`/`0004`.
   - The partitioned `entry_vectors` is declared in a schema file outside drizzle-kit's list
     (R2-10.6).
6. HNSW indexes are built by an ops script on the migrate port (`CREATE INDEX CONCURRENTLY`),
   never in the Vercel build (R3-11).

---

## 10. Red team findings and how each was resolved

Severity is the red team's. "Fixed" means the recommended SQL does it. "Later" means the item
moved to the build step that needs it.

### Critical and high

| ID | Finding | Resolution |
|---|---|---|
| R1-01 | Hard forget had no permission check and was executable by anyone (proven). | `forget_entry` takes no actor argument and reads the person from the session. Owner only, human only, refused for strangers with "not found". **Fixed, tested.** |
| R1-02 | Forced RLS starves workers; grants went live before RLS existed. | `sky_worker` role with its own policy; `accept_grant` refuses until `rls_enforced`. **Fixed, tested.** |
| R1-03 | A quarantined new version became the head and was served by vectors. | `served_version` = last clean version; vectors deleted in the same transaction; final query re-checks. **Fixed, tested** (vectors untested: step 4). |
| R1-04 | An agent could replace the summary of an approved entry. | Summary `status`: steward and other-agent summaries are `proposed` until kept. **Fixed, tested.** |
| R1-05 | Use logs and activation leaked between people. | `reader_id` on uses and packets; activation per reader. **Fixed in schema**; policies on those tables follow the same pattern. |
| R1-06 | The owner's core could reach a grantee's packet; core viewer grants. | Packet loads the caller's core; `mg_not_core`; `members` owner-only. **Fixed, tested** (core grant refused). |
| R1-07 | Profile laundering via `in_profile` (proven). | `in_profile` only on core, only set by the human owner, only approved entries served. **Fixed, tested.** |
| R1-08 | The flow rule leaked through 5 side doors. | No moves at all (rule 4); `flow_allowed` checked on replay sets, seals and admin-free grants. **Fixed in design**; `flow_allowed` tested. |
| R2-01 | Guards switched off by `set_config` (proven). | `pg_trigger_depth()` and `in_forget()` (owner of the definer function), not settings. **Fixed, tested.** |
| R2-02 | `FOR UPDATE` plus unique `seq` deadlocked concurrent writes (proven). | `FOR NO KEY UPDATE`; `seq` index not unique. **Fixed** (red-2 tested the fix). |
| R2-03 | Forget left text in many tables; cascades into append-only tables always aborted. | One forget function with an explicit scrub list; `NO ACTION` FKs everywhere; derived entries go to `forget_review`. **Fixed, tested.** Vectors, blobs and backups are listed for step 4/7. |
| R2-04 | A moved entry kept stale `memory_id` on vectors. | Entries never move (immutable `memory_id`, tested). |
| R2-05 | Grant changes race with flow-checked writes. | Per-memory advisory lock, with checks re-run after it. **Fixed in `accept_grant`**; the grant and revoke routes (not written yet) take the same lock. |
| R3-01 | RLS disables full-text and trigram indexes: 5 ms → 490 ms (measured). | Retrieval via `SECURITY DEFINER` functions owned by `sky_search`, filter inside. **Design**; red-3 measured 26 ms. |
| R3-02 | Link walk read every link of every user per query (1.6 s). | LATERAL hops outward from the seeds over indexed `from_entry`/`to_entry`. **Design** (5.5 ms measured). |
| R3-03 | Embedding outbox had no reliable drainer on Vercel. | `ready_at` lease, batched calls, four drainers, dead letter after 8 tries. **Fixed in 02-vectors.sql.** |
| R3-04 | Vectors cost more than all the text (~100 GB). | One gist vector per entry, chunks only for long bodies, 768 dims, HNSW on long only. **Fixed in 02-vectors.sql.** |
| R3-07 | Every version copied the body and rebuilt the tsvector. | Versions only for content; events and summaries separate. **Fixed.** |
| R3-08 | Exposure logs grow ~130 GB a year, duplicated, unindexed cascades. | One `packet_items` table, partitioned by month, ids only, dropped after 90 days. **Fixed.** |
| R4-01 | Steps 4–8 were being built inside steps 1–2. | A column arrives at the step whose exit test reads it; only unrecoverable logs come early. **Adopted** (section 11). |
| R4-02 | Per-memory sharing reorders D21. | Sharing is its own SQL file; it needs a new decision D23 if wanted before step 8. **Open decision** (section 13). |
| R4-03 | People will misread "core/short/long/working". | UI names: About me, Inbox, Notebooks, Board. **Adopted.** |
| R4-04 | Agents asked to choose a layer will choose badly. | Agents write to the inbox or their task's board only. **Adopted.** |
| R4-07 | Web-only people never get a real summary. | Fallback + immediate chunk vectors. **Adopted.** |
| R4-08 | The summary agents read could drift from what the person approved. | Approval needs a kept summary; the card shows it. **Fixed, tested.** |
| R4-10 | 60–90 approval cards a day. | One Digest queue, daily budget, no cards for agent links. **Adopted.** |
| R4-11 | Fading as a stored state can't be switched off. | Computed from `expires_at`, agents only. **Fixed.** |
| R4-18 | 100 benchmark questions can't show one signal's gain. | Pre-register effect sizes; grow to ≥ 300 questions before step 5. **Adopted** (for the benchmark). |

### Medium and low

| ID | Finding | Resolution |
|---|---|---|
| R1-09 | Refile left vectors in the old memory. | No refile (entries never move). |
| R1-10 | Plain UPDATE could approve (proven). | Trigger guard + column-level UPDATE grants, people only. Tested. |
| R1-11 | 14 tables without `memory_id`; partitions skip RLS. | Every content table reaches a memory through its entry; grant only the partitioned parent; CI check. |
| R1-12 | Revocation gaps: blob URLs, stored digests, derived copies, provider retention. | Private blob keys streamed by the server; packets store ids only; "source access revoked" flag; dialog text. |
| R1-13 | Forget residue. | Scrub list incl. `content_hash`, link reasons, summaries, packets; vectors in step 4. Tested. |
| R1-14 | Injection: memory name in the fence, admin rules, unscanned fields, query magnets. | Name charset `CHECK` (tested); jsonb caps; scan every agent-writable field; rules served as rules only to the approver's agents; per-author cap in the top 4. |
| R1-15 | `SET ROLE` through PgBouncer; non-local settings leak. | Own login URL per role; lint ban on non-local `set_config`. |
| R1-16 | RLS policies did not compile (`uuid = uuid[]`). | `::uuid[]` cast. Tested. |
| R1-17 | Definer functions as oracles; forgeable audit rows. | Functions answer only for `app_person()`; audit written by triggers. |
| R1-18 | Cross-person oracles via a shared query-embedding cache. | Cache keyed per person, or no cache. |
| R2-06 | Evidence check broke later versions of an observation (proven). | Evidence checked on content versions only; trust changes are events. Tested. |
| R2-07 | Version rules blocked consolidation and allowed body edits by "resummarize". | Re-summary is its own table; consolidation is a person's event. Tested. |
| R2-08 | Stale summaries stamped fresh; late summaries win; vector overwrite race. | Summary must name the head version; monotonic vector upsert. Tested (summary). |
| R2-09 | Two lifecycle columns; event log could lie. | One epistemic lifecycle (events record `from` themselves); retention is computed. Tested. |
| R2-10 | Migration gaps (name clash, deploy window, backfill, Drizzle, encoding). | Section 9. |
| R2-11 | Three `entry_uses` designs, two rollups. | One `entry_uses`; one rollup chosen at step 5. |
| R2-12 | Grant audit wrote NULL action on a no-op update. | Skips no-ops. |
| R3-05 | HNSW churn on short memory. | No HNSW on short. |
| R3-06 | Exact vs HNSW chosen per scope: a shared slice gets near-zero recall. | Choose per memory slice, merge and re-sort. |
| R3-09 | Per-use updates to the widest row. | Uses go to their own table; no counters on `entries`. |
| R3-10 | Consolidator backlog stops fading. | Fading is computed; queue rows expire with their entry. |
| R3-11 | Index builds can't run in the build-step migration. | Ops script on :6433. |
| R3-12 | Network calls inside the request transaction. | No provider calls inside `withActor`. |
| R3-13 | Hebrew normalizer makes as-of search a scan. | As-of search reads `entry_versions` by time first; acceptable at personal scale. |
| R3-14 | Duplicate indexes. | Removed. |
| R4-05 | "Many short memories" not meaningful in v1. | **Kept, because the owner asked for it**: one default inbox, extra inboxes allowed (e.g. a shared "Family inbox"). |
| R4-06 | Board per project vs per goal. | One board per project, lifecycle per goal. |
| R4-09 | Re-summary made writers fail as stale. | Separate summary table. |
| R4-12 | Moving levels: new entry vs field change. | New entry (rule 4). |
| R4-13 | Review ladder misuses spacing research. | Event-driven checks. |
| R4-14 | "Reconsolidation" was a permission rule. | Cut the labile window. |
| R4-15 | Bjork strengths misapplied. | Deferred to step 5. |
| R4-16 | Fan damping silences topic nodes. | Relation-aware fan. |
| R4-17 | Cowan, CLS, schema fit are analogies. | Labelled as analogies; no columns for them in v1. |
| R4-19 | Too many enums and states. | Five lifecycle values, no retention state machine. |
| R4-20 | Long facts required valid time a person can't give. | `valid_period` optional; required only for observations. |

### What held up under attack

- One core per person: no path to zero or two (tested by three teams).
- D22 in the database: agents cannot approve, change kind, write core or edit approved entries.
- Exposure vs use: a packet appearance never strengthens an entry, so there is no
  rich-get-richer loop.
- Activation never raises trust and never hides binding decisions.
- Email invite takeover: account linking is off, sign-in is allowlisted, and grants need an
  explicit accept.
- Links need both ends readable, at every hop.
- Run tokens are rechecked on every request, and D20 pinning holds.

---

## 11. What gets built when

**Steps 1–2 (now):** `memories`, `entries`, `entry_versions`, `entry_events`,
`entry_summaries` (summary required on agent writes), minimal `entry_links`, `episodes`,
`entry_evidence` (minimal), `entry_uses`, `packets`, `packet_items`, `forget_entry`, word search
with `sb_norm`, and the UI names. Agent surface: `capture`, `search`, `get`, the packet on claim,
`report_task` with evidence and 0–3 proposed lessons, and a Digest with a daily budget.

**Later, each at the step whose exit test reads it:**

| Item | Step |
|---|---|
| `entry_vectors`, embedding models and outbox, hybrid RRF, MMR | 4 |
| Spreading activation (relation-aware fan) | 4–5 |
| Activation per reader, context match, recency prime | 5 (benchmark ≥ 300 questions first) |
| Consolidator queue and proposals table, replay sets, lineage count, Auditor | 6 |
| Layered summaries, cold storage, archive | 7 |
| `memory_grants`, RLS, `sky_search`/`sky_worker`, flow rule, profile slice | 8, or earlier by D23 |

**Cut:** the stored fade state machine, the fixed review ladder, the labile window, schema-fit
columns, and per-layer grants.

---

## 12. Tests

The SQL was run on PostgreSQL 16.15, on top of migrations 0000–0004. All 46 checks pass: 27 for
the memory core, 6 for sharing before it is switched on, and 13 for live sharing and forget.
Every refused case asserts its error message.

```
psql -U postgres -d sb -f apps/server/drizzle/0000_schema.sql   # ... through 0004
psql -U postgres -d sb -f docs/vision/schema/sql/01-memory-core.sql
psql -U postgres -d sb -v ON_ERROR_STOP=1 -f docs/vision/schema/sql/90-tests.sql
psql -U postgres -d sb -f docs/vision/schema/sql/03-sharing.sql
psql -U postgres -d sb -c "GRANT SELECT ON feature_flags, audit_log TO sky_app"
psql -U sky_app  -d sb -v ON_ERROR_STOP=1 -f docs/vision/schema/sql/91-tests-sharing.sql
psql -U postgres -d sb -c "INSERT INTO feature_flags VALUES ('rls_enforced', now())"
psql -U sky_app  -d sb -v ON_ERROR_STOP=1 -f docs/vision/schema/sql/92-tests-sharing-live.sql
```

**Not run:**
- `02-vectors.sql`: pgvector is not installed on the test box.
- PGlite, which the repo's tests use.
- The race tests, which red-2 ran on blue SQL with the same fixes.

When this is built, the checks become Vitest tests, each with an allowed and a refused case.

---

## 13. Open decisions for the owner

1. **Sharing before step 8?** D21 puts sharing at step 8. Your request moves it earlier. It is
   ready as its own file, so this needs a new decision (D23) if you want it sooner.
2. **Embedding model and dimension:** 768 (cheaper, needs a model that supports it) or 1024. The
   Hebrew/English benchmark decides. For shared memories, use a self-hosted model so summaries
   never leave our servers?
3. **Roles:** is viewer / contributor / editor enough for v1, with admin later?
4. **Profile slice:** who sees the "About me" entries you mark as profile: everyone who shares
   any memory with you (the proposal), or chosen people only?
5. **Digest budget:** default 10 cards a day?

Two things to confirm with Zakai (Nanogres): that the migrate role can create NOLOGIN roles
(`sky_search`, `sky_worker`), and that `sky_app` can have its own login URL.
