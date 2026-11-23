# Blue 4: memory lifecycle and cognitive psychology

Lens: how an item is born, moves, strengthens, fades and is revised across the four levels
(working, short, long, core), and what memory research says about pulling and preserving it.
All SQL is Postgres 16+ and was run against a scratch Postgres 16 with the stubs in section 1
(DDL, sweep query, lineage CTE, activation function, use rate limit). It sits on top of the base model that blue-data-model owns; section 1
lists exactly what I assume from it, so the two can be reconciled.

Folded in: the research thread's 12 findings (`psych-findings.md`). Where I adopt, adapt or
argue against one, it is marked **[PF n]**.

---

## 0. Ten decisions in one screen

1. **Level lives on the memory container, not the item.** An item's level is the level of the
   `memories` row it sits in. Moving levels means changing `memory_id`.
2. **Same text, new home = a field change, recorded as a new version.** A person filing a short
   note into long memory as-is writes an `entry_versions` row with the new `memory_id` and the
   same body. **Changed text = a new derived entry** with `derived_from` links (gist, merge,
   lesson, core statement). Section 3 has the full table.
3. **Content is append-only; lifecycle state is a mutable field with an append-only event log**
   (`entry_lifecycle_events`), the same pattern as `tasks` + `task_events`. Fading, archiving and
   sealing never touch the text.
4. **Two strengths per item (Bjork's new theory of disuse) [PF 1]:** *storage strength* =
   number of distinct days the item was really used (only grows); *retrieval strength* = ACT-R
   base-level activation from the `entry_uses` log (decays, resets on use). Rank by retrieval
   strength. Fade only when *both* are low. High storage + low retrieval = resurface, not fade.
5. **Two logs, not one [PF 2, PF 3]:** `entry_uses` holds only real uses (cited, opened, confirmed,
   acted on, contradicted, reviewed). Showing up in a packet is an *exposure*, logged in the
   packet audit (`packet_items`), and never strengthens anything.
6. **Activation orders; it never hides binding decisions and never raises trust.** Approved,
   currently valid, in-scope decisions go in a separate packet section with an activation floor.
7. **Short-term fades on a use-stretched timer** (`fades_at`), long-term never fades
   automatically (it is closed or superseded), core never fades.
8. **The Consolidator only writes proposals** (`proposals` table) and `proposed` entries. Every
   state change it wants (merge, promote, archive, add to core) is applied in one transaction
   when a person accepts the proposal.
9. **Evidence lineage**: claims rest on `sources` with a `lineage_key`; agent claims rest on other
   entries. The independent-source count is `count(DISTINCT lineage_key)` over the recursive
   closure. Three agents repeating one inference count as one source.
10. **Reconsolidation without rewriting:** an agent may propose a revision of a long-term item
    only by citing the `entry_uses` row in which it actually retrieved that item. The revision is a
    new entry that `supersedes` the old one once a person accepts. The old one stays in force
    until then.

---

## 1. Naming, and what each level is in psychology terms

| sky-brain level | Closest construct | What it holds here | Time scale |
|---|---|---|---|
| **working** | Baddeley's working memory and episodic buffer; Cowan's ~4-chunk focus | One per active goal: scratch notes, hypotheses, the claimed task's context packet, resume notes | hours to days, closes with the goal |
| **short** | **Not** Atkinson-Shiffrin short-term store (seconds). It is the recent-episode store, the hippocampal side of complementary learning systems | Captures, inbox, sealed task episodes, conversation notes, proposed lessons | days to weeks |
| **long** | Semantic memory plus consolidated episodic memory (Tulving); the neocortical side of CLS | Facts, decisions, lessons, people, topics, gist summaries | indefinite, closed rather than deleted |
| **core** | The self-schema | Identity, stable preferences, values, standing rules | indefinite, changed only by the person |

I agree with **[PF naming]**: psychology's "short-term memory" is seconds. Keep `short` in the
schema (the owner's word), but call it **Recent** in the UI and docs so nobody designs it as a
seconds-long buffer.

### Base model I assume (owned by blue-data-model; reconcile names there)

```sql
-- ASSUMED, not proposed here. Shown so the SQL below is self-consistent.
CREATE TYPE memory_level AS ENUM ('working','short','long','core');
CREATE TABLE memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,                    -- the one person who owns it
  level       memory_level NOT NULL,
  name        text NOT NULL,
  goal_id     uuid,                             -- working memories: the goal they serve
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX memories_one_core_per_owner ON memories (owner_id) WHERE level = 'core';

-- entries: id, memory_id, kind, trust ('quarantined'|'proposed'|'approved'), title, body,
--          summary (the embedded text), valid_from, valid_to, author_kind, author, created_at.
-- entry_versions: append-only (entry_id, version_no, memory_id, title, body, summary,
--          valid_from, valid_to, recorded_at, written_by).
-- links: (from_id, to_id, relation, status 'proposed'|'accepted'|'rejected', reason, author).
--          relations include derived_from, supersedes, contradicts, supports, part_of, about.
```

---

## 2. The lifecycle state machine

### 2.1 States

`lifecycle_state` is orthogonal to `trust`. Trust says *how far we believe it*; lifecycle says
*where it is in its life*. Only `active` items are in default search.

| State | Meaning | In default search? |
|---|---|---|
| `active` | Live in its memory | yes |
| `sealed` | Working scratch after its goal closed; the episode holds the record | no (via the episode) |
| `faded` | Short-term item whose timer ran out unused | no; `include_faded` finds it |
| `archived` | Body moved to cold storage; title, summary and pointer stay | no; summary only |
| `merged` | Folded into a gist by an accepted merge | no; the gist links back |
| `superseded` | Replaced by a newer entry (accepted) | no; as-of queries find it |
| `closed` | No longer true (`valid_to` set); history | no; as-of queries find it |
| `forgotten` | Hard forget by the person: body, summary, vectors removed; tombstone only | never |

### 2.2 Diagram

```
                     capture (agent or person)
                              |
        +---------------------+----------------------+
        |                                            |
        v                                            v
  [WORKING: active]                           [SHORT: active] <------------------+
  scratch for one goal                        inbox / capture / lesson            |
        |                                       |   |    |   \                    |
        | goal done / cancelled /               |   |    |    \ used on >=3 days  |
        | idle 7 days (resume note)             |   |    |     \ or surprise /    |
        v                                       |   |    |      \ importance      |
  [WORKING: sealed] ---new row--> EPISODE ------+   |    |       v                |
  (scratch kept, hidden)       (immutable, in        |    |   consolidation_queue   |
                                short memory)        |    |       |                |
                                                     |    |   Consolidator (person's model)
                                     fades_at passed |    |       | writes PROPOSALS only
                                     no use, no pin, |    |       v                |
                                     no open proposal|    |   person: Keep / Wrong / Undo
                                                     v    |       |                |
                                          [SHORT: faded]  |       | accept "promote"/"gist"/"merge"
                                     used again ---->-----+-------|---(reactivate) |
                                           | 90 days              v                |
                                           v               [LONG: active] ---------+
                                   [archived] (cold body,       |   |   |   (unarchive, rare)
                                    summary + pointer)          |   |   |
                                                                |   |   +-- retrieved + contradicted
                                                                |   |       -> proposal "revise" (cites use)
                                                                |   |       -> new entry supersedes old
                                                                |   |          old: [superseded]
                                          spaced review:        |   |
                                          "no longer true" -----+   |
                                          -> new version with       |
                                          valid_to -> [closed]      | person only: "this is me"
                                                                    v
                                                             [CORE: active]
                                                   (one per person; never fades;
                                                    changes = new version + supersedes)

   Any state --person hard forget--> [forgotten] (tombstone; derived summaries flagged stale)
   merge accepted: sources --> [merged], gist --> [LONG: active] with derived_from to each
```

### 2.3 Allowed transitions (enforced in the database)

```sql
CREATE TYPE lifecycle_state AS ENUM
  ('active','sealed','faded','archived','merged','superseded','closed','forgotten');

ALTER TABLE entries
  ADD COLUMN lifecycle_state lifecycle_state NOT NULL DEFAULT 'active',
  ADD COLUMN lifecycle_changed_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE lifecycle_transitions (
  from_state lifecycle_state NOT NULL,
  to_state   lifecycle_state NOT NULL,
  person_only boolean NOT NULL,      -- true: only a human session may trigger it
  PRIMARY KEY (from_state, to_state)
);
INSERT INTO lifecycle_transitions VALUES
  ('active','sealed',     false),   -- rule: goal closed (server code, not an agent choice)
  ('active','faded',      false),   -- rule: sweep job, short level only
  ('faded','active',      false),   -- rule: a real use reactivates
  ('faded','archived',    false),   -- rule: sweep job after cold window
  ('archived','active',   true),    -- person restores
  ('active','merged',     true),    -- accepted merge proposal
  ('active','superseded', true),    -- accepted revise proposal / person replaces
  ('active','closed',     true),    -- person (or accepted review outcome) ends validity
  ('active','forgotten',  true), ('sealed','forgotten', true), ('faded','forgotten', true),
  ('archived','forgotten',true), ('merged','forgotten', true), ('superseded','forgotten', true),
  ('closed','forgotten',  true);

CREATE TABLE entry_lifecycle_events (       -- append-only, like task_events
  seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id   uuid NOT NULL REFERENCES entries(id),
  from_state lifecycle_state NOT NULL,
  to_state   lifecycle_state NOT NULL,
  cause      text NOT NULL CHECK (cause IN
              ('goal_closed','fade_sweep','archive_sweep','reused','proposal_accepted',
               'person_action','review_outcome','hard_forget')),
  proposal_id uuid,                          -- when caused by an accepted proposal
  actor_kind text NOT NULL CHECK (actor_kind IN ('human','rule')),  -- never 'agent'
  actor      text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (from_state, to_state) REFERENCES lifecycle_transitions (from_state, to_state)
);
-- Reuse the audit_log trigger that refuses UPDATE/DELETE/TRUNCATE (0001_audit-append-only.sql).
```

Note `actor_kind` has no `agent` value: agents never move lifecycle state themselves. They write a
proposal; a rule or a person moves the state. Hard forget is the one exception to append-only: the
event row survives as the tombstone; the content rows are deleted (privacy law, VISION growth 5).

---

## 3. Transitions: field change or new derived entry?

| Transition | Trigger | How it is recorded | Why |
|---|---|---|---|
| **birth in working** | agent or person writes scratch while a goal is active | new entry in the goal's working memory, `trust=proposed` (agent) | the blackboard |
| **birth in short** | `capture` (MCP), web clip, import, chat note | new entry; `entry_uses` row kind `created`; `episode_id` if captured inside an episode | creation counts as the first presentation in ACT-R |
| **working -> short** | goal done, cancelled, or working memory idle 7 days | **new row** in `episodes` (verbatim scratch, outcome, `expected_outcome` gap); scratch entries go `sealed` (field change + event); 0–3 proposed lessons are **new entries** in short with `derived_from` the episode | the episode is immutable raw input; lessons are new text |
| **short -> long, as-is** | person clicks Keep on a well-formed item (e.g. a decision they wrote) | **field change**: new `entry_versions` row with the long `memory_id`, same body; trust may rise in the same action | same claim, new home; one id keeps its use history |
| **short -> long, consolidated** | accepted `promote`/`gist`/`merge` proposal | **new derived entry** in long, `derived_from` every source; sources stay in short and fade naturally, or go `merged` | gist differs from verbatim; lineage must survive |
| **long -> core** | person only ("this is me") | **new derived entry** in core written by the person (or an accepted `core_add` proposal) with `derived_from` the long items | core is phrased as a self-statement; the evidence stays in long |
| **short fades** | `fades_at < now()`, no pin, no open proposal, no open-goal reference | field change `active -> faded` + event | forgetting = ranking out, not deleting |
| **faded -> archived** | 90 days faded | body to cold storage (pointer kept), field change + event | VISION growth 2 |
| **long revised** | retrieval + contradiction, or person edit | **new entry** + `supersedes` link (accepted); old goes `superseded` | reconsolidation without rewriting (section 7) |
| **long no longer true** | review outcome or person | new `entry_versions` row with `valid_to` set; state `closed` | bitemporal: valid time vs recorded time (REVIEW 3B) |
| **core changed** | person | new entry + `supersedes`; never in place | the self-schema has history too |

Rule of thumb: **if the words change, it is a new entry with lineage; if only the home, validity or
life state changes, it is a recorded field change.**

---

## 4. Use log, activation, and the two strengths

### 4.1 What the research says

- Forgetting follows a power function, and the odds an item is needed again track its past use
  frequency, recency and spacing (Anderson & Schooler 1991). Ebbinghaus' curve replicates
  (Murre & Dros 2015).
- ACT-R base-level activation `B = ln(Σ t_j^-d)`, `d = 0.5`, captures recency, frequency and spacing
  in one number. Petrov (2006) gives a cheap hybrid: exact terms for the last *k* uses plus a closed
  form for the rest, so you only store `n`, the first use and the last *k* timestamps.
- Storage strength vs retrieval strength (Bjork & Bjork 1992): an item can be well learned but hard
  to reach right now; relearning it is fast. Retrieval of an item with low current retrieval strength
  raises storage strength most ("desirable difficulty").
- Retrieval practice strengthens memory more than re-exposure (Roediger & Karpicke 2006): only
  retrieval *acted on* should count **[PF 3]**.

### 4.2 Tables

```sql
CREATE TYPE use_kind AS ENUM (
  'created',        -- encoding counts as presentation #1
  'opened',         -- drill-down get() by an agent or the person
  'cited',          -- named as evidence in report_task / an answer
  'acted_on',       -- a task's diff or decision relied on it (report_task refs)
  'confirmed',      -- person said "still true" (review or digest Keep)
  'contradicted',   -- retrieved and found wrong: still a use (it was relevant), never raises trust
  'pinned'          -- person pinned it
);

CREATE TABLE entry_uses (                     -- append-only
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id    uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,  -- hard forget cascades
  version_no  int  NOT NULL,                  -- which version was used
  kind        use_kind NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  hour_bucket timestamp GENERATED ALWAYS AS (date_trunc('hour', at AT TIME ZONE 'UTC')) STORED,
  actor_kind  text NOT NULL CHECK (actor_kind IN ('human','agent','rule')),
  actor       text NOT NULL,                  -- from the token, never the body (hard rule 2)
  -- retrieval context: the cue that brought it up (encoding specificity, section 8)
  packet_id   uuid,                           -- the context packet it came through, if any
  task_id     uuid,
  goal_id     uuid,
  query_text  text,                           -- capped; secret-scanned like any write
  cue_project_id uuid,
  cue_feature_id uuid
);
-- One counted use per entry, actor and hour: an agent cannot pump activation by opening in a loop.
CREATE UNIQUE INDEX entry_uses_rate ON entry_uses (entry_id, actor, hour_bucket)
  WHERE kind IN ('opened','cited','acted_on');
CREATE INDEX entry_uses_entry_at ON entry_uses (entry_id, at DESC);

-- Mutable cache, rebuildable from entry_uses at any time. Not truth.
CREATE TABLE entry_stats (
  entry_id      uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  n_uses        int  NOT NULL DEFAULT 0,      -- ACT-R n
  n_use_days    int  NOT NULL DEFAULT 0,      -- STORAGE strength: distinct UTC days with a use
  first_used_at timestamptz NOT NULL,         -- = created_at
  last_used_at  timestamptz NOT NULL,
  recent_uses   timestamptz[] NOT NULL DEFAULT '{}',   -- last k = 5, newest first
  n_contradicted int NOT NULL DEFAULT 0,
  fades_at      timestamptz,                  -- short level only; null elsewhere
  next_review_at timestamptz                  -- mirror of review_schedule.due_at, for one join
);
CREATE INDEX entry_stats_fades ON entry_stats (fades_at) WHERE fades_at IS NOT NULL;
```

Exposures go to the packet audit that BUILD-PLAN step 2 already stores:

```sql
CREATE TABLE packet_items (                   -- append-only; "shown", not "used"
  packet_id  uuid NOT NULL,
  entry_id   uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  version_no int  NOT NULL,
  section    text NOT NULL CHECK (section IN ('core','binding','ranked','unknowns')),
  rank       smallint NOT NULL,
  score_parts jsonb NOT NULL,                 -- each signal's contribution, for ablation runs
  PRIMARY KEY (packet_id, entry_id)
);
```

**[PF 2] adapted:** the research thread proposed one access log with a `was_used` flag. I split it:
exposures are many and only matter for audit and benchmark ("was it shown but ignored?"); uses are
few and drive ranking. Two tables keep the hot ranking path small, and "shown but not used" is a
cheap anti-join for the benchmark.

### 4.3 Activation function (Petrov hybrid, hours as the time unit)

Time unit does not change ranking: scaling every `t` by `c` adds the same constant to every `B`.
Hours with a floor of 1 avoid `t → 0`.

```sql
CREATE OR REPLACE FUNCTION actr_activation(
  n int, first_at timestamptz, recent timestamptz[],
  at timestamptz, d double precision DEFAULT 0.5)
RETURNS double precision LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT greatest(extract(epoch FROM at - u) / 3600.0, 1.0) AS t
    FROM unnest(recent) AS u
  ),
  k AS (SELECT count(*)::int AS k, max(t) AS tk, coalesce(sum(power(t, -d)), 0) AS s FROM r),
  tn AS (SELECT greatest(extract(epoch FROM at - first_at) / 3600.0, 1.0) AS tn)
  SELECT ln(greatest(
           k.s + CASE WHEN n > k.k AND tn.tn > k.tk
                      THEN (n - k.k) * (power(tn.tn, 1 - d) - power(k.tk, 1 - d))
                           / ((1 - d) * (tn.tn - k.tk))
                      ELSE 0 END,
           1e-9))
  FROM k, tn
$$;
```

`entry_stats` is maintained by an `AFTER INSERT` trigger on `entry_uses`:
`n_uses + 1`, `recent_uses = (ARRAY[NEW.at] || recent_uses)[1:5]`, `n_use_days + 1` when
`NEW.at::date` (UTC) differs from `last_used_at::date`, and for short items
`fades_at = NEW.at + ttl * (1 + ln(n_use_days))` (section 5). A merged gist's stats are seeded from
the union of its sources' uses, so a merge does not reset storage strength.

### 4.4 Ranking rule (switchable, BUILD-PLAN rule 6)

```sql
CREATE TABLE ranking_signals (                -- per owner; benchmark runs flip these
  owner_id uuid NOT NULL,
  signal   text NOT NULL CHECK (signal IN
           ('activation','attention','context_match','spread','recency_prime',
            'schema_fit','binding_floor','mmr_diversity','review_resurface')),
  enabled  boolean NOT NULL DEFAULT false,
  weight   real NOT NULL DEFAULT 0,
  params   jsonb NOT NULL DEFAULT '{}',       -- e.g. {"d":0.5} or {"lambda":0.7}
  PRIMARY KEY (owner_id, signal)
);
```

The activation term in the final score (retrieval member owns the full query):

```sql
-- base = RRF(word, vector).  act = normalised activation in [0,1] over the candidate set.
score = base
      + CASE WHEN sig.activation_on THEN sig.w_act * act ELSE 0 END
-- binding_floor: approved, valid-now, in-scope decisions are never ranked out by low activation.
-- They are served in the separate 'binding' section whenever relevance > a low threshold,
-- and inside 'ranked' their act is floored: act := greatest(act, 0.8).
```

Three hard rules:
1. Activation only orders items that are already valid, in scope and allowed by trust filters.
2. Activation never touches `trust` or `confidence` (VISION "Where not to copy the brain").
3. `contradicted` uses raise activation (the item matters) but put it in the packet's
   `unknowns` section ("retrieved and contradicted on <date>, no replacement approved").

---

## 5. Fading and expiry (short and working)

**Short:** each short memory has a `fade_ttl` (default 14 days; the workspace can change it, as
claims' 30-day expiry already can). The timer stretches with *spaced* use, not raw count:

```
fades_at = last_used_at + fade_ttl * (1 + ln(n_use_days))
```

One use day: 14 days. Three use days: ~29 days. Seven: ~41 days. Spacing (distinct days) rather
than count follows Cepeda et al. 2008 and Anderson & Schooler: items needed on many separate
occasions are the ones needed again.

```sql
ALTER TABLE memories ADD COLUMN fade_ttl interval;          -- short only
ALTER TABLE memories ADD CONSTRAINT fade_ttl_only_short
  CHECK ((level = 'short') = (fade_ttl IS NOT NULL));
ALTER TABLE memories ADD COLUMN closed_at timestamptz;      -- working: sealed with its goal
ALTER TABLE entries  ADD COLUMN pinned boolean NOT NULL DEFAULT false;  -- person only

-- Nightly sweep (server code, cause = 'fade_sweep', actor_kind = 'rule'):
SELECT e.id
FROM entries e
JOIN memories m   ON m.id = e.memory_id AND m.level = 'short'
JOIN entry_stats s ON s.entry_id = e.id
WHERE e.lifecycle_state = 'active'
  AND NOT e.pinned
  AND s.fades_at < now()
  AND NOT EXISTS (SELECT 1 FROM proposals p
                  WHERE p.status = 'pending' AND e.id = ANY (p.target_ids))
  AND NOT EXISTS (SELECT 1 FROM consolidation_queue q
                  WHERE q.entry_id = e.id AND q.state IN ('pending','leased'))
  AND NOT EXISTS (SELECT 1 FROM tasks t JOIN goals g ON g.id = t.goal_id
                  WHERE e.id::text = ANY (t.context_refs)
                    AND t.status IN ('pending','in_progress','blocked'));
```

**Bjork rule (resurface, don't fade) [PF 1]:** before fading, an item with `n_use_days >= 3` is
enqueued for consolidation instead (reason `spaced_use`). It was needed on three separate days: that
is the strongest automatic signal that it belongs in long memory.

**Working:** a working memory closes when its goal is `done`/`cancelled`, or after 7 idle days
(then a resume note is written, BUILD-PLAN step 2). Closing writes the episode and seals the scratch
(section 3). Working never "fades" item by item: it is cleared as a unit, like Baddeley's buffer
being reloaded for the next task **[PF 11]**.

**Long and core:** never fade. Long items leave default search only by `closed`, `superseded` or
`merged`; core only by `superseded`.

---

## 6. Consolidation (the Consolidator steward)

Psychology: the hippocampus learns fast and the neocortex slowly; consolidation interleaves replay
of new with old so new learning does not overwrite old structure (McClelland, McNaughton & O'Reilly
1995). Sleep replays selectively, favouring what matters for the future (Diekelmann & Born 2010).
New facts that fit an existing schema consolidate fast (Tse et al. 2007). Prediction error drives
learning (VISION row 5).

Design: the nightly run is one board task (goal "consolidate", approved once by the person, D20).
The Consolidator claims it like any task, then pulls work from a dedicated queue over MCP. It runs in
the person's own model with a budget; sky-brain only computes scores in SQL.

### 6.1 Episodes (immutable raw input)

```sql
CREATE TABLE episodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,
  memory_id   uuid NOT NULL REFERENCES memories(id),       -- a short memory
  kind        text NOT NULL CHECK (kind IN
              ('task_run','conversation','capture_batch','import','review_session')),
  goal_id     uuid, task_id uuid,
  started_at  timestamptz NOT NULL, ended_at timestamptz NOT NULL,
  title       text NOT NULL,
  summary     text,                                         -- the gist; this is what gets embedded
  body        text,                                         -- verbatim; null once cold
  body_hash   bytea NOT NULL,                               -- sha256 of the verbatim body
  cold_ref    text,                                         -- Blob pointer after ~90 days
  cold_at     timestamptz,
  expected_outcome text, actual_outcome text,               -- the gap becomes a proposed lesson
  scratch_entry_ids uuid[] NOT NULL DEFAULT '{}',           -- the sealed working items
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((body IS NULL) = (cold_ref IS NOT NULL))
);
-- Trigger: refuse UPDATE except (body -> NULL, cold_ref, cold_at) set together; refuse DELETE
-- except by the hard-forget path.
```

**[PF 5] adopted:** keep both verbatim (episode) and gist (long entry with `derived_from`). Fuzzy-
trace theory: gist and verbatim traces are stored in parallel and gist lasts longer (Brainerd &
Reyna). The packet serves gist; drill-down returns verbatim. Unlike the brain, sky-brain never lets
the gist overwrite the verbatim.

### 6.2 The queue

```sql
CREATE TABLE consolidation_queue (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    uuid NOT NULL,
  entry_id    uuid REFERENCES entries(id) ON DELETE CASCADE,
  episode_id  uuid REFERENCES episodes(id) ON DELETE CASCADE,
  CHECK (num_nonnulls(entry_id, episode_id) = 1),
  reason      text NOT NULL CHECK (reason IN
              ('new_capture','episode_sealed','spaced_use','surprise','contradiction',
               'person_flag','fade_candidate','summary_stale','misfit_cluster')),
  -- features, computed in SQL at enqueue and refreshed at claim time:
  future_need real NOT NULL DEFAULT 0,   -- activation + closeness to open goals' embeddings
  surprise    real NOT NULL DEFAULT 0,   -- 1 - max cosine to active long items of this owner
  importance  real NOT NULL DEFAULT 0,   -- person flag, kind=decision, outcome gap
  schema_fit  real NOT NULL DEFAULT 0,   -- share of top-10 neighbours under one accepted topic
  state       text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','done','skipped')),
  lease_holder text, lease_expires_at timestamptz, attempts smallint NOT NULL DEFAULT 0,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX consolidation_queue_one_open
  ON consolidation_queue (coalesce(entry_id, episode_id)) WHERE state IN ('pending','leased');
```

Priority at claim time: `w_need*future_need + w_surprise*surprise + w_imp*importance + w_fit*schema_fit`,
weights in `ranking_signals.params`. **Importance and repetition raise queue priority, never trust.**

**[PF 6] adapted:** "repetition" as a keep signal is fine when it is the *person* returning to a
topic on separate days (that is `n_use_days`, a real future-need signal). Agents restating each
other is not counted: it shows up only as `derived_from` lineage, which adds nothing (6.4).

**Interleaved replay [PF 7]:** `consolidation_next` returns each claimed item *with* its top-N old
neighbours from long memory (word + vector + accepted links). The Consolidator must write any gist
or merge against that replay set, and the proposal records it (`replayed_ids`). This is the CLS
point made concrete: a new gist is checked against the old structure, so contradictions are found at
consolidation time rather than months later.

**Schema fit (Tse 2007):** high `schema_fit` items are claimed first (fast track to a Keep card).
Low-fit items stay in short longer (the sweep adds one `fade_ttl` once for `misfit`), and when ≥ 5
low-fit items cluster, the Consolidator proposes `new_topic`. Fit changes speed, never evidence
requirements.

### 6.3 Proposals: the only thing the Consolidator can change

```sql
CREATE TYPE proposal_op AS ENUM (
  'promote',      -- move an entry (as-is) to a long memory          -> field change
  'gist',         -- result_entry_id summarises target_ids             -> new entry, derived_from
  'merge',        -- gist + targets go 'merged'
  'link',         -- accept a proposed typed link
  'revise',       -- result_entry_id supersedes target (reconsolidation, section 7)
  'close',        -- set valid_to on target (new version)
  'archive', 'unarchive',
  'core_add', 'core_revise',
  'new_topic',
  'review'        -- a "still true?" card (section 6.5)
);

CREATE TABLE proposals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL,
  op            proposal_op NOT NULL,
  target_ids    uuid[] NOT NULL,
  to_memory_id  uuid REFERENCES memories(id),
  result_entry_id uuid REFERENCES entries(id),   -- the proposed new text, itself trust='proposed'
  replayed_ids  uuid[] NOT NULL DEFAULT '{}',    -- old neighbours shown during consolidation
  via_use_id    bigint REFERENCES entry_uses(id),-- required for 'revise' by an agent
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  proposed_by_kind text NOT NULL CHECK (proposed_by_kind IN ('human','agent','rule')),
  proposed_by   text NOT NULL,
  run_task_id   uuid,                            -- the board task of the Consolidator run
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected','expired','withdrawn')),
  decided_by    text,                            -- a human user id; server refuses agents
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CHECK ((status IN ('accepted','rejected')) = (decided_by IS NOT NULL)),
  CHECK (op NOT IN ('gist','merge','revise','core_add','core_revise') OR result_entry_id IS NOT NULL),
  CHECK (op <> 'revise' OR proposed_by_kind <> 'agent' OR via_use_id IS NOT NULL),
  CHECK (op NOT IN ('core_add','core_revise') OR to_memory_id IS NOT NULL)
);
CREATE INDEX proposals_pending ON proposals (owner_id, created_at) WHERE status = 'pending';
```

Accepting a proposal (person only) runs one transaction: insert versions / links / lifecycle
events, set trust on `result_entry_id`, write the audit row. A per-run budget (`max_proposals`,
default 20) keeps the Digest small; REVIEW asks us to measure approvals, and this is the knob.

**How a merge is recorded:** gist G (new entry, long memory, `trust=proposed`), links
`G derived_from A`, `G derived_from B`, ... , proposal `op='merge', target_ids={A,B,...}`. On accept:
G's trust as the person chooses, A, B go `merged` (events cite the proposal), G's `entry_stats` are
seeded from the union of A and B's uses. Near-duplicate merges reduce fan (fewer competitors for
the same cue) **[PF 9]**, but distinctive detail survives in the sources and the episode.

**Layered summaries (VISION growth 1):** a summary entry stores
`source_set_hash = sha256(sorted (entry_id, version_no) of its derived_from sources)`. When any
source gets a new version or is forgotten, the hash no longer matches and a `summary_stale` queue
row is written.

```sql
ALTER TABLE entries ADD COLUMN source_set_hash bytea;   -- only on derived summaries / gists
```

### 6.4 Evidence lineage: repetition is not confirmation

```sql
CREATE TABLE sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN
              ('person_statement','test_run','commit','document','web','import','tool_output')),
  locator     text NOT NULL,                 -- URL, repo@sha, test id, episode id + offset
  lineage_key text NOT NULL,                 -- what makes two sources the SAME source:
                                             --   person:<user_id>   web:<canonical url>
                                             --   commit:<repo>@<sha> test:<suite>@<sha>
  content_hash bytea,
  observed_at timestamptz NOT NULL,
  episode_id  uuid REFERENCES episodes(id),
  UNIQUE (owner_id, lineage_key)
);

CREATE TABLE entry_evidence (                -- append-only
  entry_id     uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  version_no   int  NOT NULL,
  relation     text NOT NULL CHECK (relation IN ('supports','contradicts')),
  source_id    uuid REFERENCES sources(id),
  via_entry_id uuid REFERENCES entries(id),  -- "I believe this because entry X says so"
  added_by     text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(source_id, via_entry_id) = 1)
);
```

"Agent inference" is deliberately not a source kind: an agent's conclusion is an *entry* whose
evidence points at other entries or real sources. So an inference chain always resolves to roots.

```sql
-- Independent supporting sources for one entry: walk via_entry_id to roots, count lineage keys.
WITH RECURSIVE walk(entry_id, depth, path) AS (
  SELECT $1::uuid, 0, ARRAY[$1::uuid]
  UNION ALL
  SELECT ev.via_entry_id, w.depth + 1, w.path || ev.via_entry_id
  FROM walk w
  JOIN entry_evidence ev ON ev.entry_id = w.entry_id AND ev.relation = 'supports'
  WHERE ev.via_entry_id IS NOT NULL
    AND w.depth < 6
    AND NOT ev.via_entry_id = ANY (w.path)              -- cycle guard
)
SELECT count(DISTINCT s.lineage_key) AS independent_sources
FROM walk w
JOIN entry_evidence ev ON ev.entry_id = w.entry_id AND ev.relation = 'supports'
JOIN sources s ON s.id = ev.source_id;
```

Agent A infers X from a web page P. Agents B and C cite A. All three walks end at `web:P`:
**one** source. The packet says "rests on one unverified source" (BUILD-PLAN step 2). The person
saying the same thing in five chats is `person:<id>` once: a person's belief, stated often, is still
one witness. This is the illusory-truth guard: repetition raises felt truth in humans (Hasher et al.
1977; see the 2021 review in sources), so the store must not.

### 6.5 Spaced "still true?" review (the Consolidator schedules it, the person answers)

```sql
CREATE TABLE review_schedule (
  entry_id   uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL,
  step       smallint NOT NULL DEFAULT 0,          -- index into the ladder below
  due_at     timestamptz NOT NULL,
  paused     boolean NOT NULL DEFAULT false
);
CREATE TABLE review_events (                       -- append-only
  entry_id   uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  step       smallint NOT NULL,
  outcome    text NOT NULL CHECK (outcome IN
             ('still_true','changed','no_longer_true','unsure','skipped')),
  reviewer   text NOT NULL,                        -- a person
  recalled_before_reveal boolean                   -- optional: retrieval practice for the person
);
```

Ladder: **1, 7, 30, 90, 180, 365 days** (BUILD-PLAN gives 1/7/30/90; I extend it). Who gets a
schedule: approved decisions, standing rules, approved facts with `importance >= 2`, and every core
item (core starts at step 4, yearly: "is this still you?").

Outcomes: `still_true` → `entry_uses(kind='confirmed')`, next step. `changed` → a `revise` proposal
pre-filled for the person. `no_longer_true` → new version with `valid_to = now()`, state `closed`.
`unsure` → same step again in half the interval, and the packet marks it "unverified since <date>".
`skipped` → due again in 3 days, step unchanged.

Evidence on spacing: Cepeda et al. (2008) find the best gap is a fraction of the retention horizon
that shrinks as the horizon grows (roughly 20–40% of a one-week horizon, 5–10% of a one-year
horizon)
**[PF 10, refined]**. Karpicke & Roediger (2007) found expanding schedules help short-term but
equal spacing did as well or better long-term. So the ladder is a *default*, stored as data
(`ranking_signals.params` for `review_resurface`), and the benchmark decides.

Testing effect (Roediger & Karpicke 2006): the review card can first ask the person "What did we
decide about X?" and only then show the entry (`recalled_before_reveal`). This preserves the
*person's* memory of what was decided (VISION: "know what, not only where"). Build it later; it is
UI only.

---

## 7. Reconsolidation: retrieved and contradicted

Psychology: a retrieved memory becomes labile and must be re-stabilised; it can be updated in that
window (Nader, Schafe & LeDoux 2000). In humans this is also how misinformation gets in (Loftus).
sky-brain keeps the useful half (retrieval is the moment to check and update) and drops the harmful
half (no in-place rewrite).

**Rule:** an agent may propose a change to a long or core item only if it retrieved that item in
this task. The proposal must carry `via_use_id`, an `entry_uses` row by the same actor, for that
entry, within the current task's lease. This is the "labile window", and it is also a guard against
agents rewriting things they never read **[PF 8, tightened]**.

Flow, for agent T working a task:

1. T's packet includes long item L (exposure: `packet_items`).
2. T opens or cites L → `entry_uses(kind='opened'|'cited')` = use U.
3. T finds L contradicted by a test run → T records `entry_uses(kind='contradicted')`, writes an
   `observation` entry O in short memory with evidence `source = test:<suite>@<sha>`, and a
   proposed link `O contradicts L`.
4. T may write a proposed replacement L′ (new entry, `trust=proposed`) and
   `proposals(op='revise', target_ids={L}, result_entry_id=L′, via_use_id=U)`.
5. Until a person accepts: L stays in force and in the binding section, flagged in `unknowns`:
   "approved decision L is contradicted by O (1 independent source); replacement proposed".
6. On accept: link `L′ supersedes L`, L → `superseded`, L′ trust as the person chooses, everything
   `derived_from` L is enqueued `summary_stale` (recursive query, VISION "Keeping memory true").
7. On reject: O stays as history; `n_contradicted` keeps counting; the Auditor's weekly report lists
   items with `n_contradicted >= 2` and no open proposal.

Retrieval-induced forgetting (Anderson, Bjork & Bjork 1994): practising some items suppresses their
unpractised competitors. The store analogue: if only the top hits are ever cited, their near
neighbours lose activation and become unreachable. Two counters: MMR diversity in the packet
**[PF 9]**, and *no* negative signal for "shown but not used". Not being chosen is not evidence of
irrelevance.

---

## 8. Pulling memory: research → retrieval rules

| Principle | Finding | Concrete design | Where |
|---|---|---|---|
| Cue overlap | Retrieval succeeds when the cue matches what was encoded (Tulving & Thomson 1973) | Several cue routes, fused: word search on the full body (Hebrew + English: `simple` config + `pg_trgm`), vectors on `summary` and on each of 2–3 `cue_questions` (the questions the item answers) | `entry_vectors(entry_id, version_no, facet IN ('summary','question'), embedding halfvec)` — blue-data-model owns the table, I need the `question` facet |
| Context reinstatement | Recall is better in the encoding context (Godden & Baddeley 1975) | Store capture context on every entry; boost candidates whose context matches the current task | columns below; signal `context_match` |
| Spreading activation | Activation spreads along associations and is diluted by fan (Collins & Loftus 1975; Anderson 1974) | 1–2 hops over **accepted** links, strength `S − ln(fan)`, preferring `derived_from`, `depends_on`, `supersedes` | signal `spread` (BUILD-PLAN step 4) |
| Recency priming | Recently active items are briefly easier to reach | Short boost for items with a use in the last 4 hours in the same goal | signal `recency_prime` |
| Retrieval practice | Retrieval strengthens more than re-reading (Roediger & Karpicke 2006) | Only `entry_uses` raise activation; packet exposure does not | section 4 |
| Base-level need | Need probability tracks recency, frequency, spacing (Anderson & Schooler 1991) | ACT-R activation, Petrov hybrid | signal `activation` |
| RIF | Retrieving some items suppresses competitors (Anderson, Bjork & Bjork 1994) | MMR (λ ≈ 0.7) when filling the ranked section; no penalty for unchosen | signal `mmr_diversity` |
| Capacity | Focus of attention holds about 4 chunks (Cowan 2001); the episodic buffer binds them (Baddeley 2000) | Packet = core section + binding section + ~4 ranked gists with drill-down pointers; adaptive budget on request (REVIEW 3D) **[PF 11]** | packet builder |
| Source monitoring | People misattribute where a memory came from (Johnson et al. 1993) | `origin` and frozen `confidence_at_encoding` shown in the fenced packet | columns below |
| Feeling of knowing | Metacognition | Packet `unknowns` section: no approved decision, contradictions, single-source | packet builder |

Capture-context columns (encoding specificity):

```sql
ALTER TABLE entries
  ADD COLUMN origin text NOT NULL DEFAULT 'agent_inferred' CHECK (origin IN
      ('person_said','external_source','agent_observed','agent_inferred','consolidated')),
  ADD COLUMN confidence_at_encoding real CHECK (confidence_at_encoding BETWEEN 0 AND 1),
      -- frozen: a trigger refuses any change after insert
  ADD COLUMN episode_id uuid REFERENCES episodes(id),       -- the episode it was captured in
  ADD COLUMN ctx_goal_id uuid,
  ADD COLUMN ctx_task_id uuid,
  ADD COLUMN ctx_persona text,                              -- e.g. 'claude-code/builder'
  ADD COLUMN ctx_files text[] NOT NULL DEFAULT '{}',        -- paths touched when captured
  ADD COLUMN why_it_matters text CHECK (char_length(why_it_matters) <= 300),
  ADD COLUMN cue_questions text[] NOT NULL DEFAULT '{}'
      CHECK (cardinality(cue_questions) <= 3),
  ADD COLUMN importance smallint NOT NULL DEFAULT 0 CHECK (importance BETWEEN 0 AND 3);
      -- set by a person or a rule (kind=decision -> 2); raises priority, never trust
```

(Project and feature are already on the entry or its memory, so they need no `ctx_` copy.)

Context match score, plain SQL, no model:

```sql
context_match =
    0.4 * (e.ctx_goal_id = :goal_id)::int
  + 0.2 * (e.ctx_task_id = ANY(:sibling_task_ids))::int
  + 0.2 * (e.ctx_persona = :persona)::int
  + 0.2 * least(1, cardinality(ARRAY(SELECT unnest(e.ctx_files) INTERSECT
                                      SELECT unnest(:task_files::text[]))) / 3.0)
```

---

## 9. Preserving memory: research → storage rules

| Principle | Finding | Concrete design |
|---|---|---|
| Spacing | Spaced reviews beat massed; optimal gap scales with horizon (Cepeda et al. 2008) | `review_schedule` ladder; `fades_at` stretched by distinct use days |
| Two strengths | Storage strength only grows; retrieval strength decays (Bjork & Bjork 1992) | `n_use_days` vs ACT-R `B`; fade only if both low; resurface if storage high |
| Elaboration / depth | Deeper, meaning-based processing is remembered better (Craik & Lockhart 1972) | `why_it_matters` + `cue_questions` written at promotion to long (Curator/Consolidator proposes, person keeps); a long item with zero accepted links is flagged as an orphan by the Auditor |
| Linking | Integrated items are reachable by more routes | promotion to long requires ≥ 1 proposed typed link (`about`/`part_of` to a topic) |
| Gist vs verbatim | Gist and verbatim are separate traces; gist lasts longer (Brainerd & Reyna) | episodes verbatim and immutable; long items are gists with `derived_from`; embedding on gist + questions, word search on verbatim |
| Schemas | Schema-consistent facts consolidate fast (Tse et al. 2007; Bartlett 1932) | topics as entries in long memory; `schema_fit` in the queue; misfit clusters → `new_topic` proposal |
| Consolidation by replay | Interleaving new with old avoids catastrophic interference (McClelland et al. 1995; Diekelmann & Born 2010) | `consolidation_next` returns the replay set; `proposals.replayed_ids` |
| Episodic → semantic | Repeated episodes yield semantic knowledge (Tulving) | episodes are queue items; lessons and gists are new long entries derived from them |
| Self-schema | A small, stable, well-rehearsed self-model **[PF 12]** | core: one per person, always in the packet (capped, e.g. 40 items / ~1.5k tokens), person-only writes, yearly review |
| Don't copy the brain | Reconsolidation and repetition distort (Loftus; illusory truth) | no in-place edits; lineage counting; frozen encoding confidence |

---

## 10. Core memory specifics

- Exactly one `memories` row with `level='core'` per owner (partial unique index, section 1). The
  server creates it with the person's account.
- Write rule: only a human session of the owner writes core entries or accepts `core_add` /
  `core_revise`. Enforce in the Gatekeeper, plus a trigger that refuses inserts into a core memory
  unless `author_kind = 'human'` and `author = owner_id`.
- Agents may *propose* core items, with evidence: "You chose small PRs over large ones in 6 tasks
  (6 distinct episodes)". The count is lineage-based: episodes, not mentions.
- Core never fades, is always loaded in its own fenced section, and is reviewed yearly.
- Sharing: core is not shared by default (blue-sharing decides the mechanism; my lens only says
  the self-schema is the most private layer).

---

## 11. Build now vs later (BUILD-PLAN steps, rule 6 switches)

| Mechanism | Tables / columns | Build at | Switch (`ranking_signals.signal`) | Why then |
|---|---|---|---|---|
| Lifecycle state + events + transitions table | §2.3 | **Step 1** | — (correctness, not ranking) | append-only rule needs it from day one |
| Episodes (immutable) | `episodes` | **Step 1** | — | BUILD-PLAN step 1 already lists it |
| `entry_uses` log + `entry_stats` cache | §4.2 | **Step 1** (log only) | — | cheap; history cannot be backfilled later |
| `packet_items` (exposure audit) | §4.2 | **Step 2** | — | packets are stored for audit in step 2 |
| Origin, frozen encoding confidence | §8 columns | **Step 1** | — | trust model depends on it |
| Capture context columns | §8 columns | **Step 1** (columns), signal step 5 | `context_match` | data cannot be recovered later; ranking can wait |
| Sources + evidence lineage | §6.4 | **Step 1–2** | — | `report_task` evidence (step 2) needs it; REVIEW 3C |
| Short fade sweep with `fades_at` | §5 | **Step 2** | — (retention policy) | the inbox fills from day one |
| Working memory seal → episode | §3, §5 | **Step 2** | — | the agent loop ends here |
| ACT-R activation ranking | `actr_activation()` | Step 5 | `activation`, `binding_floor` | after the measure gate |
| Recency priming | — | Step 5 | `recency_prime` | small, measure separately |
| Spreading activation with fan | links | Step 4 | `spread` | with hybrid search |
| MMR diversity | — | Step 4 | `mmr_diversity` | with hybrid search |
| `cue_questions` vectors | `entry_vectors` facet | Step 4 | part of vector route | needs embeddings |
| Proposals table | §6.3 | **Step 2** (Digest Keep/Wrong/Undo uses it) | — | lessons from `report_task` need a Keep path |
| Consolidation queue, replay set, schema fit | §6.2 | Step 6 | `schema_fit` (queue weight) | the Consolidator step |
| Review schedule + events | §6.5 | Step 6 | `review_resurface` | the Consolidator schedules it |
| Reconsolidation via `via_use_id` | proposals + uses | **Step 2** (the rule), Step 6 (Auditor report) | — | contradictions show up as soon as agents report |
| Layered summaries + `source_set_hash` | §6.3 | Step 7 | — | growth step |
| Recall-before-reveal review cards | `review_events.recalled_before_reveal` | Step 7+ | — | UI nicety; serves the person, not agents |

Rule 6 is met: every ranking mechanism is a row in `ranking_signals`, off by default, and every
packet item stores `score_parts`, so a benchmark run with a signal off is a config change plus a
diff of `packet_items`.

---

## 12. Risks from my lens, and what I argue against

1. **Activation hides old decisions** (REVIEW table). Mitigated by the binding section and floor;
   test: a benchmark question about a 6-month-old unused decision must still be answered.
2. **Use-log gaming.** Agents could inflate activation. Mitigated: one counted use per entry,
   actor, hour; activation never touches trust; `acted_on` requires a task reference.
3. **Consolidation amplifying an error** (REVIEW 3C). Mitigated by lineage counting, replay sets,
   proposals-only, and the per-run proposal budget.
4. **Approval load.** Every promotion to long needs a person. Mitigated by batching in the Digest,
   letting unkept items fade (the default is forgetting, which is safe), and measuring approvals.
   If the load is too high, the first relief is REVIEW 3A (evidence-backed observations), not
   automatic promotion.
5. **Against [PF 8] as written** ("a used entry is open to update"): in sky-brain no entry is
   open to update. Only a *proposal* is, and only when tied to a real use.
6. **Against strengthening on exposure:** some memory systems bump `last_accessed` on every search
   hit. That rewards whatever is already ranked high (a rich-get-richer loop) and is the store
   version of retrieval-induced forgetting. Only real uses count.
7. **Against a separate fading job per level:** one sweep, one rule, level-gated. Long and core
   never fade.

---

## Sources

- Atkinson & Shiffrin (1968), *Human memory: a proposed system*: https://rca.ucsd.edu/_files/As68_reprint.pdf
- Baddeley (2000), *The episodic buffer*: https://pubmed.ncbi.nlm.nih.gov/11058819/
- Cowan (2001), *The magical number 4*: https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf
- Tulving, episodic vs semantic (historical review): https://ueaeprints.uea.ac.uk/id/eprint/73863/
- Encoding specificity (Tulving & Thomson 1973): https://en.wikipedia.org/wiki/Encoding_specificity_principle
- Context-dependent memory (Godden & Baddeley 1975): https://en.wikipedia.org/wiki/Context-dependent_memory
- Murre & Dros (2015), *Replication and analysis of Ebbinghaus' forgetting curve*: https://pmc.ncbi.nlm.nih.gov/articles/PMC4492928/
- Anderson & Schooler (1991), *Reflections of the environment in memory*: https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.1991.tb00174.x/
- Petrov (2006), *Computationally efficient approximation of the base-level learning equation in ACT-R*: https://alexpetrov.com/pub/iccm06
- Bjork & Bjork, new theory of disuse (storage vs retrieval strength): https://bjorklab.psych.ucla.edu/research/ and https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf
- Cepeda et al. (2008), *Spacing effects in learning: a temporal ridgeline*: https://pubmed.ncbi.nlm.nih.gov/19076480/
- Karpicke & Roediger (2007), *Expanding retrieval practice promotes short-term retention, but equally spaced retrieval enhances long-term retention*: https://profiles.wustl.edu/en/publications/expanding-retrieval-practice-promotes-short-term-retention-but-eq/
- Roediger & Karpicke (2006), *Test-enhanced learning*: https://pubmed.ncbi.nlm.nih.gov/16507066/
- McClelland, McNaughton & O'Reilly (1995), *Complementary learning systems*: https://pubmed.ncbi.nlm.nih.gov/7624455/
- Diekelmann & Born (2010), *The memory function of sleep*: https://www.nature.com/articles/nrn2762.pdf
- Tse et al. (2007), *Schemas and memory consolidation*: https://pubmed.ncbi.nlm.nih.gov/17412951/
- Bartlett (1932), schema theory: https://en.wikipedia.org/wiki/Frederic_Bartlett
- Nader, Schafe & LeDoux (2000), *Fear memories require protein synthesis in the amygdala for reconsolidation after retrieval*: https://pubmed.ncbi.nlm.nih.gov/10963596/
- Anderson, Bjork & Bjork (1994), *Retrieval-induced forgetting*: https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Anderson_RBjork_EBjork_1994.pdf
- Craik & Lockhart (1972), *Levels of processing*: https://psych205.stanford.edu/papers/CraikLockhart72.pdf
- Fuzzy-trace theory, gist vs verbatim (Brainerd & Reyna): https://en.wikipedia.org/wiki/Fuzzy-trace_theory
- Collins & Loftus (1975) spreading activation; Anderson (1974) fan effect: https://en.wikipedia.org/wiki/Fan_effect
- Illusory truth / repetition and source credibility (review): https://link.springer.com/article/10.1186/s41235-021-00301-5 and https://pubmed.ncbi.nlm.nih.gov/21978908/
- Research-thread findings folded in: `psych-findings.md` (doc: https://claude.ai/artifact/XeikKAahzyCFfoRv8wdoRZ)
