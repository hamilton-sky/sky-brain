# Red 3: scale, performance, cost and operations

Lens: what breaks or costs too much on Nanogres (PgBouncer transaction mode on :6432, migrate role
on :6433, pgvector 0.8.1) plus Vercel functions (`vercel.json` sets `maxDuration: 60`, pool `max: 3`
per instance, migrations run inside `buildCommand`), at a few hundred users with up to ~100k
entries each.

How I checked: I ran a throwaway Postgres 16.15 (pg_trgm only, no pgvector on this box), loaded
600k entries spread over 300 owners plus one 100k-entry owner, and timed the blue queries
with and without the blue-3 RLS policies. I also checked the pgvector 0.8 iterative-scan docs and
the Vercel cron, duration and background-work docs (links at the end). The vector findings are
reasoned from documented pgvector behaviour, because I could not run pgvector here.

---

## Findings

### R3-01 (critical): RLS turns off the full-text and trigram indexes. Search becomes a scan of the whole scope

**Where:** blue-3 §5.5 (RLS with `FORCE` on `entries` and every content table) together with blue-2 §7
routes `fts` and `trg`, and blue-1/blue-2 GIN indexes.

**Failure.** Postgres applies RLS quals first. A user qual may become an index condition only
when its operator is `LEAKPROOF`. The catalog on PG16 shows:

```
 @@  ts_match_vq         proleakproof = f
 <%  word_similarity_op  proleakproof = f
 =   uuid_eq             proleakproof = t
```

So under `SET ROLE sky_app`, `search @@ tsq` and `q <% title` are never used as index conditions. The
planner fetches every row in the readable scope through the `memory_id` btree and runs `@@` on
each detoasted tsvector. Measured on the 100k-entry owner (bodies of about 400 words):

| Same query | Plan | Time |
|---|---|---|
| superuser, explicit `memory_id = ANY(...) AND search @@ q` | BitmapAnd(GIN, btree) | **5 ms** |
| `sky_app` under the blue-3 policy | btree on memory_id, then Filter `@@` on 100k rows | **490-510 ms** |
| `sky_app`, top 50 by `ts_rank` | same | **482 ms** |
| trigram `<%` on titles (2k-row scope) | Filter, not index | 8 ms vs ~1 ms |

Real bodies run up to 256 KB. Their tsvectors are TOASTed, so the cost grows with body size. The
hybrid query runs this route once per packet and once per search, and as-of search (12.2) and
the Consolidator's replay sets each run it too. RLS does not change the vector route: `<=>` is an
ORDER BY, not a qual, and the RLS qual just filters the HNSW iterative scan.

**Second defect, in the same policies:** `memory_id = ANY ((SELECT app_readable_memories()))`
does not compile. With the double parentheses, Postgres parses `ANY` as `ANY (subquery)`:
`ERROR: operator does not exist: uuid = uuid[]`. I reproduced it. Fix:
`memory_id = ANY ((SELECT app_readable_memories())::uuid[])`. The cast keeps the InitPlan and
makes the argument an array.

**Smallest fix (tested: 26 ms, and a missing `app.person` returns nothing).** Keep RLS as the
fail-closed default for ad-hoc queries. Run the retrieval routes through `SECURITY DEFINER`
functions owned by a dedicated NOLOGIN role that a permissive policy lets read. Each function
applies the readable-set filter itself, computed from the same `app.person` setting:

```sql
CREATE ROLE sky_search NOLOGIN;
GRANT SELECT ON entries, entry_vectors, entry_links, memories, memory_grants TO sky_search;
CREATE POLICY search_fn ON entries       FOR SELECT TO sky_search USING (true);
CREATE POLICY search_fn ON entry_vectors FOR SELECT TO sky_search USING (true);
CREATE POLICY search_fn ON entry_links   FOR SELECT TO sky_search USING (true);

CREATE FUNCTION search_fts(q tsquery, lim int) RETURNS TABLE (id uuid, r bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, row_number() OVER (ORDER BY ts_rank(e.search, q, 1) DESC)
  FROM entries e
  WHERE e.memory_id = ANY (app_readable_memories())   -- the filter lives in the function body
    AND e.search @@ q
  ORDER BY ts_rank(e.search, q, 1) DESC LIMIT lim $$;
ALTER FUNCTION search_fts(tsquery, int) OWNER TO sky_search;
REVOKE ALL ON FUNCTION search_fts(tsquery, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_fts(tsquery, int) TO sky_app;
```

The whole blue-2 hybrid query becomes one such function (`hybrid_search(...)`), with the filter
inside every CTE as blue-2 already writes it. Add a CI rule that every function owned by
`sky_search` references `app_readable_memories()`, and keep the blue-3 refused-case tests
running through these functions. Open check: Nanogres must let the migrate role create a NOLOGIN
role. If it cannot, the fallback is to drop `FORCE` on `entries` and have the table owner own
the search functions. RLS still applies to `sky_app`.

### R3-02 (high): the spreading-activation CTE reads the whole `entry_links` table, both directions, on every query

**Where:** blue-2 §7, CTE `edges`, which `fan`, `hop1` and `hop2` each reference.

**Failure.** A CTE referenced more than once is materialized (PG12+), and the seed filter is not
pushed into it. Every packet therefore scans every accepted link of every user twice, once per
direction. RLS on `entry_links` (blue-3) adds a per-row array check and still has no index on
`from_memory_id`. Measured with 1M links and 20 seeds: the plan shows
`CTE edges -> Append (actual rows=2000000)`, two Seq Scans and three CTE Scans of 2M rows, in
**1,620 ms**. blue-1 creates links on every consolidation (`derived_from`), task finding
(`part_of`) and legacy ref (`related`), so 1M links is reached at a few thousand links per user.

**Fix (tested: 5.5 ms, same result):** walk from the seeds with index lookups. Compute fan from
the same lateral rows:

```sql
nb1 AS MATERIALIZED (
  SELECT s.id AS a, s.rrf, n.b, n.rw, count(*) OVER (PARTITION BY s.id) AS fan
  FROM seeds s CROSS JOIN LATERAL (
    SELECT l.to_entry, rel.rw FROM entry_links l JOIN rel USING (relation)
     WHERE l.from_entry = s.id AND l.status = 'accepted' AND l.ended_at IS NULL
    UNION ALL
    SELECT l.from_entry, rel.rw FROM entry_links l JOIN rel USING (relation)
     WHERE l.to_entry = s.id AND l.status = 'accepted' AND l.ended_at IS NULL) n(b, rw)),
hop1 AS MATERIALIZED (SELECT b AS id, max(rrf * rw * greatest(0, 2 - ln(fan)) / 2) AS spread
                      FROM nb1 JOIN entries e ON e.id = nb1.b
                      WHERE e.memory_id = ANY (app_readable_memories()) GROUP BY b),
-- hop2: same LATERAL from the top 10 of hop1
```

This uses blue-1's `entry_links_from_idx` and `entry_links_to_idx`. Add a cap per seed:
`LIMIT 50` inside each lateral branch, ordered by `rw DESC`. Without it, a hub with 10k links
reads 10k rows only to get a spread of 0 (fan damping gives 0 above e² ≈ 7 links).

### R3-03 (high): the embedding outbox has no reliable drainer on this platform, and its ready-index hides stuck jobs

**Where:** blue-2 §4.3, `embedding_jobs` and the "Pipeline (Vercel serverless)" steps.

Concrete failures:

1. **"Vercel Cron every minute" fails to deploy on Hobby.** Hobby allows one run per day, with
   ±59 min precision. A more frequent expression fails the deploy (Vercel docs, "Hobby scheduling
   limits"). Pro allows once per minute. The repo does not record the plan. Today
   `maxDuration: 60` is set, which fits either plan.
2. **`waitUntil` has no retries.** Work is lost when the function fails or hits its max duration
   (Vercel KB "background workers"). That is acceptable only because the job row survives, and
   only if something else drains it.
3. **Stuck leases are invisible.** The ready index is `ON embedding_jobs (not_before) WHERE
   locked_until IS NULL`. A worker that sets `locked_until` and then dies (60 s timeout, instance
   suspended) leaves the row out of that index forever. The sweeper's
   `WHERE locked_until IS NULL` never sees it, and the entry never gets a vector. If the worker
   instead locks with `FOR UPDATE SKIP LOCKED` and keeps the transaction open while it calls the
   API, it holds one of the instance's **3** pool connections and a PgBouncer server connection
   for the whole batch: 50 jobs × 100-300 ms = 5-15 s. Concurrent MCP requests on that instance
   then queue behind it.
4. **One API call per job.** A 10k-entry import fires 10k `waitUntil` calls at once and hits the
   provider's 429s. Every failure then waits for the sweeper.
5. **No finished state.** Nothing says a done job is deleted, so the table only grows.

**Fix (the cheapest design that works on Hobby and on Pro):**

```sql
ALTER TABLE embedding_jobs DROP COLUMN locked_until,
  ADD COLUMN ready_at timestamptz NOT NULL DEFAULT now(),   -- not_before, or lease end while leased
  ADD COLUMN leased boolean NOT NULL DEFAULT false;
DROP INDEX embedding_jobs_ready;
CREATE INDEX embedding_jobs_ready ON embedding_jobs (ready_at);  -- expired leases come back on their own

-- claim (short transaction, committed before any API call)
UPDATE embedding_jobs SET leased = true, attempts = attempts + 1,
       ready_at = now() + interval '2 minutes'
WHERE id IN (SELECT id FROM embedding_jobs WHERE ready_at <= now() AND attempts < 8
             ORDER BY ready_at LIMIT 64 FOR UPDATE SKIP LOCKED)
RETURNING id, entry_id, version, model_id;
-- then: one batched provider call (64 inputs), then one write transaction that upserts the vectors
-- and DELETEs the finished jobs. On failure: ready_at = now() + 2^attempts minutes.
-- attempts >= 8 is the dead-letter set, shown in an ops view.
```

Drainers, all calling the same idempotent `drain(maxMs = 20s)`:

- (a) after any write, in `waitUntil`;
- (b) after any MCP or API request when the queue's oldest `ready_at` is more than 30 s old (a
  cheap indexed `min(ready_at)` check);
- (c) a cron: every minute on Pro, daily on Hobby;
- (d) for model backfills, a manual script or the provider's batch API, never the request path.

Search must never wait on vectors. Blue-2 already lets FTS find an entry before it is embedded;
keep that as a rule.

### R3-04 (high): vectors cost more storage and RAM than all the text, and the HNSW index will not stay in cache

**Where:** blue-2 §2 and §4.3-§5 (summary + 0-3 question vectors + up to 24 chunk vectors,
1024-d halfvec, HNSW on long and short).

**Numbers.** One 1024-d halfvec is 2,056 bytes. The heap row is about 2.2 KB and the HNSW entry
about 2.3 KB (vector plus about 2·m neighbour TIDs on layer 0). At blue-2's own 2.5 vectors per
embedded entry, that is about **11 KB of vector data per entry**, against about 3-6 KB for the
entry's text (head row, tsvector and GIN entries). Blue-2 estimates 47 GB of heap, plus about the
same again in HNSW. HNSW latency stays good only while the index is cache-resident: it is a
random walk over pages, and once the working set exceeds RAM, every hop is a disk read. A
managed plan sized for "a few hundred users" will not hold 50-100 GB hot.

**Hidden cost:** a 2,056-byte value pushes the row past the ~2 KB TOAST threshold. pgvector
types allow out-of-line storage, so each vector goes to the TOAST table. Blue-2's "exact path,
20k vectors, tens of ms" then pays one extra TOAST index probe and heap fetch per row, twice the
buffer reads that blue-2 assumed. At 768 dims (1,544 B) the row stays inline.

**Fix: the cheapest design that keeps every feature** (each step benchmark-gated, BUILD-PLAN
rule 6):

1. **One vector per entry by default.** Embed `title + summary + questions` as one text. The
   owner's timeline note ("each agent should summarize the body and that should be the vector")
   is exactly this, and it is also the cheapest option. Separate question vectors only if the
   benchmark shows they win.
2. **Chunk vectors only for bodies over ~8k chars, at most 8.** Shorter bodies are covered by
   the summary plus FTS on the body.
3. **768 dims halfvec** through Matryoshka truncation, if the chosen model supports it and the
   Hebrew/English benchmark holds. This is 1.5 KB per vector, stays inline, and cuts index size by
   25% against 1024.
4. **HNSW only on `level = 'long'`** (partial predicate). Short memories, which are recent and
   bounded by the fade timer, use the exact path through the `(owner_id, memory_id, model_id)`
   btree. This also removes R3-05's churn.

Result: about 1.2 vectors × ~3.3 KB, so **~4 KB per long entry and ~1.8 KB per short entry**, a
**3-6× smaller** vector footprint. Embedding API cost is trivial either way: about 150 tokens per
entry, so 5M entries is 0.75B tokens, about $15-100 depending on the model. The binding limits
are RAM and the provider's rate limits, not money.

### R3-05 (medium): the short layer is the worst case for HNSW churn

**Where:** blue-2 §2 and §4.3 step 5 (vectors are dropped on fade, archive and quarantine;
re-upserted on every summary or chunk change), with blue-4 §5 (short fades in 14-41 days).

**Failure.** Every short entry is inserted into the HNSW graph and deleted weeks later.
Vacuuming HNSW deletes is a slow graph repair; the pgvector docs advise a reindex before
vacuuming a heavily changed index. Each summary rewrite is a new heap tuple, so a new graph
insert plus a dead entry. Until vacuum runs, dead entries use up the iterative scan's
`max_scan_tuples` budget (20,000 by default) and lower recall.

**Fix:** R3-04 step 4 (no HNSW for short). Promotion to long creates a new entry (blue-1), whose
vector is inserted once. Add a monthly per-partition `REINDEX INDEX CONCURRENTLY`, run by the ops
script (R3-11), only when the pgstattuple dead fraction of an index passes 20%.

### R3-06 (medium): the exact-versus-HNSW choice is made on the whole scope, so a grantee's shared slice gets near-zero recall

**Where:** blue-2 §5 items 1, 3 and 4; blue-3 §7.3.

**Failure scenario.** Dana owns 30k vectors and holds a grant on Shammai's "Kitchen" memory
(500 vectors). Shammai's hash partition holds about 300k vectors, including Shammai's own. The
total scope is 30.5k, above the 20k threshold, so the HNSW path runs on both partitions. In
Shammai's partition the filter `memory_id = ANY($1)` keeps 0.17% of rows. With
`max_scan_tuples = 20000`, the iterative scan visits 20k tuples, finds about 34 matches in
relaxed order, and spends 20k tuple visits on cold pages of a partition Dana's queries rarely
warm. Results from the shared memory are thin and slow. This is the sharing case the product
exists for.

**Fix:** decide the path per owner slice, not per query. The server groups the readable memories
by owner (it already passes `$2`) and emits one `UNION ALL` branch per owner:

```sql
-- per owner o with slice count c_o (cheap count on entry_vectors_scope, cached 60 s per owner):
--   c_o <  20000 : exact  -> ORDER BY (embedding::halfvec(768)) <=> $q + 0  LIMIT 100
--   c_o >= 20000 : HNSW   -> SET LOCAL hnsw.iterative_scan = relaxed_order; LIMIT 100
-- then merge the branches, re-sort, and keep 200.
```

With R3-04 step 4, only big long-memory slices ever take HNSW. Hash partitioning by owner (32)
then holds up: it prunes to the owners in the scope, and a heavy owner's slice is a large
fraction of their partition.

### R3-07 (high): write amplification. Full body copies per version, and the head cache rewritten (and re-indexed) on every version

**Where:** blue-1 §4.2 and §4.3 (`resummarize`, `lifecycle` and `refile` are new
`entry_versions` rows that copy title, body and provenance; the after-insert trigger rewrites
`entries` including `search`); blue-1 §4 (create = INSERT with `head_version 0`, then UPDATE).

**Failures, measured:**

- A typical entry gets 3-4 versions in its life (create, the Consolidator's re-summary of a
  fallback, `consolidated`, an approval), but its text changes only once or twice. Each version
  stores the body again, up to 256 KB. At an average body of 4 KB, a 100k-entry brain carries
  about 0.8-1.2 GB of duplicate bodies.
- On each version the trigger recomputes `search` from the body. The blue-2 expression costs
  **151 ms on a ~200k-char Hebrew/English body** and 3 ms on 4 KB (measured).
- Each head rewrite is a non-HOT update: `lifecycle`, `trust` and `seq` are in indexes. Every
  index on `entries` gets a new entry, including GIN, which re-inserts every lexeme. Measured on
  20k rows with 400-word bodies: one lifecycle-only rewrite took **50 s (2.5 ms per row) and
  doubled the GIN index from 12 MB to 24 MB** until vacuum.
- Create inserts the row and then updates it in the same transaction, so every btree gets two
  entries and the heap gets a dead tuple per entry.

**Fix (rules):**

```sql
-- 1. Text only on versions that change it. content_from_version already exists.
ALTER TABLE entry_versions ALTER COLUMN body DROP NOT NULL,
  ADD CONSTRAINT ev_body_only_on_content
  CHECK ((content_from_version = version_no) = (body IS NOT NULL));
-- Readers take the body from (entry_id, content_from_version).

-- 2. Summaries are not versions: use blue-2's append-only entry_summaries (no body copy).
--    Drop change = 'resummarize' and the summary columns from entry_versions.

-- 3. The trigger recomputes search only when the text changed:
--    IF NEW.content_from_version = NEW.version_no OR summary changed THEN recompute ELSE keep.

-- 4. Create writes a full head row in one INSERT (the API computes the head fields;
--    the trigger checks that they equal the version) instead of INSERT + UPDATE.
```

Lifecycle stays a mutable field with an events log (blue-4 §0 item 3), not a content version.
That is also the cheaper choice. Per agent capture this leaves about 8 row writes: entry, version,
summary, job, evidence, queue item, stats, use. Today there are about 12-14, plus double index
inserts.

### R3-08 (high): exposure logs grow faster than the memory itself, are duplicated, and have cascading FKs without an index

**Where:** blue-2 §6.1 (`retrievals`, `retrieval_hits` with `signals jsonb` per hit and
`3 × $9` ranked rows) and blue-4 §4.2 (`packet_items` with `score_parts jsonb`), plus the two
rollups `entry_strength` (blue-2) and `entry_stats` (blue-4).

**Numbers.** One packet logs about 24 hit rows of roughly 240 B each (row, jsonb and PK index),
about 6 KB per retrieval with the header. An agent-heavy user making 200 retrievals a day writes
1.2 MB/day. At 300 users that is about **360 MB/day, about 130 GB/year**, more than all entry text
and vectors combined (R3-04). blue-4 logs the same exposure a second time in `packet_items`.

**Cascade defect.** `retrieval_hits.entry_id`, `packet_items.entry_id` and
`review_events.entry_id` are `REFERENCES entries ON DELETE CASCADE`, but none has an index
leading with `entry_id` (their PKs lead with `retrieval_id` or `packet_id`). Every entry delete
seq-scans the largest table in the database. The flip side is a blue-1 conflict: blue-1's
`forget_entry` never deletes the `entries` row, so these cascades never fire. Then
`retrievals.query`, `entry_uses.query_text`, `entry_summaries` and `entry_vectors` of a
forgotten entry all survive. Forget needs an explicit delete list. I am passing this to
red-security as a privacy issue; from my lens, the explicit list is also the only path that does
not scan.

**Fix:**

```sql
-- one exposure log (keep blue-4's packet_items name), only items actually shown (~4-8), no per-hit jsonb
-- unless the benchmark flag is on for that run; monthly range partitions, dropped after 90 days.
CREATE TABLE exposures (
  at timestamptz NOT NULL, retrieval_id bigint NOT NULL, entry_id uuid NOT NULL,
  version_no int NOT NULL, rank smallint NOT NULL, route_mask smallint NOT NULL,  -- bit per route
  PRIMARY KEY (at, retrieval_id, rank)) PARTITION BY RANGE (at);
CREATE INDEX ON exposures (entry_id);   -- forget and "shown but never used"
-- no FK to entries (partitioned log); forget deletes by entry_id explicitly.
```

Keep one rollup table (blue-4's `entry_stats`, which has `fades_at`). Drop `entry_strength`. The
90-day drop costs nothing: activation reads `entry_uses`, which is small (deduped, real uses only)
and kept forever.

### R3-09 (medium): per-use bookkeeping updates and audits the widest row

**Where:** blue-1 §4.3 ("bumping `expires_at` on every use must not mint a version", done as a
plain `UPDATE` plus an `audit_log` row) and the `entries_short_fade_idx` on `expires_at`.

**Failure.** Every real use of a short entry becomes a non-HOT update of `entries`, because
`expires_at` is indexed. That puts new entries in all 10+ indexes, GIN lexemes included (see
R3-07), and adds an audit row. A task that cites 8 short entries triggers 8 of these.

**Fix:** blue-4's model. `fades_at` lives on the narrow `entry_stats` row, maintained by the
`entry_uses` trigger, which is a HOT update when its index is not touched. `entries` is never
written on a use. The use log is itself the audit, so no `audit_log` row per use.

### R3-10 (medium): Consolidator backlog stops short memory from fading, and queue features need vectors that do not exist yet

**Where:** blue-4 §5 (the fade sweep skips entries with a `pending`/`leased` queue row) and §6.2
(every capture enqueues `new_capture`; `surprise` and `schema_fit` are computed at enqueue;
per-run budget `max_proposals = 20`). Also blue-1 §11.3 (every migrated legacy row gets a
fallback summary and `needs_summary = true`).

**Failure scenario.** A user captures 60 items a day. The nightly Consolidator handles 20.
Within a week there are 280 pending rows, and none of those entries can ever fade, because the
sweep excludes them. Short memory then grows without limit, and so do the short layer's vector
rows. At migration, every legacy row joins the re-summarize queue at once, so the queue starts
thousands deep. `surprise` ("1 − max cosine to active long items") cannot be computed at enqueue,
because the capture's vector is written later by the outbox (R3-03). The Consolidator runs on the
person's own model budget, and a replay set of about 10 neighbours plus a body of up to 256 KB
per item makes each item expensive.

**Fix:**

- Queue rows expire. `state = 'skipped'` when the entry's `fades_at` passes, and the sweep
  ignores rows older than the memory's `fade_ttl`. Forgetting is the safe default (blue-4 §12.4).
- Compute features at claim time, not at enqueue.
- Legacy fallback summaries are queued with priority 0 and processed only when the queue is
  otherwise empty.
- The budget is in tokens, not in proposals. The item is sent as title + summary + first chunk,
  with drill-down on request. The replay set is summaries only.
- Expose `queue_depth` and `oldest_pending_age` per owner in the Digest, so a growing backlog is
  visible.

### R3-11 (medium): index builds and model changes cannot run where migrations run

**Where:** blue-2 §4.3 ("create its partial index", then backfill) and §5.5 (per-partition
`CONCURRENTLY` + `ATTACH`), with the repo's `buildCommand ... && migrate` (migrations run in the
Vercel build through drizzle's migrator).

**Failure.** Drizzle's migrator runs pending migrations inside a transaction, and
`CREATE INDEX CONCURRENTLY` cannot run in one. Without it, `CREATE INDEX` on the partitioned
parent takes a SHARE lock on every partition and scans the whole table (even to find zero
`model_id = 2` rows), blocking every write for the length of the build. Building HNSW over
millions of rows also needs a large `maintenance_work_mem`, which a managed plan may cap, and it
can run past the Vercel build timeout.

**Fix:** a separate ops script (`pnpm ops:vector-index`), run by hand on the migrate role
(:6433, direct, not through PgBouncer):

1. Create the new model's partial index **per partition, `CONCURRENTLY`, while that model has 0
   rows** (seconds), then `ATTACH` to an `ON ONLY` parent index.
2. Backfill through the outbox. The graph is then built by incremental inserts; no big build
   ever runs.
3. Flip the model to `active`.

Migrations only create tables and columns. A test fails if a migration file contains
`USING hnsw`.

### R3-12 (medium): external calls inside the request transaction starve the 3-connection pool

**Where:** blue-3 §8.2 (`withActor` wraps the whole route in one transaction), blue-2 §12.5 (a
free-text `search` needs a query embedding, 100-300 ms) and R3-03.

**Failure.** If the query is embedded inside `withActor`, the transaction holds one of the
instance's 3 connections, and a PgBouncer server connection, while it waits on the provider.
Fluid compute packs concurrent requests into one instance, so three slow embeddings block every
other request on that instance. The claude.ai connector gives up on token and discovery calls
after 10 s (D16 Watch).

**Fix (rule):** no network call inside `withActor`. Embed first, outside the transaction (cache
key `(owner_id, sha256(model, text))`, per blue-3 §7.5), then open the transaction and run
`hybrid_search(...)`. Packets keep using `cue_vectors`, which needs no call.

### R3-13 (low): the Hebrew normalizer is fine on writes but makes as-of search a full scan; blue-1 and blue-2 disagree on the tsvector

**Where:** blue-2 §3 (generated column; "as-of word search ... computed at query time, no
index") and blue-1 §4.3 (the trigger builds `search` from `simple` only, with no English stems
and no Hebrew variants). Blue-2's generated column reads `entries.body`, which blue-1 removed
from `entries` ("the body is not duplicated on entries").

**Numbers:** 151 ms for a ~200k-char body, 3 ms for 4 KB (measured). Acceptable once per content
version. As-of search computes it per version row with no index: 100k versions × ~3 ms is
**~5 minutes**, which is far past the 60 s function limit.

**Fix (my ruling):** the tsvector is computed in blue-1's trigger by one function,
`sb_search_vector(title, summary, questions, body)`, holding blue-2's full expression. It is not
a generated column, because the body is not on `entries`. As-of word search finds candidates on
today's head index first, then checks their versions; a full-history scan is not offered.

### R3-14 (low): duplicate indexes on the hottest table

**Where:** blue-1 creates `entries_search_idx` (GIN) and `entries_title_trgm_idx`
(`title gin_trgm_ops`). Blue-2 creates `entries_search_gin` and `entries_title_trgm`
(`sb_norm(title)`). Keep one GIN on `search` and one trigram on `sb_norm(title)`, which is the
one the query matches. Every extra GIN multiplies R3-07 and R3-09.

---

## Rulings on the blue inconsistencies (my lens only)

| Conflict | Ruling | Why (cost) |
|---|---|---|
| blue-1 summary columns on `entry_versions` vs blue-2 `entry_summaries` | **blue-2's table** | A re-summary must not copy the body (R3-07). |
| Lifecycle as a content version (blue-1) vs a mutable field + events (blue-4) | **blue-4** | No body copy, no tsvector recompute. |
| Level change: new derived entry (blue-1) vs `memory_id` change (blue-4) | **blue-1** for changes between levels | The vector is written once into the long HNSW, and the short slice keeps no HNSW (R3-04/05). A `memory_id` change on a vector row is a non-HOT update and a graph re-insert. Refiling within one level stays a cheap update. |
| Per-layer grants (blue-1) vs per-memory only (blue-3) | **blue-3** | Neutral on cost. The readable set stays a plain array, and the per-owner slice counts (R3-06) stay per memory. |
| `entry_strength` (blue-2) vs `entry_stats` (blue-4) | **`entry_stats`** | One rollup row; it carries `fades_at` (R3-09). |
| `retrieval_hits` vs `packet_items` | **one partitioned `exposures` log** | R3-08. |
| Workspace root (blue-1) vs owner root (blue-3) | no cost difference | (Left to the others.) |

---

## The cheapest design that keeps all features

| Piece | Setting |
|---|---|
| Vectors | One per entry (title + summary + questions), plus chunks only for bodies over 8k chars (at most 8). 768-d halfvec if the benchmark allows, otherwise 1024 (then `SET STORAGE PLAIN` is moot: rows TOAST, so prefer 768). |
| Index | One partial HNSW per active model, `WHERE level = 'long'`, `m = 16, ef_construction = 64`. Short memories use exact search. Keep the 32 hash partitions by owner. |
| Path choice | Per owner slice: exact below 20k vectors, HNSW with `relaxed_order` above, merged and re-sorted (R3-06). |
| Retrieval | One `SECURITY DEFINER hybrid_search()` owned by `sky_search`, with the filter inside every CTE (R3-01) and LATERAL link walks (R3-02). |
| Write | One INSERT per row; summaries in `entry_summaries`; body stored only on content versions; tsvector reused when the text did not change (R3-07). |
| Outbox | `ready_at` lease, batched provider calls, delete on success, four drainers, dead letter after 8 attempts (R3-03). |
| Logs | `entry_uses` kept forever (small); `exposures` partitioned by month and dropped after 90 days; one `entry_stats` rollup. |
| Ops | Vector indexes and reindexing through an ops script on :6433, never in the build migration (R3-11). No network calls inside `withActor` (R3-12). |
| Consolidator | Budget in tokens; queue rows expire with their entry's fade; features computed at claim (R3-10). |

Rough size per entry with this design: head row + tsvector + GIN ≈ 4-6 KB (text-dependent);
versions ≈ body × 1.3 instead of × 3-4; vector ≈ 1.8 KB (short) or 3.3 KB (long, with HNSW). At
300 users × 30k entries, vectors are about 25 GB instead of about 100 GB, and the hot HNSW
covers long memory only.

---

## What I tried to break and could not

- **Activation cost at query time.** Both blue-2 and blue-4 read a rollup row (last k uses plus
  Petrov's tail) instead of scanning the use log, so the cost per candidate is constant. It held.
- **`SET LOCAL` and PgBouncer transaction mode.** `set_config(..., true)`, `SET LOCAL ROLE` and
  `SET LOCAL hnsw.*` are all transaction-scoped. node-postgres sends unnamed statements, so the
  planner sees the literal `model_id = 1` and the partial-index match holds. Partition pruning on
  `owner_id = ANY($2)` works with custom plans.
- **RLS InitPlan.** `(SELECT app_readable_memories())` runs once per statement, not per row
  (shown as `InitPlan 1` in the plans), once the `::uuid[]` cast fix is in.
- **The untyped `halfvec` column with a cast expression index per model.** This is a documented
  pgvector pattern, and the cast rejects wrong dimensions on insert.
- **Hash partitions versus grantees.** Pruning covers several owners correctly. The only defect is
  the choice of path, made per scope instead of per slice (R3-06).
- **Use-log volume.** Dedupe per entry, actor and hour keeps `entry_uses` small; it is not a
  growth risk.
- **Embedding money cost.** Under $100 for a full backfill at fleet scale. Rate limits and RAM
  bind first, not money.
- **Core and working memory.** Never embedded and fetched by id, so there is nothing to scale.

Sources: [Vercel cron usage and limits](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration.md),
[Vercel background workers](https://vercel.com/kb/guide/background-workers-on-vercel.md),
[pgvector 0.8 iterative scans](https://docs.pgedge.com/pgvector/v0-8-0/iterative-index-scans/),
[pgvector scaling notes](https://clickhouse.com/resources/engineering/scale-vector-search-postgres).
