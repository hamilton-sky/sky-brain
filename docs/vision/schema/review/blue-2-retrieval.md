# Blue 2: retrieval, embeddings and search for the four memory levels

Author: blue team member 2 (lens: retrieval). Date: 23 Nov 2026.
Inputs: shared brief, CLAUDE.md, BUILD-PLAN.md (D21/D22, steps 1, 4, 5), REVIEW.md, VISION.md, PLAN.md
§4-6, `apps/server/drizzle/*.sql`, psych-findings.md (items 2-5, 9, 11), and the owner's direction on
summaries (the agent that writes an entry also writes its summary; fallback for people; the Consolidator
re-summarizes; record who wrote each summary and against which version).

## 0. Assumptions about the tables other blue members own

I only add retrieval tables and columns. I assume this shape from the data-model and sharing designs.
Names can change; the joins below are what matter.

- `memories(id, owner_id, level)`: `level IN ('core','long','short','working')`, exactly one `core` per
  owner (partial unique index). Working memories may point at a goal or task.
- `entries(id, memory_id, owner_id, current_version, kind, status, title, body, body_hash,
  valid_from, valid_to, capture_project_id, capture_goal_id, capture_task_id, capture_actor, created_at)`:
  the head row (current version, denormalized for search). History is in append-only
  `entry_versions(entry_id, version, title, body, body_hash, ...)`.
- `entry_links(from_id, to_id, relation, status, ...)`: `status IN ('proposed','accepted','rejected')`.
- Sharing resolves, per request and on the server, the set of memory ids the caller may read
  (`readable_memory_ids`). Every retrieval query below takes that set as a parameter and filters
  **inside** each candidate CTE, never after a LIMIT.

## 1. The short version

1. **Embed the gist, not the body.** Each entry has an append-only chain of summaries in
   `entry_summaries`, written by the agent that writes the entry (required), by a person, or by the
   Consolidator. A fallback "title + first chunk" summary is marked `fallback` and queued for
   re-summarizing. The server embeds: one summary vector, up to three "question this answers" vectors,
   and, only for long bodies, chunk vectors (pointers into the body, so drill-down lands on the right
   section).
2. **Vectors live in their own table** `entry_vectors`, keyed by (entry, facet, ordinal, model) and
   stamped with the entry version and summary it came from. The column is untyped `halfvec`, the model
   and dimension live in `embedding_models`, and each model gets its own partial expression HNSW index,
   so the model can change with a backfill and no table rewrite.
3. **Word search stays on the body**, language-agnostic: `simple` config with a Hebrew normalizer
   (strip niqqud, join gershayim acronyms, add prefix-stripped variants), plus an `english` stem layer
   at low weight, plus `pg_trgm` on titles only for fuzzy and name matching. Title A, summary and
   questions B, body C, variants D. Bodies are size-capped and length-normalized in ranking.
4. **Hybrid = weighted RRF** over word search, summary/question/chunk vector search and title trigram,
   inside the caller's readable memories, then 1-2 hops of spreading activation over accepted links with
   fan damping, then a rerank by activation, goal closeness and capture-context match, then MMR for
   diversity. Each signal has a weight that can be set to 0 (BUILD-PLAN rule 6).
5. **Filtered HNSW at personal scale:** hash-partition `entry_vectors` by owner (32 partitions), keep
   only live long and short entries in the HNSW index, use pgvector 0.8 iterative scans
   (`relaxed_order`) with a re-sort, and take an exact path (no index) when the readable scope holds
   under ~20k vectors, which is most queries.
6. **Per level:** core is always injected whole, never searched; working memory is fetched by the
   claimed task, not searched, and gets no vectors; short-term is hybrid with a strong recency term;
   long-term is hybrid with activation and spreading activation.
7. **Uses, not counters.** `entry_uses` logs real uses (cited, opened, applied, confirmed) with the cue
   context; `retrievals`/`retrieval_hits` log what was shown. Only real uses raise activation
   (testing effect, and no rich-get-richer from mere exposure). Storage strength only grows; retrieval
   strength (ACT-R activation) decays.

## 2. What gets embedded, per level

| Level | Summary vector | Question vectors | Chunk vectors | Word search | Why |
|---|---|---|---|---|---|
| core | no | no | no | yes (for the UI) | Always injected whole; there is nothing to rank. |
| long | yes | yes (0-3) | yes if body > 2,000 chars | yes | The main search target; durable; worth the cost. |
| short | yes | optional | yes if body > 2,000 chars | yes | Episodes and captures. Vectors dropped when the entry fades or is archived; word search still finds it. |
| working | no | no | no | yes | Fetched by task id, small, short-lived. Promoted content becomes a new long/short entry that gets vectors then. |

Vectors exist only for the **current version** of **live, non-quarantined** entries. Quarantined
entries are not embedded until a person releases them (an embedding is a copy of the content sent to a
model provider, and quarantine must mean "not served anywhere").

### 2.1 Who writes the summary (owner direction)

- **Agents (MCP `capture`, `report_task`, and any write):** `summary` is **required on every write**.
  Optional `questions` (0-3, "what future question does this answer?", VISION #7 and psych #5).
  The Gatekeeper refuses a write without a summary with a plain error the agent can fix.
- **People in the web UI:** summary optional. If missing, the server writes a **fallback**:
  title + the first chunk of the body (markdown stripped, cut at a sentence boundary, at most 500
  chars), `source = 'fallback'`, and a Consolidator chore is queued. sky-brain never calls an LLM.
- **The Consolidator** (a Steward in the person's own model, BUILD-PLAN step 6) re-summarizes two
  queues: fallback summaries, and **stale** summaries (the entry's body changed after the summary was
  written). It writes a new summary row; it never edits the body.
- **Short bodies (≤ 500 chars):** the agent still sends a summary; the Gatekeeper accepts a summary
  equal to the body. (A short body is its own gist; the owner's rule targets long markdown.)

### 2.2 Gatekeeper checks on a summary (server code, no LLM)

- Length: 40-500 chars (a summary of 1-3 sentences); each question 10-160 chars; at most 3 questions.
- Not a copy of the first 500 chars of a body longer than 1,500 chars (that is a truncation, not a
  gist): refuse with "write a summary, not the opening".
- Shorter than the body (for bodies over 500 chars, summary length ≤ 50% of body length).
- Same secret scan and quarantine patterns as the body (hard rule 6). An instruction-like summary
  quarantines the entry, like an instruction-like body.
- Word overlap sanity check: at least one content token of the summary appears in title or body
  (catches a summary pasted for the wrong entry). Cheap, using the same normalizer as word search.
- Language: no rule. Hebrew, English or mixed are all fine; the embedding model is multilingual.

### 2.3 The risk the summary creates

Packets show the summary, not the body. An agent summary of an **approved** item can drift from what
the person approved. Mitigations: the summary row records its writer and trust; a summary written by
an agent on an approved entry is shown in the packet as "agent summary of approved item" with a
drill-down pointer; the Digest lists new agent summaries on approved items with Keep/Wrong/Undo; Undo
points the head back at the earlier summary (a new row, nothing is deleted). Importance never raises
trust (D22).

## 3. SQL: text search

```sql
CREATE EXTENSION IF NOT EXISTS vector;   -- 0.8.1 on Nanogres
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Normalize for search: lower case, strip Hebrew niqqud and cantillation (U+0591-U+05C7),
-- join acronyms written with gershayim or a plain quote (צה"ל -> צהל), drop maqaf to a space.
CREATE FUNCTION public.sb_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(
    replace(
      regexp_replace(
        regexp_replace(t, '[֑-ֽֿ-ׇ]', '', 'g'),
        '([א-ת])["״]([א-ת])', '\1\2', 'g'),
      E'־', ' '))
$$;

-- Hebrew attaches prefixes (ה ו ב ל מ ש כ) to words, and the 'simple' parser keeps them, so
-- "הבית" does not match "בית". Emit one- and two-letter prefix-stripped variants of longer words.
-- They go in at the lowest weight. Benchmark-gated (BUILD-PLAN rule 6): drop if it adds noise.
CREATE FUNCTION public.sb_he_variants(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT coalesce(string_agg(v, ' '), '')
  FROM (
    SELECT substr(w, 2) AS v
    FROM regexp_split_to_table(public.sb_norm(t), '[^א-ת]+') AS w
    WHERE length(w) >= 4 AND left(w, 1) IN ('ה','ו','ב','ל','מ','ש','כ')
    UNION ALL
    SELECT substr(w, 3)
    FROM regexp_split_to_table(public.sb_norm(t), '[^א-ת]+') AS w
    WHERE length(w) >= 5 AND left(w, 1) IN ('ו','ש','כ','ב','ל','מ','ה')
                         AND substr(w, 2, 1) IN ('ה','ב','ל','מ','כ','ש')
  ) s
$$;

-- array_to_string is STABLE, so a generated column cannot call it; text[] output does not depend
-- on settings, so this wrapper is safely IMMUTABLE.
CREATE FUNCTION public.sb_join(a text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(array_to_string(a, ' '), '') $$;
```

The head row carries the current summary text and questions (copied from `entry_summaries` when the
head moves), so the generated column can index them:

```sql
ALTER TABLE entries
  ADD COLUMN summary_id      bigint,                 -- current row in entry_summaries
  ADD COLUMN summary         text,                   -- copy of entry_summaries.summary
  ADD COLUMN questions       text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT entries_body_cap CHECK (octet_length(body) <= 262144);  -- 256 KB; hard rule 6

-- Replaces today's english-only column (0000_schema.sql line 49).
ALTER TABLE entries DROP COLUMN search;
ALTER TABLE entries ADD COLUMN search tsvector GENERATED ALWAYS AS (
     setweight(to_tsvector('simple',  public.sb_norm(title)), 'A')
  || setweight(to_tsvector('simple',  public.sb_norm(coalesce(summary, '') || ' ' || public.sb_join(questions))), 'B')
  || setweight(to_tsvector('simple',  public.sb_norm(left(body, 200000))), 'C')
  || setweight(to_tsvector('english', left(body, 200000)), 'D')         -- English stems, low weight
  || setweight(to_tsvector('simple',  public.sb_he_variants(title || ' ' || left(body, 200000))), 'D')
) STORED;

CREATE INDEX entries_search_gin   ON entries USING gin (search);
CREATE INDEX entries_title_trgm   ON entries USING gin (public.sb_norm(title) gin_trgm_ops);
CREATE INDEX entries_scope_recent ON entries (memory_id, created_at DESC);
```

Notes:

- **Why `simple` and not a Hebrew dictionary:** no Hebrew snowball stemmer ships with Postgres, and a
  managed Nanogres will not let us install hunspell `he_IL` files. `simple` + normalizer + variants is
  what we can run everywhere, including PGlite in tests.
- **Mixing configs in one tsvector** is legal. The query side ORs a `simple` tsquery, an `english`
  tsquery and a variants tsquery, so English "decided" matches "decision" via stems while Hebrew matches
  exactly or by prefix variant.
- **Very long bodies:** capped at 256 KB on write; only the first 200,000 chars go into the tsvector
  (tsvector max is 1 MB and position counts saturate at 16,383 anyway). Ranking uses normalization
  flag 1 (divide by 1 + log(length)) so a long body does not win by sheer word count. Bodies over
  2,000 chars also get chunk vectors (section 4), so a hit inside a long body points at its section.
  A chunk-level tsvector is a phase-2 option if drill-down to a span by keyword proves needed.
- **Trigram on title only.** A trigram GIN on bodies is large and slow to update, and body recall is
  already covered by FTS + chunk vectors. Trigram catches typos, transliteration and partial names in
  short queries ("Nanogres", "נאנוגרס").
- **As-of word search** ("what did we believe on 1 Oct?") runs against `entry_versions` with the same
  expression computed at query time; it is rare, so no index there in phase 1.

## 4. SQL: summaries, chunks, vectors, models

### 4.1 Summaries: append-only, with author and version

```sql
CREATE TABLE entry_summaries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id        uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  for_version     int  NOT NULL,          -- the entry version this summary describes
  for_body_hash   bytea NOT NULL,         -- body hash at that version, for stale detection
  summary         text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 500),
  questions       text[] NOT NULL DEFAULT '{}'
                  CHECK (cardinality(questions) <= 3),
  source          text NOT NULL CHECK (source IN ('author','person','consolidator','fallback')),
  written_by_kind text NOT NULL CHECK (written_by_kind IN ('person','agent','server')),
  written_by      text NOT NULL,          -- from the token/session only (hard rule 2)
  run_id          uuid,                   -- the agent run, if any
  replaces        bigint REFERENCES entry_summaries(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (entry_id, for_version) REFERENCES entry_versions(entry_id, version)
);
CREATE INDEX entry_summaries_entry ON entry_summaries (entry_id, id DESC);
-- Append-only, like audit_log: a trigger refuses UPDATE/DELETE (hard forget removes rows via the
-- entry's ON DELETE CASCADE, run by a privileged role).

-- Work queue for the Consolidator: fallback or stale summaries.
CREATE VIEW summaries_needing_work AS
SELECT e.id AS entry_id, e.owner_id, e.memory_id, e.current_version,
       CASE WHEN s.source = 'fallback' THEN 'fallback' ELSE 'stale' END AS reason
FROM entries e
JOIN entry_summaries s ON s.id = e.summary_id
WHERE e.status NOT IN ('quarantined','rejected')
  AND (s.source = 'fallback' OR s.for_body_hash <> e.body_hash);
```

Rules: a new body version from an agent must carry a new summary (Gatekeeper); a new body version from
a person without one keeps the old summary, which then shows up as `stale`. A stale summary keeps being
used (and its vector kept) until the Consolidator replaces it, but chunk vectors are recomputed at once
from the new body, so search does not miss new content.

### 4.2 Chunks of long bodies (pointers, no copied text)

```sql
CREATE TABLE entry_chunks (
  entry_id     uuid NOT NULL,
  version      int  NOT NULL,
  ordinal      smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 23),   -- at most 24 chunks
  char_start   int NOT NULL,
  char_end     int NOT NULL CHECK (char_end > char_start),
  heading_path text,                 -- "Decisions > Hosting" from markdown headings
  text_hash    bytea NOT NULL,
  PRIMARY KEY (entry_id, version, ordinal),
  FOREIGN KEY (entry_id, version) REFERENCES entry_versions(entry_id, version) ON DELETE CASCADE
);
```

Chunking (server code, deterministic): bodies over 2,000 chars are split on markdown headings, then
paragraphs, to ~350-500 tokens with ~10% overlap, at most 24 chunks (a longer body is still fully word-
searchable; it should be split into several entries, and the Gatekeeper can warn). The text embedded
for a chunk is `title + " / " + heading_path + "\n" + chunk` (a contextual header, so a chunk that says
"we chose the second one" still carries its topic). Chunk text is cut from the version body at query
time with the offsets.

### 4.3 Models and vectors

```sql
CREATE TABLE embedding_models (
  id             smallint PRIMARY KEY,
  name           text NOT NULL UNIQUE,      -- e.g. 'bge-m3', 'text-embedding-3-large@1024'
  provider       text NOT NULL,
  dims           int  NOT NULL CHECK (dims BETWEEN 64 AND 4000),   -- halfvec HNSW limit is 4,000
  doc_prefix     text NOT NULL DEFAULT '',   -- e.g. 'passage: ' for e5-style models
  query_prefix   text NOT NULL DEFAULT '',
  max_input_tokens int NOT NULL,
  status         text NOT NULL CHECK (status IN ('backfilling','active','retired')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX embedding_models_one_active ON embedding_models ((true)) WHERE status = 'active';

CREATE TABLE entry_vectors (
  owner_id     uuid NOT NULL,                -- partition key; the brain owner, not the caller
  id           bigint GENERATED ALWAYS AS IDENTITY,
  entry_id     uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  version      int  NOT NULL,                -- entry version the text came from
  summary_id   bigint,                       -- for facet summary/question
  memory_id    uuid NOT NULL,                -- denormalized for filtering
  level        text NOT NULL CHECK (level IN ('long','short')),   -- core/working are never embedded
  facet        text NOT NULL CHECK (facet IN ('summary','question','chunk')),
  ordinal      smallint NOT NULL DEFAULT 0,  -- question number or chunk ordinal
  model_id     smallint NOT NULL REFERENCES embedding_models(id),
  text_hash    bytea NOT NULL,               -- sha256(model name || embedded text)
  embedding    halfvec NOT NULL,             -- untyped: dims live in embedding_models
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, entry_id, facet, ordinal, model_id)
) PARTITION BY HASH (owner_id);

DO $$ BEGIN
  FOR i IN 0..31 LOOP
    EXECUTE format('CREATE TABLE entry_vectors_p%s PARTITION OF entry_vectors
                    FOR VALUES WITH (MODULUS 32, REMAINDER %s)', i, i);
  END LOOP;
END $$;

-- One HNSW index per model, on a cast expression; the cast also rejects a wrong-sized vector on insert.
CREATE INDEX entry_vectors_hnsw_m1 ON entry_vectors
  USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)
  WHERE model_id = 1;
CREATE INDEX entry_vectors_scope ON entry_vectors (owner_id, memory_id, model_id);
CREATE INDEX entry_vectors_entry ON entry_vectors (entry_id);

-- Cue vectors for goals, tasks and projects, embedded when they are created or changed, so that
-- claim_task needs no embedding call (no API latency on the hot path).
CREATE TABLE cue_vectors (
  owner_id     uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('goal','task','project')),
  subject_id   uuid NOT NULL,
  model_id     smallint NOT NULL REFERENCES embedding_models(id),
  text_hash    bytea NOT NULL,
  embedding    halfvec NOT NULL,
  PRIMARY KEY (subject_kind, subject_id, model_id)
);

-- Outbox for embedding work, written in the same transaction as the entry/summary write.
CREATE TABLE embedding_jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id     uuid NOT NULL,
  entry_id     uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  version      int  NOT NULL,
  model_id     smallint NOT NULL REFERENCES embedding_models(id),
  reason       text NOT NULL CHECK (reason IN
               ('new_version','new_summary','model_backfill','released','level_changed','fade_drop')),
  attempts     smallint NOT NULL DEFAULT 0,
  not_before   timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, version, model_id, reason)
);
CREATE INDEX embedding_jobs_ready ON embedding_jobs (not_before) WHERE locked_until IS NULL;
```

Pipeline (Vercel serverless):

1. The write transaction inserts the version, the summary row and an `embedding_jobs` row.
2. After commit, the handler tries the job right away inside `waitUntil` (most entries are searchable
   by vector within a second). A Vercel Cron every minute sweeps leftovers with
   `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 50`, retrying with backoff.
3. The worker builds the texts (summary: `kind: title\nsummary`; each question alone; each chunk with
   its header), hashes them, and calls the model **only for hashes not already stored**. Summary
   changes re-embed only the summary and question rows; a body change re-embeds only changed chunks.
4. It upserts on `(owner_id, entry_id, facet, ordinal, model_id)`, deletes surplus ordinals, and skips
   the write if the entry's `current_version` moved past the job's version (a newer job will run).
5. Quarantine, archive, fade-out and hard forget delete the entry's vectors (hard forget also deletes
   summaries, chunks, uses and hits, BUILD-PLAN step 7).

Changing the model: insert model 2 as `backfilling`, create its partial index
(`WHERE model_id = 2`, cast to its dims), queue `model_backfill` jobs, flip 2 to `active` and 1 to
`retired` in one transaction when the backfill is done, then drop model 1's rows and index. Queries
always use the active model's id and dims, read from `embedding_models`.

### 4.4 Model choice and dimension

The model must be multilingual and strong on Hebrew, because a big reason for vectors here is
**cross-language recall** (a Hebrew question finding an English decision), which word search cannot
do. Candidates to put through the BUILD-PLAN step 0 benchmark (add 15-20 Hebrew and mixed questions):
BGE-M3 (1024, open weights, can be self-hosted), Cohere embed multilingual / embed v4, OpenAI
text-embedding-3-large with `dimensions=1024`, Voyage multilingual, Gemini embedding with a reduced
dimension. Default the schema to **1024 dims as halfvec** (2 KB per vector): it fits every candidate
natively or through Matryoshka truncation, and halves storage against `vector`. Do not pick a model
by reputation; pick by the Hebrew/English benchmark.

Privacy bonus of the owner's rule: only summaries, questions and chunks of long bodies leave for the
provider, never quarantined text. A self-hosted BGE-M3 removes the third party entirely if a family or
lawyer audience needs that (BUILD-PLAN step 8).

## 5. Filtered HNSW at personal scale

The scale: a few hundred users, thousands to ~100k entries each. With ~2.5 vectors per embedded entry
(summary + ~1 question + chunks on a minority), a heavy user has ~250k vectors; the median user a
few tens of thousands. A caller's readable scope is a tiny fraction of the whole table.

The problem: a single global HNSW index with `WHERE memory_id = ANY($readable)` is a post-filter.
HNSW walks `ef_search` neighbours across everybody's vectors and then throws away most of them; with
a selectivity of 0.5% you get a handful of rows or none.

The design, in order of effect:

1. **Hash partitions by owner (32).** Every query names the owners of the readable memories
   (`owner_id = ANY($owners)`), so the planner prunes to 1-3 partitions. Each partition holds roughly
   1/32 of users, so the caller's scope is ~5-20% of what the index walks, not 0.5%.
2. **Only live long and short entries are embedded** (core and working never; faded, archived and
   quarantined entries lose their vectors), so the index stays small and relevant.
3. **pgvector 0.8 iterative index scans.** `SET LOCAL hnsw.iterative_scan = relaxed_order`,
   `hnsw.ef_search = 100`, `hnsw.max_scan_tuples = 20000`. The scan keeps walking the graph until
   enough rows pass the filter or the cap is hit. `relaxed_order` may return rows slightly out of
   order, so the query materializes the candidates and re-sorts by distance (section 7).
4. **Exact path for small scopes.** The server keeps a per-memory vector count (a cheap
   `count(*)` on `entry_vectors_scope`, cached per request). If the readable scope has under ~20k
   vectors (most users, most queries, and every shared memory), it runs the same query with the
   distance expression written so it cannot match the index (`+ 0` on the distance), so Postgres uses
   the scope btree and sorts exactly: 100% recall, ~20k × 2 KB = 40 MB read at worst, tens of ms.
   Above 20k, it uses the HNSW path. The planner in 0.8 estimates filtered HNSW cost better, but an
   explicit rule is easier to test and reason about than planner choice.
5. Index builds: `m = 16, ef_construction = 64` defaults are fine at this scale. Creating an index on
   the partitioned parent cannot be `CONCURRENTLY`; for a new model, build per partition
   concurrently and attach (`CREATE INDEX ON ONLY` parent, then `ALTER INDEX ... ATTACH PARTITION`).

Rough storage at 300 users × 30k embedded entries × 2.5 vectors × ~2.1 KB ≈ 47 GB plus the HNSW
graph. If that is too much for the Nanogres plan, drop to 768 or 512 dims through Matryoshka on a
model that supports it (a new `embedding_models` row, same backfill path), or keep HNSW on long only.
Realistic early numbers are a fraction of this.

## 6. Usage, activation and the testing effect

### 6.1 What we log (psych items 2 and 3)

Two different things, kept apart:

- **Exposure:** what retrieval returned and what went into a packet. Logged in `retrievals` and
  `retrieval_hits`. Never raises activation.
- **Use:** the entry did work. Logged in `entry_uses`. Only this raises activation.

```sql
CREATE TABLE retrievals (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  caller_kind text NOT NULL CHECK (caller_kind IN ('person','agent')),
  caller_id   text NOT NULL,                 -- from the token (hard rule 2)
  purpose     text NOT NULL CHECK (purpose IN ('packet','search','get','ui')),
  task_id     uuid, goal_id uuid, project_id uuid,
  query       text,                          -- kept 90 days, then nulled
  levels      text[] NOT NULL,
  model_id    smallint,
  weights     jsonb NOT NULL,                -- the signal weights used, for the benchmark
  path        text NOT NULL CHECK (path IN ('exact','hnsw','fts_only')),
  latency_ms  int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE retrieval_hits (
  retrieval_id bigint NOT NULL REFERENCES retrievals(id) ON DELETE CASCADE,
  rank         smallint NOT NULL,
  entry_id     uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  version      int NOT NULL,
  in_packet    boolean NOT NULL,             -- shown to the agent, not just ranked
  signals      jsonb NOT NULL,               -- {"fts":3,"vec":1,"hop":null,"act":0.41,...}
  PRIMARY KEY (retrieval_id, rank)
);

CREATE TABLE entry_uses (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id     uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  version      int  NOT NULL,
  owner_id     uuid NOT NULL,
  memory_id    uuid NOT NULL,
  use_kind     text NOT NULL CHECK (use_kind IN
               ('cited',      -- referenced in report_task evidence or in a new entry's derived_from
                'opened',     -- drill-down to the body (get) by a person or agent
                'applied',    -- the task that used it finished done
                'confirmed',  -- a person kept it / answered "still true?" yes
                'corrected')),-- used, but found wrong: logged, no strength gain
  weight       real NOT NULL,                -- set by the server from use_kind, never by the caller
  actor_kind   text NOT NULL CHECK (actor_kind IN ('person','agent','rule')),
  actor_id     text NOT NULL,
  retrieval_id bigint REFERENCES retrievals(id) ON DELETE SET NULL,  -- which cue found it
  task_id      uuid, goal_id uuid, project_id uuid,                   -- the use context (cue)
  episode_key  text NOT NULL,                -- dedupe: task id or session id + hour bucket
  used_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entry_uses_dedupe ON entry_uses (entry_id, use_kind, episode_key);
CREATE INDEX entry_uses_recent ON entry_uses (entry_id, used_at DESC);
-- Append-only trigger, like audit_log.

-- Rollup kept by an AFTER INSERT trigger on entry_uses, so ranking reads one row per candidate.
CREATE TABLE entry_strength (
  entry_id         uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  storage_strength real NOT NULL DEFAULT 0,    -- Bjork: only grows (sum of weights, spaced uses count more)
  n_uses           real NOT NULL DEFAULT 0,    -- weighted count
  first_use        timestamptz,
  last_use         timestamptz,
  recent_uses      timestamptz[] NOT NULL DEFAULT '{}',  -- last 8, newest first
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

Default weights: `confirmed` 2.0, `applied` 1.5, `cited` 1.0, `opened` 0.5, `corrected` 0. Dedupe
means an agent re-opening the same entry ten times in one task is one use (spacing: massed repetition
should not count like spaced uses). The trigger adds more to `storage_strength` when the gap since
`last_use` is longer (e.g. `weight * least(1 + ln(1 + gap_days), 3)`): spaced retrieval builds more
durable storage than massed retrieval.

Linking a use to the `retrieval_id` that surfaced it gives two things for free: which cue routes
actually lead to uses (tune the weights), and a per-entry "shown but never used" rate that the
Consolidator can use to flag noise items (it proposes; it never demotes on its own).

### 6.2 Activation (retrieval strength)

ACT-R base-level activation `B = ln(Σ t_j^-d)`, d = 0.5, time in hours, with the creation itself as
the first presentation. Exact for the last 8 uses, Petrov's (2006) approximation for older ones, so
cost is constant per candidate:

```sql
CREATE FUNCTION sb_activation(n real, created timestamptz, recent timestamptz[], at timestamptz)
RETURNS real LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH r AS (
    SELECT greatest(extract(epoch FROM at - u) / 3600.0, 1.0/60) AS age
    FROM unnest(recent || created) AS u
  ),
  k AS (SELECT count(*)::real AS k, max(age) AS tk, sum(age ^ -0.5) AS exact FROM r),
  life AS (SELECT greatest(extract(epoch FROM at - created) / 3600.0, 1.0/60) AS L)
  SELECT ln( k.exact
           + CASE WHEN n + 1 > k.k AND life.L > k.tk
                  THEN (n + 1 - k.k) * (life.L ^ 0.5 - k.tk ^ 0.5) / (0.5 * (life.L - k.tk))
                  ELSE 0 END )::real
  FROM k, life
$$;
```

### 6.3 How retrieval strengthens memory (testing effect, done safely)

- **Retrieval that is used strengthens; exposure does not.** In people, retrieval practice beats
  re-reading. The analogue is an entry that was retrieved and then did work: cited in evidence, applied
  in a finished task, confirmed. Mere appearance in a packet is re-reading at best, and counting it
  would create a rich-get-richer loop where whatever ranks high keeps ranking high.
- **Effortful retrieval counts more.** A use whose `retrieval_hits.rank` was low, or that was reached
  only through a link hop or a chunk vector (a weak cue), gets weight × 1.25: it is the "desirable
  difficulty" case and it is also the case where ranking was wrong and needs the correction most.
- **Activation changes rank, never trust** (D22, VISION "where not to copy the brain"). A wrong item
  used often stays `proposed`. A `corrected` use adds no strength and, when the reporter attaches a
  correction, proposes a `contradicts` link (reconsolidation as a new version, never an edit, psych #8).
- **Binding items never fade out of rank.** For approved decisions and rules in force, the activation
  term is held at its maximum: activation only orders what is still valid and in scope (BUILD-PLAN
  step 5).
- **Spaced resurfacing** (psych #10, VISION "still true?" checks) is the Consolidator's Digest job;
  retrieval only supplies the signal: important (high storage strength or approved decision) but low
  retrieval strength.

## 7. Hybrid retrieval: the sample query

Parameters (all computed on the server; nothing about identity comes from the request body):

- `$1 uuid[]` readable memory ids at levels long/short for this call
- `$2 uuid[]` owners of those memories (partition pruning)
- `$3 text` query text (for a packet: task title + description; for `search`: the agent's query)
- `$4 halfvec(1024)` query vector (for a packet: the precomputed task cue vector)
- `$5 halfvec(1024)` goal cue vector, or NULL
- `$6 uuid` current goal id, or NULL; `$7 uuid` current project id, or NULL
- `$8 timestamptz` now; `$9 int` result size (packet: 8 candidates for ~4 chunks after MMR)
- `$10 jsonb` weights, e.g. `{"fts":1,"vec":1,"q":0.8,"chunk":0.6,"trg":0.5,"hop":0.5,"act":0.3,"goal":0.3,"ctx":0.2,"recent":0.3}`

```sql
BEGIN;
SET LOCAL hnsw.ef_search = 100;
SET LOCAL hnsw.iterative_scan = relaxed_order;
SET LOCAL hnsw.max_scan_tuples = 20000;

WITH
w AS (SELECT $10::jsonb AS j),
q AS (
  SELECT websearch_to_tsquery('simple',  public.sb_norm($3))
      || websearch_to_tsquery('english', $3)
      || plainto_tsquery('simple', public.sb_he_variants($3)) AS tsq
),

-- Route 1: word search on title, summary, questions, body.
fts AS (
  SELECT e.id, row_number() OVER (ORDER BY ts_rank(e.search, q.tsq, 1) DESC) AS r
  FROM entries e, q
  WHERE e.memory_id = ANY($1)
    AND e.search @@ q.tsq
    AND e.status NOT IN ('quarantined','rejected')
    AND (e.valid_to IS NULL OR e.valid_to > $8)
  ORDER BY ts_rank(e.search, q.tsq, 1) DESC
  LIMIT 50
),

-- Route 2: fuzzy title match, for names and typos (useful for short queries; the server sets
-- its weight to 0 for queries over 6 words).
trg AS (
  SELECT e.id, row_number() OVER (ORDER BY word_similarity(public.sb_norm($3), public.sb_norm(e.title)) DESC) AS r
  FROM entries e
  WHERE e.memory_id = ANY($1)
    AND public.sb_norm($3) <% public.sb_norm(e.title)
    AND e.status NOT IN ('quarantined','rejected')
  ORDER BY word_similarity(public.sb_norm($3), public.sb_norm(e.title)) DESC
  LIMIT 20
),

-- Route 3: vectors (summary, questions, chunks), filtered inside the index scan.
-- relaxed_order can return rows a little out of order, so materialize and re-sort below.
vec_raw AS MATERIALIZED (
  SELECT v.entry_id, v.facet, v.version,
         (v.embedding::halfvec(1024)) <=> $4::halfvec(1024) AS dist
  FROM entry_vectors v
  WHERE v.owner_id  = ANY($2)
    AND v.memory_id = ANY($1)
    AND v.model_id  = 1                      -- matches the partial index predicate
  ORDER BY (v.embedding::halfvec(1024)) <=> $4::halfvec(1024)
  -- exact path for small scopes: the server writes "... <=> $4::halfvec(1024) + 0" here
  LIMIT 200
),
vec AS (   -- one rank list per facet, each entry at its best-matching vector of that facet
  SELECT entry_id, facet,
         row_number() OVER (PARTITION BY facet ORDER BY min(dist)) AS r
  FROM vec_raw
  GROUP BY entry_id, facet
),

-- Weighted reciprocal rank fusion, k = 60.
fused AS (
  SELECT id, sum(wt / (60.0 + r)) AS rrf, jsonb_object_agg(route, r) AS ranks
  FROM (
    SELECT id, r, (SELECT (j->>'fts')::float FROM w) AS wt, 'fts' AS route FROM fts
    UNION ALL
    SELECT id, r, (SELECT (j->>'trg')::float FROM w), 'trg' FROM trg
    UNION ALL
    SELECT entry_id, r,
           (SELECT CASE facet WHEN 'summary'  THEN (j->>'vec')::float
                              WHEN 'question' THEN (j->>'q')::float
                              ELSE                 (j->>'chunk')::float END FROM w),
           'vec_' || facet
    FROM vec WHERE r <= 50
  ) s
  GROUP BY id
),
seeds AS (
  SELECT f.id, f.rrf FROM fused f
  JOIN entries e ON e.id = f.id
  WHERE e.status NOT IN ('quarantined','rejected')
  ORDER BY f.rrf DESC LIMIT 20
),

-- Spreading activation: 1-2 hops over ACCEPTED links, only into readable memories,
-- damped by fan (S - ln(fan), S = 2) and by relation type. Both directions for symmetric types.
rel(relation, rw) AS (VALUES
  ('derived_from',1.0), ('depends_on',1.0), ('supersedes',0.9), ('answers',0.9),
  ('supports',0.7), ('contradicts',0.8), ('part_of',0.6), ('about',0.5), ('related',0.3)),
edges AS (
  SELECT l.from_id AS a, l.to_id AS b, rel.rw FROM entry_links l JOIN rel USING (relation)
  WHERE l.status = 'accepted'
  UNION ALL
  SELECT l.to_id, l.from_id, rel.rw FROM entry_links l JOIN rel USING (relation)
  WHERE l.status = 'accepted'
),
fan AS (SELECT a, count(*) AS n FROM edges WHERE a IN (SELECT id FROM seeds) GROUP BY a),
hop1 AS (
  SELECT ed.b AS id, max(s.rrf * ed.rw * greatest(0, 2 - ln(f.n)) / 2) AS spread
  FROM seeds s JOIN edges ed ON ed.a = s.id JOIN fan f ON f.a = s.id
  JOIN entries e ON e.id = ed.b
  WHERE e.memory_id = ANY($1) AND e.status NOT IN ('quarantined','rejected')
    AND (e.valid_to IS NULL OR e.valid_to > $8)
  GROUP BY ed.b
),
hop2 AS (
  SELECT ed.b AS id, max(h.spread * 0.5 * ed.rw) AS spread
  FROM (SELECT * FROM hop1 ORDER BY spread DESC LIMIT 10) h
  JOIN edges ed ON ed.a = h.id
  JOIN entries e ON e.id = ed.b
  WHERE e.memory_id = ANY($1) AND e.status NOT IN ('quarantined','rejected')
    AND (e.valid_to IS NULL OR e.valid_to > $8)
  GROUP BY ed.b
),

-- Candidates: fused list plus anything reached by spreading.
cand AS (
  SELECT id, max(rrf) AS rrf, max(spread) AS spread
  FROM (
    SELECT id, rrf, 0::float AS spread FROM fused
    UNION ALL SELECT id, 0, spread FROM hop1
    UNION ALL SELECT id, 0, spread FROM hop2
  ) u GROUP BY id
),
scored AS (
  SELECT e.id, e.memory_id, e.kind, e.status, e.title, e.summary, m.level,
         c.rrf, c.spread,
         sb_activation(coalesce(st.n_uses,0), e.created_at, coalesce(st.recent_uses,'{}'), $8) AS act,
         -- goal closeness (attention): exact distance on the summary vector, <= ~100 rows
         CASE WHEN $5 IS NULL THEN 0
              ELSE 1 - ((sv.embedding::halfvec(1024)) <=> $5::halfvec(1024)) END AS goal_sim,
         -- encoding specificity: same goal or project as when it was captured
         (CASE WHEN e.capture_goal_id = $6 THEN 1.0
               WHEN e.capture_project_id = $7 THEN 0.5 ELSE 0 END) AS ctx,
         exp(- extract(epoch FROM $8 - e.created_at) / (72 * 3600.0)) AS recency
  FROM cand c
  JOIN entries  e ON e.id = c.id
  JOIN memories m ON m.id = e.memory_id
  LEFT JOIN entry_strength st ON st.entry_id = e.id
  LEFT JOIN entry_vectors sv
         ON sv.owner_id = e.owner_id AND sv.entry_id = e.id
        AND sv.facet = 'summary' AND sv.ordinal = 0 AND sv.model_id = 1
),
mx AS (SELECT nullif(max(rrf), 0) AS max_rrf FROM scored),
final AS (
  SELECT s.*,
        s.rrf / mx.max_rrf
      + (w.j->>'hop')::float  * s.spread / mx.max_rrf
      + (w.j->>'act')::float  * CASE WHEN s.kind IN ('decision','rule') AND s.status = 'approved'
                                     THEN 1.0                        -- binding items never fade
                                     ELSE 1 / (1 + exp(-s.act)) END  -- squash to 0..1
      + (w.j->>'goal')::float * s.goal_sim
      + (w.j->>'ctx')::float  * s.ctx
      + CASE WHEN s.level = 'short' THEN (w.j->>'recent')::float * s.recency ELSE 0 END
        AS score
  FROM scored s, mx, w
)
SELECT id, level, kind, status, title, summary, score, rrf, spread, act, goal_sim, ctx
FROM final
ORDER BY score DESC
LIMIT 3 * $9;    -- the server runs MMR over this list and keeps $9
COMMIT;
```

After SQL, in server code:

- **MMR for diversity (psych #9):** pick greedily by `λ·score − (1−λ)·max cosine to already-picked`,
  λ = 0.7, using the summary vectors already fetched. Near-duplicates collapse to the better one, and
  the packet gets ~4 distinct chunks instead of four phrasings of one fact.
- Each returned item carries its pointer: entry id, version, and for chunk hits the chunk offsets, so
  drill-down (`get`) lands on the section. The packet renders summary + label (kind, trust, author,
  summary writer, source), fenced as data (hard rule 7).
- The server writes one `retrievals` row and the `retrieval_hits` rows (with `signals`) for the
  benchmark and for linking later uses.

## 8. Per-level retrieval policy and the packet

The packet (`claim_task`/`next_task`) is built in this order, each part with its own budget; the
agent can ask for more (REVIEW D: adaptive, minimum sufficient context):

| Part | Level | How it is fetched | Budget (default) |
|---|---|---|---|
| 1. Self-schema | core | All approved core entries of the brain owner, in section order. No search, no ranking. The core memory is size-capped at write (e.g. 1,500 tokens) so it always fits. | fixed, ~1.5k tokens |
| 2. The task's blackboard | working | Entries of the working memory bound to the claimed task (and its goal), newest first, pinned first, plus the resume note of the last release. No vectors. Cleared (archived) when the task is done; the outcome becomes a short-term episode (psych #11). | ~1.5k tokens |
| 3. Intentions | (table from data model) | "when X, do Y" rows whose X matches the task's goal/project/tags. | small |
| 4. Relevant memory | long + short | The hybrid query above with `$3/$4` = the task text and its precomputed cue vector, `$5` = the goal's cue vector, MMR to ~4 chunks (Cowan). | ~4 chunks, each a summary + pointer |
| 5. What we don't know | derived | From the same candidates: contradicting links among them, top items resting on one unverified source, "no approved decision on X" when the top hits are all proposals. | short lines |

Level-specific weights inside part 4 (the same query, different `$10`):

- **Long-term:** relevance (RRF) first, then activation, goal closeness and spreading. Recency weight 0.
  Old approved decisions keep full activation.
- **Short-term** (really the recent-episode store, days to weeks): RRF plus a strong recency term
  (72-hour scale) plus activation; spreading weight lower (episodes are rarely well linked yet).
  Expired or faded short entries lose their vectors and drop out of vector search, but stay word-
  searchable until archived.
- **Working:** not part of the hybrid at all. The MCP `search` tool, when asked for working scope,
  does word search only within the caller's readable working memories.
- **Core:** not searched in packets. The web UI can word-search it.

### 8.1 What the cue carries (encoding specificity, psych #4)

A packet query is not just text. It carries: the task title and description (text cue and its
precomputed vector), the goal (goal vector for attention, goal id for context match), the project id,
and the entries touched in this task so far. Entries touched in the last few hours get a short boost
through activation (their recent uses), and they are also extra seeds for spreading: the server adds
up to 5 recently used entries in this task to `seeds` with a fixed seed score, so the walk starts from
what the agent is actually working on (Collins and Loftus priming), not only from the query.

Each entry stores its encoding context (`capture_project_id`, `capture_goal_id`, `capture_task_id`,
`capture_actor`); each use stores its use context. Context match is an equality test, not a model.

### 8.2 Spreading activation details

- Only `accepted` links spread. Proposed links never move rank (link spam defense, VISION).
- Hops never leave the readable set: every hop joins `entries` and checks `memory_id = ANY($1)`. A link
  into a memory the caller cannot read is invisible, and its existence does not change the score
  (otherwise rank changes would leak that a hidden neighbour exists).
- Fan damping `S − ln(fan)` with S = 2: a hub with more than e² ≈ 7 links spreads nothing. Hop 2 is
  half of hop 1 and starts only from the 10 best hop-1 nodes, so the walk is bounded at a few hundred
  rows.
- `supersedes`: a hit on an old version spreads to its replacement, so the packet shows the current
  decision with "replaced X" rather than the stale one.

## 9. Security and tests (retrieval-specific)

- Filters live **inside** each candidate CTE (FTS, trigram, vector, both hops). A filter after LIMIT
  would let other people's vectors take the top slots: wrong results, and a timing/ranking side channel.
- Tests, each with an allowed and a refused case (CLAUDE.md): a vector, a word hit, a trigram hit and a
  linked neighbour in another owner's memory never appear; a memory shared read-only appears; a
  quarantined entry has no vectors and no hits; a revoked share disappears from the next query; the
  exact path and the HNSW path return the same top 10 on a seeded fixture.
- `retrievals.query` is personal text: same retention and hard-forget rules as entries.
- The embedding provider receives summaries, questions and long-body chunks. Never quarantined text,
  never core or working memory (they are not embedded).

## 10. Build order fit (D21)

- **Step 1 (reliable memory):** `sb_norm`, `sb_he_variants`, the new `search` column, trigram index,
  `entry_summaries` (summary required on agent writes from day one, so step 4 has data to embed), the
  `entry_uses` log and `retrievals`/`retrieval_hits` (needed for the benchmark anyway).
- **Step 2/3:** packet uses word search + core + working; uses are logged; benchmark baseline.
- **Step 4 (hybrid):** `embedding_models`, `entry_vectors`, `entry_chunks`, `cue_vectors`,
  `embedding_jobs`, the hybrid query with hops. Gate: beats word search alone, including Hebrew and
  cross-language questions.
- **Step 5:** turn on act, goal and ctx weights one at a time; keep each only if it wins.

## 11. Rejected alternatives

| Alternative | Why not |
|---|---|
| Embed the full body | Owner rule. Also: long bodies dilute the vector (one vector for ten topics), exceed model input limits (silent truncation), and send all text to the provider. |
| One `embedding` column on `entries` (the sketch) | One vector per entry only; changing model means rewriting every row and index; every body edit rewrites a wide row; no question or chunk vectors. |
| Server writes summaries with an LLM | sky-brain calls no LLM (BUILD-PLAN rule 5). The writer agent is already an LLM and knows what it meant; the Consolidator covers the rest in the person's model. |
| Fallback = no vector until summarized | People's entries would be invisible to semantic search for hours or days. Title + first chunk, marked fallback, is good enough meanwhile. |
| Summary edited in place on the entry | Breaks "nothing is edited in place" and loses who wrote which summary for which version. Hence the append-only `entry_summaries`. |
| Separate vector database | Copies data to a second store and bypasses the membership filter (VISION follow-up 3). |
| One global HNSW, filter after | Post-filtering a 0.5%-selective filter returns too few rows; even iterative scans would walk far. |
| A partial HNSW index per user or per memory | Hundreds to thousands of indexes, DDL at sign-up and at every new memory, planner overhead, painful model changes. Hash partitions give most of the benefit with 32 fixed indexes. |
| LIST partition per user | Same DDL-per-user problem; uneven partitions. |
| IVFFlat | Needs training on representative data and re-training as data grows; worse recall on small, changing sets. |
| `vector` (fp32) instead of `halfvec` | Twice the storage and memory for no measurable recall gain at 1024 dims. |
| Binary quantization + rerank | Worth it at tens of millions of vectors; not at personal scale. Revisit if storage bites. |
| `english` config only (today's column) | Breaks Hebrew: stems and stop words are English-only. |
| Hunspell/Hebrew dictionary | Cannot install dictionary files on managed Nanogres; not in PGlite tests. |
| BM25 extensions (pg_search, VectorChord-bm25) | Not available on Nanogres; `ts_rank` with length normalization plus RRF is enough. |
| Trigram index on bodies | Large, slow to update; FTS + chunk vectors already cover body recall. |
| `use_count` + `last_used` counters (the sketch) | Cannot compute ACT-R activation or spacing; cannot tell a use from an exposure; cannot tell which cue found it. |
| Strengthen on every retrieval | Rich-get-richer loop; repetition is not evidence (VISION). Only real uses count. |
| Activation as its own RRF list | Would pull popular but irrelevant items into results. Activation only reorders candidates that relevance already found. |
| Pavlik-Anderson spacing-dependent decay per use | Better spacing model, but needs per-use decay state and tuning; ACT-R plus spaced-gap storage bonus is enough until the benchmark says otherwise. |
| Sparse vectors (BGE-M3 sparse, `sparsevec`) | A third route to tune; FTS already plays the lexical role. Possible later if Hebrew FTS stays weak. |
| Unbounded graph walk / recursive CTE to depth N | Fan explosion and latency; 1-2 hops with damping is what the spreading-activation literature and ACT-R fan effect support. |

## 12. Open points for the red team and the owner

1. Agent summaries of approved items: is the label + Digest Undo enough, or should an agent's
   summary of an approved item stay `proposed` (old summary keeps being served) until the person keeps it?
2. Short bodies: is "summary may equal the body under 500 chars" acceptable under the owner's rule?
3. Exact-path threshold (20k vectors) and partition count (32) are guesses to check on the real plan's
   hardware.
4. Hebrew prefix variants may add false matches ("מלך" stripped from "ממלך"…); benchmark-gated.
5. The query vector for a free-text `search` call costs one embedding API call (~100-300 ms). Packets
   avoid it through `cue_vectors`; a small query-embedding cache (hash → vector, 1 day) covers repeats.
