-- sky-brain vectors: BUILD-PLAN step 4 (hybrid search). Needs pgvector >= 0.8 (Nanogres has 0.8.1).
-- NOT run in the review: pgvector was not installed on the test box. Shapes follow blue-2 with the
-- red-team fixes (R1-03, R2-04, R2-08, R3-03, R3-04, R3-05, R3-06).
-- The owner's rule: the vector is of the SUMMARY (title + summary + questions), never the whole body.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embedding_models (
  id          smallint PRIMARY KEY,
  name        text NOT NULL UNIQUE,          -- e.g. 'bge-m3@768' or a provider model + dimension
  dims        smallint NOT NULL CHECK (dims BETWEEN 64 AND 2000),
  is_active   boolean NOT NULL DEFAULT false,
  self_hosted boolean NOT NULL               -- shared memories may require a self-hosted model (R1-12.4)
);
CREATE UNIQUE INDEX embedding_models_one_active ON embedding_models (is_active) WHERE is_active;

-- One vector per entry by default (R3-04). Chunk vectors only for bodies over ~8k chars, at most 8,
-- and right away for people's entries that only have a fallback summary (R4-07).
CREATE TABLE entry_vectors (
  workspace_id uuid NOT NULL,                -- the brain that owns the entry (partition key)
  entry_id     uuid NOT NULL,
  memory_id    uuid NOT NULL,
  layer        memory_layer NOT NULL,
  version_no   integer NOT NULL,             -- content version the text came from
  summary_id   bigint,                       -- the kept summary embedded (facet 'gist')
  facet        text NOT NULL CHECK (facet IN ('gist', 'chunk')),
  ordinal      smallint NOT NULL DEFAULT 0 CHECK (ordinal BETWEEN 0 AND 7),
  chunk_start  integer,                      -- offsets into the body: drill-down lands on the section
  chunk_end    integer,
  model_id     smallint NOT NULL REFERENCES embedding_models(id),
  embedding    halfvec NOT NULL,             -- untyped: dimension lives on the model row
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, entry_id, facet, ordinal, model_id),
  FOREIGN KEY (entry_id, workspace_id) REFERENCES entries(id, workspace_id),
  FOREIGN KEY (memory_id, workspace_id, layer) REFERENCES memories(id, workspace_id, layer),
  CHECK (facet <> 'chunk' OR (chunk_start IS NOT NULL AND chunk_end > chunk_start))
) PARTITION BY HASH (workspace_id);
-- 32 partitions; grant only the parent to runtime roles (a partition queried directly skips RLS, R1-11).
DO $$ BEGIN FOR i IN 0..31 LOOP
  EXECUTE format('CREATE TABLE entry_vectors_p%s PARTITION OF entry_vectors FOR VALUES WITH (MODULUS 32, REMAINDER %s)', i, i);
END LOOP; END $$;

-- HNSW only on long memory (R3-04/R3-05): short memory is recent and small, exact search is cheaper
-- than graph churn. One partial index per active model; built by the ops script on the migrate
-- port with CREATE INDEX CONCURRENTLY, never in the Vercel build migration (R3-11).
--   CREATE INDEX CONCURRENTLY entry_vectors_m1_hnsw ON entry_vectors_pN
--     USING hnsw ((embedding::halfvec(768)) halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)
--     WHERE model_id = 1 AND layer = 'long';
CREATE INDEX entry_vectors_slice_idx ON entry_vectors (memory_id, model_id);   -- exact path per memory slice

-- Outbox. Search never waits on vectors: FTS finds an entry before it is embedded.
CREATE TABLE embedding_jobs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id   uuid NOT NULL,
  version_no integer NOT NULL,
  summary_id bigint,
  reason     text NOT NULL CHECK (reason IN ('new_summary', 'chunks', 'model_backfill')),
  ready_at   timestamptz NOT NULL DEFAULT now(),   -- not-before, or lease end while leased (R3-03)
  attempts   smallint NOT NULL DEFAULT 0,          -- >= 8: dead letter, shown in an ops view
  last_error text CHECK (char_length(last_error) <= 300)
);
CREATE INDEX embedding_jobs_ready ON embedding_jobs (ready_at) WHERE attempts < 8;
-- Drainers (all call one idempotent drain(maxMs = 20s), claim with FOR UPDATE SKIP LOCKED, call the
-- provider OUTSIDE any transaction, R3-12): waitUntil after a write; any request when the oldest
-- ready_at is > 30 s old; Vercel cron (daily on Hobby, every minute on Pro).

-- Monotonic upsert: an old job finishing late never overwrites a newer vector (R2-08).
--   INSERT INTO entry_vectors (...) VALUES (...)
--   ON CONFLICT (workspace_id, entry_id, facet, ordinal, model_id) DO UPDATE SET ...
--   WHERE entry_vectors.version_no <= EXCLUDED.version_no;

-- Vectors leave in the SAME transaction that quarantines, rejects, forgets or consolidates-away an
-- entry (R1-03), not through the outbox. forget_entry gains:  DELETE FROM entry_vectors WHERE entry_id = p_entry;
CREATE FUNCTION entries_drop_vectors() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trust = 'quarantined' OR NEW.lifecycle = 'rejected' OR NEW.forgotten_at IS NOT NULL
     OR NEW.served_version IS DISTINCT FROM OLD.served_version THEN
    DELETE FROM entry_vectors WHERE workspace_id = NEW.workspace_id AND entry_id = NEW.id
      AND (NEW.trust = 'quarantined' OR NEW.lifecycle = 'rejected' OR NEW.forgotten_at IS NOT NULL
           OR version_no < coalesce(NEW.served_version, 0));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER entries_drop_vectors AFTER UPDATE OF trust, lifecycle, forgotten_at, served_version ON entries
  FOR EACH ROW EXECUTE FUNCTION entries_drop_vectors();

-- Hybrid retrieval runs as ONE SECURITY DEFINER function owned by a NOLOGIN role (R3-01: under RLS the
-- @@ and <% operators are not leakproof, so their GIN indexes are skipped: 5 ms -> 490 ms). The
-- readable-memories filter is written inside every CTE, and the final SELECT re-checks memory,
-- trust and served version (R1-03, R2-04). Link hops walk OUTWARD from the seeds with LATERAL
-- index lookups (R3-02), only over accepted links whose both ends are readable.
-- Shape (pseudo-SQL; full version in blue-2 section 7 with the fixes listed above):
--   fts   : top 50 by ts_rank over entries.search, websearch_to_tsquery('simple', sb_norm($q))
--   trg   : top 20 by word_similarity on title
--   vec   : top 50 by embedding <=> $qvec, exact per memory slice under 20k vectors, HNSW
--           (iterative_scan = relaxed_order) above, merged and re-sorted (R3-06)
--   fused : RRF k = 60 over the three lists
--   hops  : 1-2 hops from the top 10 over accepted derived_from / depends_on / supersedes links
--   final : WHERE memory_id = ANY(readable) AND trust <> 'quarantined' AND lifecycle NOT IN ('rejected')
--           AND forgotten_at IS NULL AND NOT forget_review AND v.version_no = e.served_version
--           then MMR, at most 1 of the top 4 from any author who is not the reader (R1-14.5)
