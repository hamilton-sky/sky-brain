# Red 4: product sense, cognitive validity and over-engineering

Lens: does the four-level design make sense to a person (a lawyer, a parent) and to an agent; does
it respect BUILD-PLAN (D21 step order, rule 6 "each mechanism switchable and benchmark-gated",
D22); which psychology claims are misapplied or cannot be tested; what the summary-only vector
rule costs; how many approvals a person will face; and what can be cut from v1 without closing a
door. Targets: blue-1 (data model), blue-2 (retrieval), blue-3 (sharing), blue-4 (lifecycle).

Severity scale: critical = ships a broken product or breaks a decided rule; high = large wasted
build or a user-visible failure; medium = a real defect with a cheap fix; low = wording or tuning.

---

## 0. Verdict in one screen

1. **Size.** Together, the four designs add about 30 tables, 15 enums, roughly 20 triggers, RLS on every content
   table, 32 hash partitions, and 9 ranking signals. BUILD-PLAN step 1 asks for: extend `entries`,
   `entry_versions`, `links`, `episodes`, a Gatekeeper, `capture/search/get`, and Hebrew word
   search. Most of the blue work belongs to steps 4–8 and is pulled into step 1–2 (R4-01).
2. **The four levels are fine as storage, wrong as UI and as agent choices.** People should see
   About me, Inbox, Boards, and Notebooks. Agents should never pick a level. They write to the inbox, or to the
   board of the task they hold (R4-03, R4-04).
3. **"Many short-term memories" adds a second axis (topic × level) that nobody needs in v1.**
   Ship one inbox per person. Keep the schema open to more (R4-05).
4. **One working memory per project is right.** Blue-4 assumes one per goal, which contradicts it. Fix: the container is per
   project and sealing is per goal (R4-06).
5. **Sharing per memory is step 8 under D21.** The owner's new requirement pulls it forward. That
   needs a new decision entry, not a silent reorder (R4-02).
6. **The approval load is about 60–90 cards a day for a developer with two agents.** The designs
   multiply sources of proposals (lessons, Consolidator, links, review ladder, re-summaries, flow
   overrides) with no shared budget. Second brains die from upkeep (VISION, PO row) (R4-10).
7. **Psychology:** the review ladder, reconsolidation, Bjork's "effortful retrieval", CLS
   interference, and schema fit are misapplied. Cowan's 4 and the ACT-R parameters are borrowed
   defaults, not findings about agents. With about 100 benchmark questions, no single signal's gain can be
   shown or refuted. As written, rule 6 cannot be falsified (R4-12 to R4-18).
8. **Summary-only vectors.** Yes for agent writes. But a person who only uses the web UI and has no
   connected agent never gets a real summary, because the Consolidator runs in their model. Embed
   body chunks for fallback entries at once. Also, the summary agents read must be the one that was
   approved (R4-07, R4-08, R4-09).

---

## 1. Findings

### R4-01 (critical): Steps 4–8 built in steps 1–2, against D21

**Where:** blue-1 §11.2 M1–M3 and §4.1; blue-2 §10; blue-4 §11.

**What happens.** D21 says "each step must be in daily use before the next one starts", and the
plan reaches its measure gate (step 3) before any search tuning. The blue designs put these into
step 1 or 2:

| Mechanism | Blue file | Placed at | BUILD-PLAN step |
|---|---|---|---|
| `review_due_at`, review ladder 1/7/30/90/180/365 | b1 §4.1, b4 §6.5 | step 1 columns | 6 |
| `consolidate_into`, `needs_summary` queue | b1 §4.1 | step 1 | 6 (no consumer until then) |
| `core_rank`, `max_items`, `token_budget` + "core is full" trigger | b1 §3, §4.3 | step 1 | 7 ("about me" card) |
| `salience` / `importance` | b1 §4.1, b4 §8 | step 1 | 5–6 |
| `retrievals` + `retrieval_hits` with `signals jsonb` and weights | b2 §6.1 | step 1 | 4–5 |
| `sb_he_variants` (Hebrew prefix stripping) | b2 §3 | step 1 | benchmark-gated, step 4 |
| Lifecycle: 8 states, `lifecycle_transitions`, `entry_lifecycle_events` | b4 §2.3 | step 1 | 6–7 (fade, archive, merge) |
| `entry_stats` cache + trigger (n_use_days, fades_at, recent_uses) | b4 §4.2 | step 1 | 5 |
| `proposals` with 12 ops incl. merge, core_add, new_topic | b4 §6.3 | step 2 | 6 |
| Short fade sweep (state change) | b4 §5 | step 2 | 5–7, and rule 6 (R4-11) |
| `sources` + recursive lineage CTE | b4 §6.4, b1 §12.3 | step 1–2 | step 2 needs "rests on one source"; the full closure is step 6 |
| `memory_grants`, RLS, roles, flow rule, profile | b1 M6, b3 all | step 1 migration plan (b3 §10) | 8 |
| 32-way hash partitions of `entry_vectors` | b2 §4.3 | step 4 | not needed for an email-allowlisted user count |

Each early column also brings write paths, Gatekeeper rules, and refused-case tests (blue-1 §14.6
lists 11 refused-path tests for triggers alone). Columns with no consumer are written wrongly and
never noticed until step 6 needs them, by which time the data is bad.

**Smallest fix.** One rule: *a column or table goes in at the step whose "done when" test reads
it.* The exception is data that cannot be recovered later. That data is cheap to log and is listed in §3 as
"keep now".

### R4-02 (high): Sharing per memory reorders D21 without a decision

**Where:** blue-3 (entire), blue-1 M6, brief requirement 3.

D21 says Sharing (ROADMAP layer 4) "waits until this sequence reaches step 8; each needs its own
decision then". The owner's new requirement 3 is a valid change of mind, but blue-3 §10 also retires
`workspaces/members/invites` and turns on forced RLS for every route. That is the largest
read-path change in the repo, and it lands before the loop is proven.

**Fix.** Write D23: "Sharing per memory moves from step 8 to step 2b, minimal form." Minimal form:
owner plus `viewer`/`editor` grants on non-core memories, memory-level only, no `admin`, no
`contributor`, no profile, no connector limits, `workspaces` kept as the brain root (blue-1 wins
over blue-3 here). RLS can come in the same step as defence in depth, but the
`members` → grants migration waits. If the owner does not want sharing before step 3, keep
`memory_id` on every content row (cheap, needed anyway) so that grants can be added later without a
rewrite.

### R4-03 (high): The four level names will be read the wrong way by people

**Where:** brief "four memory levels"; blue-4 §1 (renames only `short` to "Recent").

A lawyer or a parent reads "short-term memory" as "things I'll forget soon" and "working memory"
as "what I'm thinking about". Neither matches. Here, short is days to weeks and is an *inbox*, and
working is a *task board*. "Core memory" sounds technical, and "long-term memory" sounds like a
backup. VISION's designer row already decided this: "Users never see floating / working / deep.
They see Inbox, Board, Memory and a daily Digest."

**Fix (UI and docs only; schema names can stay):**

| Schema | Shown to people | Shown to agents (tool docs) |
|---|---|---|
| core | **About me** | "the owner's standing profile and rules; read-only to you" |
| short | **Inbox** | "where your captures go" |
| working | **Board** (per project) | "your claimed task's scratch space" |
| long | **Notebooks** (named: Work, Kids, Health) | "approved knowledge; you propose, the person keeps" |

The word "memory" appears only in the product name.

### R4-04 (high): Agents are asked to choose a memory and a level, and they will choose badly

**Where:** blue-1 §2 (`item_types.layers` allow-list), §4.3 (`item type % is not allowed in %
memory`); blue-1 §5 "long: people approve; agents propose"; blue-4 §3.

**Failure.** An agent finishing a task calls `capture` with a decision it reached with the user.
It has to pick one of N long memories plus a layer-legal `item_type`. With "Work", "Clients",
"Client-Cohen" and "general" available, two agents file the same fact in two notebooks. The
near-duplicate check (`content_hash`) misses paraphrases, and the item-type allow-list throws an
error the agent must parse and retry. Every misfile later costs the person a refile.

**Fix.** Agents never choose a level:
- Under a claimed task, a write goes to that project's working memory, scoped to `goal_id`/`task_id`.
- Otherwise, a write goes to the inbox (the default short memory).
- The agent *may* suggest a notebook (`suggested_memory_id`, the same idea as blue-1's
  `consolidate_into`). Only the person's Keep files it into long (blue-4 §3 "short → long, as-is").
- Drop the per-layer `item_types.layers` allow-list from v1. Keep `item_type` as free data with a
  small seed (rule 7).

This also kills a whole class of permission bugs. Agents never write to long directly, so the
flow rule (blue-3 §7.1) is checked only on the person's Keep.

### R4-05 (medium): "Many short-term memories" is not meaningful in v1

**Where:** brief requirement 2; blue-1 §3 (`default_ttl` per short memory); blue-3 §4.2 ("shared
inbox for a family, a meeting").

Short-term is a *stage*, not a *topic*. Allowing many shorts creates a topic × stage grid: a parent
who wants to share "Kids" now needs the Kids notebook, a Kids inbox and a Kids board, which is three
containers and three grants. Each capture also has to be routed to the right inbox, so the agent's
problem from R4-04 comes back. The only real use case is "a shared inbox with my spouse". That is
better served by letting the spouse's captures land in *their own* inbox, followed by a Keep into
the shared Kids notebook.

**Fix.** v1 creates exactly one short memory per person (`is_default`, already in blue-1). The
API refuses to create more. The schema keeps `layer='short'` on `memories`, so more inboxes can be
allowed later by removing one check: no door is closed. The owner's "many short memories" becomes
a later item, triggered by a real shared-inbox need.

### R4-06 (medium): Blue designs disagree on the unit of working memory

**Where:** blue-1 decision 9 (one per project, `memories_one_working_per_project`); blue-4 §1 and
base model (`memories.goal_id`, "one per active goal", "closes with the goal"); blue-2 §0 ("may
point at a goal or task").

**Failure.** If working is per project, blue-4's "working memory closes when its goal is done or
idle 7 days" closes the whole project board when the first goal finishes. If working is per goal, blue-1's
`goals.memory_id` FK and blue-3's "grant a working memory = share the board" mean a grant per goal.
A parent sharing "Trip to Rome" would then have to re-share every new goal.

**Ruling (product):** blue-1 is right. The container is per project, which is the sharing unit
people understand ("share the Rome board"). The *lifecycle* is per goal: sealing, episode writing
and scratch expiry key on `entries.goal_id`. Blue-4 §5 must read "a goal's scratch closes" instead
of "a working memory closes". A non-code project needs a project row, and `git_remote` is already
nullable, so this is fine. Hide "project" behind "New board" in the UI.

### R4-07 (high): People who only use the web UI never get a real summary

**Where:** blue-1 §4.2 (fallback summary + `needs_summary` → Consolidator); blue-2 §2.1, §4.1;
owner decision 23 Nov.

**Failure.** sky-brain calls no LLM, and the Consolidator runs in the *person's own model*. A
parent or lawyer who uses only the web app has no connected model, so the Consolidator never runs
and every entry they type keeps its fallback summary forever: title plus the first ~500 chars. For a
pasted contract or school letter, the first 500 chars are boilerplate ("This Agreement is made on…",
"Dear parents,"). The summary vector then matches every contract and no question. Before step 6,
*everyone's* human-written entries are in this state. The step-4 gate ("hybrid beats word search")
is therefore measured on a corpus where human entries have bad vectors, and the result is biased
against vectors.

**Fix.** The owner rule allows "summary (or chunks)". For `summary_by='fallback'`, embed body chunks
(blue-2 §4.2's chunker, lowered from >2,000 chars to >600 chars for fallback entries) and *do not* embed the
fallback summary. When a real summary arrives, add its vector, and keep or drop the chunks by the same
size rule as agent writes. The web UI offers an optional "one-line summary" field. That turns a
person's first sentence into a writer summary, at no cost.

### R4-08 (high): The summary agents read can drift from the text the person approved

**Where:** blue-1 §4.2 ("resummarize" is the one change an agent may make to an approved entry),
§14.1; blue-2 §2.3, §12.1.

**Failure.** The packet shows summaries, not bodies (BUILD-PLAN step 2, b2 §8). A person approves
decision D by reading its *body* in the Digest. Later the Consolidator re-summarizes D:
"We chose Render for hosting" becomes "Hosting is undecided between Vercel and Render". The content hash is unchanged,
so blue-1's trigger allows it, and every agent now receives the steward's wording under an
`approved` label. Blue-2's mitigation is a Digest card. That card adds load (R4-10), and the drift
is live until someone clicks it. This also undermines D22's "only an approved item is used as ground truth":
the item is approved, but its served text is not.

**Fix (one rule).** A summary has its own trust. The packet serves the newest summary whose author is
a person, or which existed when the entry was approved (`summary_id` pinned at approval). A
steward summary of an approved entry is stored but not served until the person keeps it. Show the
summary *next to* the body on every approval card, so the person approves what agents will read.
This needs blue-2's separate `entry_summaries` table, not blue-1's "summary on the version" (see
R4-09).

### R4-09 (medium): Re-summarizing an entry mints a new version, so active writers get stale-write errors

**Where:** blue-1 §4.2 (`change='resummarize'` is a new `entry_versions` row) and §4.3
(`IF NEW.version_no <> e.head_version + 1 THEN RAISE 'stale write'`).

**Failure.** Agent A reads entry E at v3 and starts an edit. Overnight, the Consolidator re-summarizes
E, which writes v4. A's edit, sent as v4, is refused as `serialization_failure`, although no content
changed. Each Consolidator run raises false conflicts for every agent working on those entries. Steward
re-summaries also inflate `entry_versions`, and the as-of history then shows "versions" that
nobody would call a change.

**Fix.** Use blue-2's design: an append-only `entry_summaries(entry_id, for_version, …)` table, with
`entries.summary_id` as part of the head cache. A re-summary does not bump `head_version`. Blue-1's
four summary columns on `entry_versions` move there. Rule: summaries belong to a version but are not
versions.

### R4-10 (critical): Approval load. About 70 cards a day, with no shared budget

**Where:** blue-4 §6.3 (`max_proposals` 20 per run), §6.5 (ladder), §7; blue-1 §6 (steward/agent
links born `proposed`, person accepts), §5 (`consolidate_into` review queue); blue-2 §2.3 (Digest
card per agent summary of an approved item), §8.2 (only accepted links spread); blue-3 §7.1 (owner
confirms each flow widening), §4.1 (contributor writes land `proposed`); BUILD-PLAN step 2 (0–3
lessons per goal).

**Estimate.** A developer with two agents, about 8 tasks and 3 finished goals a day, approving about 3
decisions a day:

| Source | Per day |
|---|---|
| Lessons and observations from `report_task` (0–3 per goal) | ~5 |
| Agent captures waiting for Keep (inbox → notebook) | ~10 |
| Consolidator proposals (budget 20 per run, nightly) | up to 20 |
| Proposed links (only accepted links spread in step 4, so they must be accepted to help) | 10–30 |
| "Still true?" cards: 3 approved decisions/day × ladder steps 1, 7, 30, 90 (+180, 365) | 12–18 at steady state |
| Steward re-summaries of approved items (b2 §2.3) | ~3 |
| Quarantine releases (web clips), core_add, flow confirmations, refiles | ~3 |
| **Total** | **~60–90** |

At 30–60 seconds per card (read the body *and* the summary, R4-08), that is 30–90 minutes a day. REVIEW
§5 asks to measure "approvals you had to give"; the designs add sources faster than they can be measured.
For a parent using the web only: no agents, so few cards, but also no Consolidator (R4-07).

**Fix (rules, no new tables):**
1. **One daily card budget per person** across all sources (default 10), ordered by one priority. Every
   source writes into one Digest queue. Anything past the budget stays `proposed`. That is a normal state,
   not a failure: it is still served as labelled information (D22).
2. **Links made by a server rule** (`derived_from` from consolidation, `part_of` task → finding, `answers`)
   are born accepted, as blue-1 already says. **Agent and steward links get no card.** They act as
   a low ranking weight (blue-1 §6 already proposes "ranking weight on proposed links"). A person
   sees a link only when it is a `contradicts` link touching an approved item.
3. **No time-based review ladder in v1** (see R4-13). Reviews are event-driven: a contradiction, a
   dependency superseded, or `valid_period` ending.
4. **Batch keep:** "Keep all 3 lessons from goal X" is one card.
5. **Consolidator budget 5 per run** until the benchmark shows the cards are kept more than half the time.
   Log `kept_rate` per source and cut any source under 30%.
6. Add "cards per day" and "minutes per day" to the step-0 metrics, with a ceiling the owner sets.

### R4-11 (high): Fading is a lifecycle state, so it cannot be switched off (rule 6)

**Where:** blue-4 §2.3 (`active → faded` by the nightly sweep), §5; blue-1 §4.1
(`entries_short_fades`: short must have `expires_at`).

**Failure.** Rule 6: "each cognitive mechanism is a ranking signal or a packet field… can be switched
off, and stays only if the benchmark shows it helps". Forgetting is a cognitive mechanism. In
blue-4 it is a state transition written by a job, with an event row, before the benchmark exists
(step 2). Switching it off does not bring items back: they are already `faded`, and after 90 days
`archived` with their body moved to cold storage. For a parent, "Noa's shoe size is 31" typed into the
inbox drops out of search after 14 days (blue-4) or 30 days (blue-1), and the user's conclusion
is "it forgot what I told it". VISION's own habit list starts with "drop things in". A person's own
captures are intentional, not noise.

**Fix.** Fading is computed at read time, the same way `expired` is computed today in `entries-view.ts`:
`fades_at < now()` lowers rank and removes the item from *agent packets*. It never removes the item from the person's own
search or Inbox list. Store `fades_at` (or `expires_at`) only. No `faded` state, no sweep, no
transition table. Archiving to cold storage is step 7 and is a storage decision, not a lifecycle
state. Human captures get no fade by default. Agent captures fade.

### R4-12 (medium): Blue designs disagree on whether moving levels makes a new entry

**Where:** blue-1 decision 8 and §7 (an entry never changes layer; consolidation always makes a new
entry; the source becomes `consolidated`); blue-4 decision 2 and §3 (as-is Keep is a `memory_id`
change recorded as a version; new entry only when the words change).

**Product failure of blue-1.** A person reads an inbox note they wrote ("Court date moved to 5
Jan") and clicks Keep → Clients. Under blue-1 they get a *second* item in Clients, and the original
stays in the inbox marked "consolidated". They now see the same sentence twice, with two ids,
split use history, and two places to correct it. Everyone expects Keep to move the item.

**Ruling.** Blue-4's rule of thumb wins: *if the words change, it is a new entry with
`derived_from`; if only the home changes, it is a new version with a new `memory_id`.* Blue-1's
reasons still hold where they apply. Permissions are covered because the person, not an agent, makes
the move, and the flow rule is checked on it. Layer constraints are covered by setting
`expires_at := NULL` and requiring valid time on the moving version. Mechanics: keep `layer` on
`entries` as head cache (blue-1's composite FK is good), but take it out of the immutable identity
set in `entries_guard`, and let the version trigger change it only when `changed_by_kind='human'`.
Agents still cannot move across layers.

### R4-13 (medium): The spaced "still true?" ladder borrows spacing research for the wrong question

**Where:** blue-4 §6.5 (1, 7, 30, 90, 180, 365 days; every core item yearly); blue-1 `review_due_at`;
BUILD-PLAN step 6 (1/7/30/90); psych finding 10.

**Misapplication.** Cepeda et al. (2008) and Karpicke & Roediger (2007) are about when a *learner* should restudy
material so that *the learner* retains it. Whether a decision is still true depends on how fast the
*world* changes: hosting choices, court dates, a child's school. It does not depend on how fast a person forgets. A
"still true?" card one day after the person approved a decision tests nothing, because nothing has changed, and it
costs a card (R4-10). The ladder cannot be falsified as a memory mechanism: a "still true = yes"
outcome is always available.

**Fix.** v1 has no ladder. Reviews are triggered by events: a `contradicts` link to the item, a source or
dependency superseded (blue-1 §12.4 already finds these), the end of `valid_period`, or the item
showing up in a packet for a task that then failed. A time-based check, if any, is one per item at
a horizon the person picks ("check yearly"). The ladder can come back as a step-6 experiment
measured by "how many cards found a real change".

### R4-14 (medium): "Reconsolidation" here is a permission rule with a borrowed name

**Where:** blue-4 §7 and `proposals.via_use_id` CHECK; decision 10; psych finding 8.

Nader, Schafe & LeDoux (2000) show that a *retrieved fear memory in rats* needs protein synthesis to
re-stabilize. Its sky-brain analogue, "an agent may propose a revision only if it logged a use of
the item within this lease", is a sensible anti-vandalism rule, but the psychology adds nothing and
it blocks the cases that matter most:
- the Auditor (step 6) finds a contradiction between two items it never "used" in a task: refused;
- a test failure contradicts a decision that was not in the packet: the agent must first `get` the item
  just to be allowed to object, which games the use log (`opened` raises activation, b4 §4.2).

**Fix.** Drop `via_use_id`. The real guard already exists: optimistic concurrency (the proposal names
the version it read, blue-1 §4.3) plus proposals-only (D22). Describe it as "you must say which
version you are contradicting", with no psychology claim attached.

### R4-15 (medium): Bjork's two strengths. One is misapplied, and neither does anything in v1

**Where:** blue-2 §6.1, §6.3 ("effortful retrieval counts more": a use reached at low rank or via
a hop gets ×1.25); blue-4 §4 (storage strength = distinct use days; fade only when both are low);
psych finding 1.

- **Misapplied:** "desirable difficulty" is about the *learner's effort* in recalling. An entry
  that an agent found at rank 18 involved no effort by anyone. The ranking was poor. Rewarding
  low-rank uses is a reasonable ranking-correction heuristic (similar to click models). Call it that and
  gate it in step 5.
- **Two definitions:** blue-2 uses a weighted sum with a spacing bonus, and blue-4 uses distinct UTC days.
  They will rank differently. Pick one if this is kept.
- **No effect in v1:** a never-used item has both strengths low, so "fade only when both are low" equals
  "unused items fade". The only behavioural difference is "used on ≥ 3 days → enqueue for consolidation" (b4 §5),
  which is a one-line rule on `entry_uses` and needs no strength model.

**Fix.** v1 keeps the `entry_uses` log (it cannot be backfilled). `entry_stats` and `entry_strength`
are step 5, with one definition.

### R4-16 (medium): Fan damping cancels the schema nodes blue-4 wants

**Where:** blue-2 §7 `hop1` (`greatest(0, 2 - ln(fan))`), §8.2 ("a hub with more than ~7 links
spreads nothing"); blue-4 §6.2 and §9 (topics as schema nodes; "promotion to long requires ≥ 1
`about`/`part_of` link to a topic").

**Failure.** Blue-4 makes every long item link to a topic. After 8 items, topic "Hosting" has fan ≥ 8,
so `2 - ln(8) = -0.08`, which clamps to 0, and the topic spreads nothing. The design's two halves cancel: the
schema node that should bring up related decisions is exactly the node damping silences. S = 2 is
ACT-R's default for small lab fact sets, where the fan is 1–3.

**Fix.** In step 4, damp by fan *per relation*, excluding `part_of`/`about` (topic membership), or
scale S with log(memory size). Better still, leave hops out of step 4 entirely and add them in step 5 as their own switch
(BUILD-PLAN puts hops in step 4; they are a cognitive signal and should be ablated separately).

### R4-17 (low): Cowan's "4 chunks", CLS interference, schema fit, and RIF are analogies, not findings

**Where:** b2 §8, b4 §6.2 and §8, b1 §5, psych 7, 9, 11.

- **Cowan (2001)** limits a *person's* focus of attention. An agent's context holds 100k+ tokens.
  "~4 chunks" is a fine starting budget, but call it a default token budget to tune (REVIEW D:
  "minimum sufficient context"), not a psychological limit.
- **CLS / catastrophic interference** is a property of neural networks with shared weights. Adding a
  row to Postgres causes no interference. The useful part of the idea is "check a new gist against its
  old neighbours for contradictions" (b4's replay set). Keep that and drop the justification.
- **Schema fit (Tse 2007)** comes from rats learning paired associates on a known spatial layout. The proxy
  "share of top-10 neighbours under one topic" cannot be checked against anything a person would
  notice. Cut it from v1 and from step 6 unless step 6 keeps a measurable "time to Keep".
- **Retrieval-induced forgetting** is suppression in human memory, and database rows are not suppressed. MMR is
  justified by redundancy in the packet. That is enough reason.
- **ACT-R `d = 0.5`** was fitted to human lab data. For an item with 0–2 uses (most items), `B` reduces to
  about `−0.5·ln(age)`, which is a recency term. Blue-2 then *also* adds a 72 h recency term for short items.
  Two recency signals are counted twice. Gate both, and expect activation to show no gain until use logs are
  dense.

None of these is wrong to try. The defect is presenting them as settled, which makes them hard to
remove when the benchmark is silent.

### R4-18 (high): Rule 6 cannot be tested with a 100-question benchmark

**Where:** BUILD-PLAN step 0 and step 5; blue-4 §11 ("every ranking mechanism is a row in
`ranking_signals`"); blue-2 §10.

**Problem.** With n = 100 questions and baseline accuracy ~70%, the 95% interval on the difference
between two independent runs is about ±13 points (√(2·0.21/100) × 1.96). A paired comparison is
better but not enough. If a signal helps 10 questions and hurts 5, McNemar gives p ≈ 0.30. Typical
gains from activation, context match, or hops are a few points, so every "keep only if it helps"
decision will come from noise. Rule 6 then fails both ways: useless signals stay, and useful ones go.

**Fix.**
- Pre-register per signal: the metric, the minimum effect worth its cost (e.g. +5 points on
  "decisions kept" or −20% tokens), and the test (paired McNemar on the same questions, 3 seeds).
- Grow the set to 300 or more questions before step 5. Unseen-project tasks (Pathly) and long-running tasks
  count. Add 15–20 Hebrew and cross-language questions (b2 §4.4).
- Default every signal to **off** (blue-4 already does). A signal that cannot show its effect stays
  off. That is what "stays only if the benchmark shows it helps" means.
- Merge blue-2's `$10 jsonb` weights and blue-4's `ranking_signals` table into one config. Two
  switch mechanisms will drift apart.

### R4-19 (medium): Too many enums and states for v1

**Where:** blue-1 §2 (10 enums: `memory_state`, `entry_lifecycle` with 6, `entry_origin`,
`version_change` with 8, `summary_origin`, `link_relation` with 9, `link_status`, `link_maker`, …);
blue-4 §2 (8 lifecycle states, which conflict with blue-1's 6); blue-3 (5 roles).

Every enum value is a branch in the Gatekeeper, a test, and a UI label. Postgres enum values cannot
be removed without a type rewrite, so each speculative value is permanent.

**Fix (v1 values):**
- lifecycle: `active`, `superseded`, `closed`, `rejected`. Fade is computed (R4-11). `merged`,
  `sealed`, `archived`, `consolidated`, and `retracted` wait for the step that writes them.
  Forgetting is `forgotten_at`.
- link relations: `supersedes`, `derived_from`, `contradicts`, `answers`, `related`.
- roles (if sharing is pulled forward): `viewer`, `editor`.
- `version_change`: drop the enum and derive it. It can be computed from the diff of two versions.

Use `text` with a `CHECK` for the values most likely to grow (origin, item_type, use_kind), because
`CHECK` constraints are easy to widen.

### R4-20 (low): Long-term facts require valid time, which a person cannot supply

**Where:** blue-1 `ev_long_valid_time`.

A lawyer keeping "Client prefers email" is asked "since when?". The server should default the lower
bound to `recorded_at` and mark it `valid_assumed`. Only `observation` (D22) must state its own time.

---

## 2. Rulings on the known inconsistencies (from this lens)

| Inconsistency | Ruling | Why |
|---|---|---|
| Layer on the entry and "consolidation = new entry" (b1) vs level on the memory and "move = `memory_id` change" (b4) | **b4's rule, b1's mechanics** (R4-12): as-is Keep moves via a new version; changed text makes a new derived entry. `layer` stays as a head-cache column with b1's composite FK, and a human version may change it. | A person clicking Keep expects one item, not two. |
| Per-layer grants (b1 leaves room) vs none (b3) | **b3**: memory-level only. Drop `memory_grants.layer` and `grants_core_read_only`. | "Share all my long-term memory" is not something a lawyer or parent thinks. Layers change over time (b3 §2). |
| Workspaces kept as the root (b1) vs migrated into memories and grants (b3) | **b1 for v1.** Keep `workspaces` as the brain root, add `owner_user_id`, and don't migrate `members`/`invites` until sharing ships (R4-02). | It cuts the largest risky migration from v1 and closes nothing. b3's migration can run later. |
| Working memory per project (b1) vs per goal (b4) | **Per project, lifecycle per goal** (R4-06). | Matches "share the board" and the board's lock and run-token scope. |
| Summary on `entry_versions` (b1) vs `entry_summaries` table (b2) | **b2** (R4-09). | No false stale-write conflicts, and summary trust can be pinned (R4-08). |
| Two strength definitions (b2 vs b4) | Defer both to step 5 and pick one then (R4-15). | Neither changes v1 behaviour. |
| Fade as computed (b1 `expires_at`) vs state + sweep (b4) | **Computed** (R4-11). | Rule 6, and person captures stay findable. |
| `proposals` table (b4) vs `trust='proposed'` as the queue (b1) | v1: **trust on entries is the queue.** A `proposals` table arrives in step 6 for multi-target operations (merge, revise). | Step 2's Digest only needs "list proposed items; Keep, Wrong, Undo". |

---

## 3. Recommended MINIMAL v1 (BUILD-PLAN steps 1–2, plus the owner's 23 Nov requirements)

### Keep now (build in steps 1–2)

**Containers**
- `memories(id, workspace_id, layer, slug, name, project_id, is_default, state, created_by, created_at)`.
- One core per brain (partial unique index), created in `onSignIn` with the default inbox and the default long notebook. Delete guard on core.
  b1's deferred "at least one" trigger is optional; the `onSignIn` test covers it.
- One working memory per project (b1's unique index), created with the project; `goals.memory_id`.
- Exactly one short memory (the inbox) per person in v1, enforced by the API, not the schema (R4-05).
- `workspaces` stays the root; `owner_user_id` is added (b1 §1).

**Content**
- `entries` (identity + head cache) and append-only `entry_versions` (b1 §4) with: kind, trust,
  lifecycle (4 values), title, body, `valid_period`, `recorded_at`, author / changed_by /
  on_behalf_of, `origin`, `capture_context jsonb` (one column, not six; it cannot be recovered later).
- `entry_summaries` (b2 §4.1), append-only, with `for_version`, `source`, and `written_by`. Summary
  required on agent writes. Gatekeeper checks length, secret scan, and quarantine only (b2 §2.2's
  "not the opening" and overlap heuristics are optional). Summary pinned at approval (R4-08).
- `entry_links`, minimal: relation (5 values), status, reason, made_by_kind, `to_version` pin for
  `derived_from` and `supersedes`. Rule links are born accepted; agent links stay proposed and get no card.
- `episodes`, immutable (BUILD-PLAN step 1 names it).
- `entry_evidence`, minimal: episode / url / commit / entry ref plus `origin_key`. Enough for step 2's
  "rests on one unverified source". The full recursive lineage query waits for step 6.
- Gatekeeper rules from D22 with refused-case tests (agent cannot approve, change kind, write core,
  or edit approved), and optimistic concurrency on versions.

**Search (step 1)**
- `simple` tsvector with `sb_norm` (niqqud, gershayim), trigram on title. `english` stems at low weight
  are fine. Prefix variants are benchmark-gated (step 4).

**Logs that cannot be backfilled (cheap, step 1–2)**
- `entry_uses` (entry, version, use_kind, actor, task_id, at, retrieval/packet id). No trigger, no cache.
- `packet_items` (b4 §4.2): what each packet showed, with `score_parts`. Needed by step 2 audit and step 3.

**Agent surface**
- `capture` writes to the inbox, or to the claimed task's board scratch (R4-04); `search`; `get`; packet on
  claim; `report_task` with evidence and 0–3 proposed lessons. The Digest is one queue with a daily
  budget (R4-10).

**UI names:** About me, Inbox, Board, Notebooks (R4-03).

### Later (each at the step whose "done when" test reads it)

| Item | Step | Source |
|---|---|---|
| `entry_vectors`, `embedding_models`, `embedding_jobs`, `cue_vectors`, chunk vectors (fallback entries chunk-embedded immediately, R4-07), question vectors | 4 | b2 §4 |
| Hybrid RRF; MMR | 4 | b2 §7 |
| Hash partitions of vectors | when one partition's exact scan exceeds the latency budget | b2 §5 |
| Spreading activation and fan damping, as its own switch with relation-aware fan (R4-16) | 5 | b2 §7, b4 §8 |
| ACT-R activation, `entry_stats` / `entry_strength` (one definition), recency prime, context match, binding floor, one signal config | 5 | b2 §6, b4 §4 |
| Pre-registered effect sizes and ≥ 300 questions (R4-18) | before 5 | BUILD-PLAN step 0 |
| Consolidator queue, `proposals` table (merge, revise, gist), replay set, steward re-summaries (served only after a Keep) | 6 | b4 §6 |
| Event-driven "still true?" reviews. A ladder only as a measured experiment (R4-13). | 6 | b4 §6.5 |
| Auditor report; the full recursive lineage count | 6 | b1 §12.3, b4 §6.4 |
| Archive and cold storage; layered summaries with `source_set_hash`; core caps and `core_rank` / `token_budget` as an "About me" card | 7 | b1, b4 |
| Hard forget function (move earlier if a real user asks; it is needed for privacy, not for cognition) | 7 (or on demand) | b1 §10 |
| `memory_grants` (memory-level only), RLS, flow rule, roles beyond viewer/editor, profile flag, shared prefs, connector limits, `members` retirement | 8, or 2b by a new D23 (R4-02) | b3 |
| More short memories (shared inbox) | when a real case appears | R4-05 |

### Cut outright (not "later")

- `proposals.via_use_id` and the "labile window" rule (R4-14).
- The `active → faded → archived` state machine and `lifecycle_transitions` table (R4-11); fade is computed.
- The time-based 1/7/30/90/180/365 ladder as a default (R4-13).
- `schema_fit` / `misfit_cluster` / `new_topic` (R4-17), unless step 6 shows a measurable use.
- The ×1.25 "effortful retrieval" bonus as a psychology claim (R4-15); it may return as a ranking correction.
- Per-layer grants and `item_types.layers` allow-lists (rulings, R4-04).
- `ctx_files`, `ctx_persona`, `why_it_matters` as columns (b4 §8). Put them in `capture_context` jsonb if at all.

### Doors this keeps open

- `memories.layer` exists, so more inboxes, per-goal boards, and layer UIs are a check or index change away.
- `memory_id` is on every content row, so grants and RLS can be added without a data rewrite.
- `entry_summaries` and the chunker are ready for vectors in step 4. A model change is a new table row.
- `entry_uses` and `packet_items` give step 5 its history from day one.
- `capture_context` jsonb holds every encoding-context field b4 wants. It can be promoted to columns when a
  signal earns it.

---

## 4. The owner's question: "each agent should summarize the body, and that should be the vector?"

Yes, with three conditions:
1. **Agent writes:** the writer's summary is the vector. It is the best gist available, because the writer knows what it
   meant. Add up to 3 "questions this answers" later (step 4) if the benchmark wants them.
2. **Person writes:** embed body chunks at once, not the fallback summary. A person with no connected
   agent would otherwise never get a usable vector (R4-07).
3. **The summary is part of what the person approves.** Show it on the approval card. Agents only ever see a
   summary that a person wrote or approved alongside the body; a steward's re-summary waits for a Keep
   (R4-08). Keep summaries in their own table so a re-summary is not an entry version (R4-09).

---

## 5. What I tried to break and could not

- **One core per person:** blue-1's partial unique index, deferred trigger, and delete guard hold. I found
  no path to zero cores or two.
- **D22 trust in the data model:** blue-1 §4.3 refuses agent trust raises, kind changes, and agent
  versions of approved entries in the DB as well as in code. The only hole I found is the summary
  (R4-08), which is a served-text issue, not a trust column issue.
- **Exposure vs use:** blue-2 and blue-4 both keep packet appearances out of activation. No rich-get-richer
  loop through exposure.
- **Activation never raises trust and never hides binding decisions:** both designs keep it as a
  ranking term with a floor for approved decisions. This is consistent with BUILD-PLAN step 5.
- **Grants on memories, not layers (blue-3 §2):** the argument holds from the product side too.
- **Episodes plus gist with `derived_from`:** the verbatim trace is kept and the gist never overwrites it. This is sound
  and cheap.
- **Lineage-based source counting:** the idea is right and easy to explain to a person ("this rests on one web
  page"). Only the timing (step 6 for the full closure) is in question.
- **Working memory not embedded (blue-2):** right. Scratch is fetched by task, and promoted content is embedded
  as a new entry.

---

## Summary

The four designs are careful and mostly correct in isolation. Together they are about four build steps
too big for step 1, and they make the person do the work. Main points:

- **D21 is not respected.** Review ladders, Consolidator queues, an 8-state lifecycle, strength caches,
  retrieval logs with signal weights, 32 vector partitions, and the full sharing/RLS migration are placed in
  steps 1–2. Rule: a column arrives at the step whose exit test reads it, except logs that cannot be backfilled
  (`entry_uses`, `packet_items`, `capture_context`).
- **Sharing per memory is a D21 reorder** and needs a D23. Keep `workspaces` for now.
- **Product:** show About me, Inbox, Board, and Notebooks. Agents never pick a level: they write to the inbox or the
  board. v1 has one inbox per person and one board per project, with sealing per goal. Keep moves an
  item; it does not duplicate it.
- **Approval load:** about 60–90 cards a day for a developer with two agents. Fix it with one budgeted Digest queue, no
  cards for agent links, no time-based review ladder, and batch keeps.
- **Fading as a stored state** breaks rule 6 and makes people's own captures vanish. Compute it, and apply it to agents only.
- **Psychology:** the review ladder (spacing research applied to how the world changes), reconsolidation (a
  permission rule), Bjork's "effortful retrieval" (actually ranking error), CLS interference, and schema fit are misapplied.
  Fan damping silences the topic nodes blue-4 adds. A 100-question benchmark cannot show the gain from any one
  signal. Pre-register effect sizes and grow the set to at least 300.
- **Summary vectors:** yes for agents. For people, embed chunks, because web-only users never get a
  Consolidator. The summary agents read must be the approved one, and a re-summary must not be an entry version.
