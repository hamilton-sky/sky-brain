-- sky-brain memory core: BUILD-PLAN steps 1-2 (recommended schema, 23 Nov 2026)
-- Synthesized from the red/blue team review in docs/vision/schema/. A proposal, not a migration:
-- when it is built, the Drizzle-expressible tables go through `drizzle-kit generate` and the
-- triggers/functions go in a following `--custom` migration (see MEMORY-SCHEMA.md section 9).
-- Tested on PostgreSQL 16 on top of migrations 0000-0004 (tests in 90-tests.sql).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Hebrew normalization (sb_norm) silently strips every letter in a non-UTF8 database (R2-10.7).
DO $$ BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'sky-brain needs a UTF8 database, got %', current_setting('server_encoding');
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 0. Enums
-- ---------------------------------------------------------------------------------------------
CREATE TYPE memory_layer    AS ENUM ('core', 'long', 'short', 'working');
-- D22. "question" is an item_type with no kind.
CREATE TYPE knowledge_kind  AS ENUM ('fact', 'decision', 'hypothesis', 'observation', 'external');
-- D22, declared low to high so `>` means "raises trust".
CREATE TYPE trust_level     AS ENUM ('quarantined', 'proposed', 'approved');
-- What the brain believes about the statement (epistemic). Fading is NOT a state: it is computed
-- from expires_at at read time, so it can be switched off (BUILD-PLAN rule 6, R4-11).
CREATE TYPE entry_lifecycle AS ENUM ('active', 'superseded', 'closed', 'rejected', 'consolidated');
CREATE TYPE actor_kind      AS ENUM ('human', 'agent', 'rule');   -- rule = server code (Gatekeeper)
CREATE TYPE link_relation   AS ENUM ('supports', 'contradicts', 'supersedes', 'derived_from',
                                     'part_of', 'answers', 'related');
CREATE TYPE link_status     AS ENUM ('proposed', 'accepted', 'rejected');
CREATE TYPE summary_source  AS ENUM ('writer', 'person', 'fallback', 'steward');
CREATE TYPE summary_status  AS ENUM ('kept', 'proposed', 'quarantined');
CREATE TYPE use_kind        AS ENUM ('opened', 'cited', 'acted_on', 'confirmed', 'corrected');

-- The caller, from withActor's SET LOCAL (never from a request body: hard rule 2).
CREATE FUNCTION app_person() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.person', true), '') $$;
CREATE FUNCTION app_actor_kind() RETURNS actor_kind LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.actor_kind', true), ''), 'agent')::actor_kind $$;  -- least power by default
-- True only inside the SECURITY DEFINER forget function (owned by the migration role, which the
-- runtime never logs in as). Not a setting: a session cannot switch it on (R2-01).
CREATE FUNCTION in_forget() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_user <> session_user AND current_user::text = (
    SELECT pg_get_userbyid(proowner)::text FROM pg_proc WHERE proname = 'forget_entry' LIMIT 1)
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. The brain root: one workspace per person (D17), now explicit
-- ---------------------------------------------------------------------------------------------
ALTER TABLE workspaces ADD COLUMN owner_user_id text REFERENCES "user"(id) ON DELETE RESTRICT;
UPDATE workspaces w SET owner_user_id = m.user_id
  FROM members m WHERE m.workspace_id = w.id AND m.role = 'owner';
-- (production: SET NOT NULL after the backfill is checked; left nullable here for legacy rows)
CREATE UNIQUE INDEX workspaces_one_brain_per_person ON workspaces (owner_user_id);

-- ---------------------------------------------------------------------------------------------
-- 2. memories: the container. The layer belongs to the memory and never changes.
--    UI names (R4-03): core = "About me", short = "Inbox", long = "Notebook", working = "Board".
-- ---------------------------------------------------------------------------------------------
CREATE TABLE memories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  layer        memory_layer NOT NULL,
  slug         text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- names are rendered inside the packet's fence label: no quotes, brackets or newlines (R1-14)
  name         text NOT NULL CHECK (name ~ '^[^][<>{}"`\n\r]{1,120}$'),
  description  text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  project_id   uuid,               -- working: required (one board per project); long: optional
  is_default   boolean NOT NULL DEFAULT false,
  default_ttl  interval,           -- short only: how long a new item stays before it fades
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,

  CONSTRAINT memories_slug_unique        UNIQUE (workspace_id, slug),
  CONSTRAINT memories_id_ws_unique       UNIQUE (id, workspace_id),
  CONSTRAINT memories_id_ws_layer_unique UNIQUE (id, workspace_id, layer),
  -- PG15+: a project delete nulls only project_id; the working CHECK then refuses it, so a
  -- project cannot be deleted while its board exists. A long notebook about it survives.
  CONSTRAINT memories_project_fk FOREIGN KEY (project_id, workspace_id)
    REFERENCES projects(id, workspace_id) ON DELETE SET NULL (project_id),
  CONSTRAINT memories_core_shape   CHECK (layer <> 'core' OR (project_id IS NULL AND is_default AND archived_at IS NULL)),
  CONSTRAINT memories_working_proj CHECK (layer <> 'working' OR project_id IS NOT NULL),
  CONSTRAINT memories_short_ttl    CHECK ((layer = 'short') = (default_ttl IS NOT NULL)),
  CONSTRAINT memories_ttl_range    CHECK (default_ttl IS NULL OR default_ttl BETWEEN interval '1 day' AND interval '365 days')
);
-- Requirement: exactly one core per person. At most one here; at least one by the trigger below.
CREATE UNIQUE INDEX memories_one_core       ON memories (workspace_id) WHERE layer = 'core';
-- One default inbox (short) and one default notebook (long) per person.
CREATE UNIQUE INDEX memories_one_default    ON memories (workspace_id, layer) WHERE is_default;
CREATE UNIQUE INDEX memories_one_board      ON memories (project_id) WHERE layer = 'working';
CREATE INDEX        memories_ws_layer_idx   ON memories (workspace_id, layer) WHERE archived_at IS NULL;

CREATE FUNCTION memories_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.layer <> OLD.layer OR NEW.workspace_id <> OLD.workspace_id THEN
      RAISE EXCEPTION 'a memory never changes layer or brain' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE: core goes only with its brain (a cascade runs after the workspace row is gone).
  IF OLD.layer = 'core' AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'the core memory cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER memories_guard BEFORE UPDATE OR DELETE ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_guard();

-- "At least one core". Ship this in the migration AFTER the onSignIn code that creates the core
-- is live, or sign-ins during the deploy window fail silently (R2-10.3).
CREATE FUNCTION workspaces_need_core() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspaces WHERE id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM memories WHERE workspace_id = NEW.id AND layer = 'core') THEN
    RAISE EXCEPTION 'workspace % has no core memory', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workspaces_need_core AFTER INSERT ON workspaces
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspaces_need_core();

-- The board joins its working memory (tasks inherit through their goal).
ALTER TABLE goals ADD COLUMN memory_id uuid;
ALTER TABLE goals ADD CONSTRAINT goals_board_fk FOREIGN KEY (memory_id, workspace_id)
  REFERENCES memories(id, workspace_id);

-- ---------------------------------------------------------------------------------------------
-- 3. entries: identity, placement and a head cache that only triggers write.
--    An entry never changes memory. Moving or consolidating = a new entry + derived_from link.
-- ---------------------------------------------------------------------------------------------
-- Today's entries table has no API or rows (R2-10.2): refuse to drop it if that ever changes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM entries) THEN RAISE EXCEPTION 'legacy entries not empty: write the copy first'; END IF;
END $$;
DROP TABLE entries;
DROP TYPE entry_kind; DROP TYPE entry_status;   -- replaced by knowledge_kind / trust_level / entry_lifecycle

CREATE TABLE entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigint NOT NULL DEFAULT nextval('entries_seq'),  -- "what changed since"; NOT unique (R2-02)
  workspace_id  uuid NOT NULL,
  memory_id     uuid NOT NULL,
  layer         memory_layer NOT NULL,       -- copy of the memory's layer, kept honest by the FK
  item_type     text NOT NULL CHECK (item_type ~ '^[a-z][a-z0-9_]{1,39}$'),  -- user types are data
  goal_id       uuid REFERENCES goals(id) ON DELETE SET NULL,   -- working only
  task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,   -- working only
  created_by_kind actor_kind NOT NULL,
  created_by    text NOT NULL,
  on_behalf_of  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- head cache: written only from inside the triggers below (pg_trigger_depth guard)
  head_version   integer NOT NULL DEFAULT 0,
  served_version integer,                    -- last NON-quarantined version: what readers get (R1-03)
  kind          knowledge_kind,
  trust         trust_level NOT NULL DEFAULT 'proposed',
  lifecycle     entry_lifecycle NOT NULL DEFAULT 'active',
  title         text,
  summary_id    bigint,                      -- the kept summary readers and vectors use
  valid_period  tstzrange,
  search        tsvector,                    -- 'simple' + sb_norm: Hebrew and English

  -- bookkeeping: person or rule only, every change audited; never content
  expires_at    timestamptz,                 -- short: fades from agents' default retrieval after this
  salience      smallint NOT NULL DEFAULT 0 CHECK (salience BETWEEN 0 AND 3),  -- priority, never trust
  core_rank     smallint,                    -- core: load order in the always-on "About me" card
  forget_review boolean NOT NULL DEFAULT false, -- built on a forgotten entry: hidden until the owner decides
  forgotten_at  timestamptz,

  CONSTRAINT entries_id_ws_unique UNIQUE (id, workspace_id),
  CONSTRAINT entries_in_memory_fk FOREIGN KEY (memory_id, workspace_id, layer)
    REFERENCES memories(id, workspace_id, layer),                  -- NO ACTION: history pins its memory
  CONSTRAINT entries_short_fades  CHECK (layer <> 'short' OR expires_at IS NOT NULL),
  CONSTRAINT entries_durable      CHECK (layer NOT IN ('core', 'long') OR expires_at IS NULL),
  CONSTRAINT entries_task_scope   CHECK (layer = 'working' OR (goal_id IS NULL AND task_id IS NULL)),
  CONSTRAINT entries_core_rank    CHECK ((layer = 'core') = (core_rank IS NOT NULL)),
  CONSTRAINT entries_core_human   CHECK (layer <> 'core' OR created_by_kind = 'human')  -- hard rule 3
);
CREATE INDEX entries_seq_idx        ON entries (workspace_id, seq);
CREATE INDEX entries_memory_idx     ON entries (memory_id, lifecycle, trust) WHERE forgotten_at IS NULL;
CREATE INDEX entries_search_idx     ON entries USING gin (search);
CREATE INDEX entries_title_trgm_idx ON entries USING gin (title gin_trgm_ops);
CREATE INDEX entries_fade_idx       ON entries (memory_id, expires_at) WHERE layer = 'short';
CREATE INDEX entries_goal_idx       ON entries (goal_id, task_id) WHERE goal_id IS NOT NULL;

CREATE FUNCTION entries_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layer = 'short' AND NEW.expires_at IS NULL THEN
    SELECT now() + default_ttl INTO NEW.expires_at FROM memories WHERE id = NEW.memory_id;
  END IF;
  IF NEW.layer = 'core' AND NEW.core_rank IS NULL THEN NEW.core_rank := 100; END IF;
  IF NEW.head_version <> 0 OR NEW.served_version IS NOT NULL OR NEW.summary_id IS NOT NULL
     OR NEW.trust <> 'proposed' OR NEW.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'a new entry starts empty: content, trust and summary arrive through their own rows';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entries_defaults BEFORE INSERT ON entries FOR EACH ROW EXECUTE FUNCTION entries_defaults();

-- Head cache, identity and placement are not writable by a plain UPDATE. A setting is not a
-- privilege (R1-10, R2-01): the guard checks that the write comes from inside a trigger.
CREATE FUNCTION entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.workspace_id, NEW.memory_id, NEW.layer, NEW.item_type, NEW.created_by, NEW.created_by_kind)
     IS DISTINCT FROM
     (OLD.id, OLD.workspace_id, OLD.memory_id, OLD.layer, OLD.item_type, OLD.created_by, OLD.created_by_kind) THEN
    RAISE EXCEPTION 'entry identity and memory are immutable; move = new derived entry'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF in_forget() THEN RETURN NEW; END IF;
  IF pg_trigger_depth() < 2 AND
     (NEW.head_version, NEW.served_version, NEW.kind, NEW.trust, NEW.lifecycle, NEW.title,
      NEW.summary_id, NEW.valid_period, NEW.search, NEW.seq, NEW.forgotten_at)
     IS DISTINCT FROM
     (OLD.head_version, OLD.served_version, OLD.kind, OLD.trust, OLD.lifecycle, OLD.title,
      OLD.summary_id, OLD.valid_period, OLD.search, OLD.seq, OLD.forgotten_at) THEN
    RAISE EXCEPTION 'entry content, trust and lifecycle change only through entry_versions, entry_events or entry_summaries'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER entries_guard BEFORE UPDATE ON entries FOR EACH ROW EXECUTE FUNCTION entries_guard();

-- ---------------------------------------------------------------------------------------------
-- 4. entry_versions: append-only CONTENT. A row exists only when the text or kind changes, so a
--    trust change, a lifecycle change or a re-summary never copies the body (R3-07).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE entry_versions (
  entry_id      uuid NOT NULL REFERENCES entries(id),   -- NO ACTION: forget scrubs, never deletes
  version_no    integer NOT NULL CHECK (version_no >= 1),
  workspace_id  uuid NOT NULL,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body          text NOT NULL CHECK (octet_length(body) <= 262144),   -- Gatekeeper caps lower per source
  content_hash  bytea,                                  -- sha256(title||0||body); NULLed by forget (R1-13)
  kind          knowledge_kind,                         -- null only for item_type 'question'
  valid_period  tstzrange CHECK (valid_period IS NULL OR NOT isempty(valid_period)),  -- valid time
  recorded_at   timestamptz NOT NULL DEFAULT now(),     -- recorded time (REVIEW B)
  confidence    real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  props         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(props) = 'object' AND octet_length(props::text) <= 16384),
  -- encoding context (psych 4): project, goal, task, persona, client, place. One jsonb column now;
  -- a field becomes a column when a ranking signal earns it (R4 later-list).
  capture_context jsonb CHECK (capture_context IS NULL OR (jsonb_typeof(capture_context) = 'object'
                                                            AND octet_length(capture_context::text) <= 16384)),
  -- provenance (hard rule 2: author and on_behalf_of come from the token)
  source        entry_source NOT NULL,                  -- channel: human | agent | code | web | import
  author_kind   actor_kind NOT NULL,
  author        text NOT NULL,                          -- user id or e.g. 'claude-code/builder'
  on_behalf_of  text NOT NULL,
  device_id     uuid REFERENCES devices(id),
  run_task_id   uuid,
  run_claim_seq bigint,
  quarantined_because text,                             -- set by the Gatekeeper; never served while set
  change_note   text CHECK (char_length(change_note) <= 500),

  PRIMARY KEY (entry_id, version_no),
  CONSTRAINT ev_entry_ws_fk FOREIGN KEY (entry_id, workspace_id) REFERENCES entries(id, workspace_id),
  CONSTRAINT ev_observation_time CHECK (kind IS DISTINCT FROM 'observation'
      OR (valid_period IS NOT NULL AND NOT lower_inf(valid_period)))
);
CREATE INDEX entry_versions_asof_idx ON entry_versions (workspace_id, recorded_at);
CREATE INDEX entry_versions_hash_idx ON entry_versions (workspace_id, content_hash) WHERE content_hash IS NOT NULL;

CREATE FUNCTION entry_versions_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e entries%ROWTYPE; prev_kind knowledge_kind;
BEGIN
  -- NO KEY UPDATE serializes writers on one entry without deadlocking FK inserts (R2-02)
  SELECT * INTO e FROM entries WHERE id = NEW.entry_id FOR NO KEY UPDATE;
  IF NEW.version_no <> e.head_version + 1 THEN       -- the API passes the caller's base version + 1
    RAISE EXCEPTION 'stale write: entry % is at version %', e.id, e.head_version
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF e.forgotten_at IS NOT NULL THEN RAISE EXCEPTION 'entry was forgotten'; END IF;
  IF e.layer = 'core' AND NEW.author_kind <> 'human' THEN
    RAISE EXCEPTION 'only a person writes core memory' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.kind IS NULL AND e.item_type <> 'question' THEN RAISE EXCEPTION 'kind is required'; END IF;
  IF NEW.version_no > 1 AND NEW.author_kind <> 'human' THEN
    IF e.trust = 'approved' THEN
      RAISE EXCEPTION 'agents do not edit an approved entry; propose a superseding entry'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT kind INTO prev_kind FROM entry_versions WHERE entry_id = e.id AND version_no = e.head_version;
    IF NEW.kind IS DISTINCT FROM prev_kind THEN
      RAISE EXCEPTION 'only a person changes kind' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_versions_before_insert BEFORE INSERT ON entry_versions
  FOR EACH ROW EXECUTE FUNCTION entry_versions_before_insert();

-- Hebrew + English normalization for the 'simple' config: strip niqqud/cantillation, drop
-- geresh/gershayim inside words (צה"ל -> צהל). Prefix-stripped variants wait for the benchmark.
CREATE FUNCTION sb_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(t, '')), '[֑-ׇ]', '', 'g'),
           '([א-ת])["״׳''](?=[א-ת])', '\1', 'g')
$$;

CREATE FUNCTION entry_versions_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE entries SET
    head_version   = NEW.version_no,
    seq            = nextval('entries_seq'),
    served_version = CASE WHEN NEW.quarantined_because IS NULL THEN NEW.version_no ELSE served_version END,
    trust          = CASE WHEN NEW.quarantined_because IS NOT NULL AND served_version IS NULL THEN 'quarantined'
                          ELSE trust END,
    kind           = CASE WHEN NEW.quarantined_because IS NULL THEN NEW.kind ELSE kind END,
    title          = CASE WHEN NEW.quarantined_because IS NULL THEN NEW.title ELSE title END,
    valid_period   = CASE WHEN NEW.quarantined_because IS NULL THEN NEW.valid_period ELSE valid_period END,
    search         = CASE WHEN NEW.quarantined_because IS NULL THEN
                       setweight(to_tsvector('simple', sb_norm(NEW.title)), 'A')
                    || setweight(to_tsvector('simple', sb_norm(left(NEW.body, 200000))), 'C')
                     ELSE search END
  WHERE id = NEW.entry_id;

  IF NEW.quarantined_because IS NULL AND
     (SELECT layer FROM entries WHERE id = NEW.entry_id) = 'core' THEN   -- core stays small
    PERFORM 1 FROM memories m JOIN entries e ON e.memory_id = m.id WHERE e.id = NEW.entry_id FOR NO KEY UPDATE OF m;
    SELECT count(*) INTO n FROM entries e2
      WHERE e2.memory_id = (SELECT memory_id FROM entries WHERE id = NEW.entry_id)
        AND e2.lifecycle = 'active' AND e2.served_version IS NOT NULL AND e2.forgotten_at IS NULL;
    IF n > 60 THEN RAISE EXCEPTION 'About me is full (60 items): close or merge one first'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER entry_versions_after_insert AFTER INSERT ON entry_versions
  FOR EACH ROW EXECUTE FUNCTION entry_versions_after_insert();

-- ---------------------------------------------------------------------------------------------
-- 5. entry_summaries: the owner's rule. The agent that writes the text writes the summary; the
--    server embeds the summary (step 4). Each summary belongs to one content version.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE entry_summaries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id        uuid NOT NULL,
  for_version     integer NOT NULL,
  workspace_id    uuid NOT NULL,
  summary         text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 600),
  questions       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(questions) <= 3),  -- "questions this answers"
  source          summary_source NOT NULL,     -- writer | person | fallback | steward
  status          summary_status NOT NULL DEFAULT 'kept',  -- the trigger decides; the caller cannot
  written_by_kind actor_kind NOT NULL,
  written_by      text NOT NULL,
  on_behalf_of    text NOT NULL,
  replaces        bigint REFERENCES entry_summaries(id),     -- a person's Keep of a proposed summary
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT es_version_fk FOREIGN KEY (entry_id, for_version) REFERENCES entry_versions(entry_id, version_no),
  CONSTRAINT es_entry_ws_fk FOREIGN KEY (entry_id, workspace_id) REFERENCES entries(id, workspace_id),
  CONSTRAINT es_id_entry_unique UNIQUE (id, entry_id),
  CONSTRAINT es_fallback_is_rule CHECK ((source = 'fallback') = (written_by_kind = 'rule'))
);
CREATE INDEX entry_summaries_entry_idx ON entry_summaries (entry_id, id DESC);
ALTER TABLE entries ADD CONSTRAINT entries_summary_fk FOREIGN KEY (summary_id, id)
  REFERENCES entry_summaries(id, entry_id);    -- the head can only point at its own entry's summary

CREATE FUNCTION entry_summaries_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e entries%ROWTYPE; v entry_versions%ROWTYPE;
BEGIN
  SELECT * INTO e FROM entries WHERE id = NEW.entry_id FOR NO KEY UPDATE;
  -- a summary for an older text is refused, not stamped fresh (R2-08)
  IF NEW.for_version <> e.head_version THEN
    RAISE EXCEPTION 'stale summary: entry % is at version %', e.id, e.head_version
      USING ERRCODE = 'serialization_failure';
  END IF;
  SELECT * INTO v FROM entry_versions WHERE entry_id = NEW.entry_id AND version_no = NEW.for_version;
  IF NEW.status = 'quarantined' THEN
    IF NEW.written_by_kind <> 'rule' THEN NEW.status := 'proposed'; END IF;   -- only the Gatekeeper quarantines
    RETURN NEW;                                       -- a bad summary quarantines itself, never the entry (R1-04)
  END IF;
  IF NEW.written_by_kind = 'human' OR NEW.source = 'fallback' THEN
    NEW.status := 'kept';
  ELSIF NEW.written_by_kind = 'agent' AND NEW.written_by = v.author AND e.trust <> 'approved' THEN
    NEW.status := 'kept';         -- the writer summarizing its own new text: approved together with it
  ELSE
    NEW.status := 'proposed';     -- a steward or another agent: served only after a person keeps it (R1-04, R4-08)
  END IF;
  IF e.layer = 'core' AND NEW.written_by_kind = 'agent' THEN NEW.status := 'proposed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_summaries_before_insert BEFORE INSERT ON entry_summaries
  FOR EACH ROW EXECUTE FUNCTION entry_summaries_before_insert();

CREATE FUNCTION entry_summaries_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'kept' AND
     (SELECT served_version FROM entries WHERE id = NEW.entry_id) = NEW.for_version THEN
    UPDATE entries SET
      summary_id = NEW.id,
      search = setweight(to_tsvector('simple', sb_norm(title)), 'A')
            || setweight(to_tsvector('simple', sb_norm(NEW.summary || ' ' || array_to_string(NEW.questions, ' '))), 'B')
            || setweight(to_tsvector('simple', sb_norm(left(
                 (SELECT body FROM entry_versions WHERE entry_id = NEW.entry_id AND version_no = NEW.for_version), 200000))), 'C')
    WHERE id = NEW.entry_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER entry_summaries_after_insert AFTER INSERT ON entry_summaries
  FOR EACH ROW EXECUTE FUNCTION entry_summaries_after_insert();

-- Every clean content version has a summary by commit time (owner's rule).
CREATE FUNCTION entry_versions_need_summary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quarantined_because IS NULL AND NOT EXISTS (
       SELECT 1 FROM entry_summaries WHERE entry_id = NEW.entry_id AND for_version = NEW.version_no) THEN
    RAISE EXCEPTION 'version % of entry % has no summary (agents must send one; the server writes the fallback for people)',
      NEW.version_no, NEW.entry_id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entry_versions_need_summary AFTER INSERT ON entry_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION entry_versions_need_summary();

-- ---------------------------------------------------------------------------------------------
-- 6. entry_events: append-only trust and lifecycle changes (D22). Race-safe: `from` must match.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE entry_events (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id     uuid NOT NULL REFERENCES entries(id),
  workspace_id uuid NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_kind   actor_kind NOT NULL,
  actor        text NOT NULL,
  on_behalf_of text NOT NULL,
  from_trust   trust_level,      to_trust     trust_level,
  from_life    entry_lifecycle,  to_life      entry_lifecycle,
  for_version  integer NOT NULL,   -- the content version the person looked at when deciding
  reason       text CHECK (char_length(reason) <= 500),
  CONSTRAINT ee_one_change CHECK ((to_trust IS NULL) <> (to_life IS NULL)),
  CONSTRAINT ee_entry_ws_fk FOREIGN KEY (entry_id, workspace_id) REFERENCES entries(id, workspace_id)
);
CREATE INDEX entry_events_entry_idx ON entry_events (entry_id, seq);

CREATE FUNCTION entry_events_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e entries%ROWTYPE;
BEGIN
  SELECT * INTO e FROM entries WHERE id = NEW.entry_id FOR NO KEY UPDATE;
  IF NEW.for_version <> e.head_version THEN
    RAISE EXCEPTION 'stale decision: entry % is at version %', e.id, e.head_version
      USING ERRCODE = 'serialization_failure';
  END IF;
  NEW.from_trust := e.trust; NEW.from_life := e.lifecycle;     -- recorded by the DB, never by app code
  IF NEW.actor_kind = 'agent' THEN                               -- hard rule 3 / D22, defence in depth
    RAISE EXCEPTION 'agents do not change trust or lifecycle' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.actor_kind = 'rule' AND (NEW.to_trust IS DISTINCT FROM 'quarantined' AND NEW.to_trust IS NOT NULL) THEN
    RAISE EXCEPTION 'server rules may only quarantine' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.actor_kind = 'rule' AND NEW.to_life IS NOT NULL AND NEW.to_life <> 'consolidated' THEN
    RAISE EXCEPTION 'server rules may only mark consolidated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.to_trust = 'approved' AND NOT EXISTS (
       SELECT 1 FROM entry_summaries s WHERE s.entry_id = e.id AND s.for_version = e.head_version AND s.status = 'kept') THEN
    RAISE EXCEPTION 'approve the summary with the text: keep or write a summary for version %', e.head_version;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_events_before_insert BEFORE INSERT ON entry_events
  FOR EACH ROW EXECUTE FUNCTION entry_events_before_insert();

CREATE FUNCTION entry_events_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v entry_versions%ROWTYPE; s entry_summaries%ROWTYPE;
BEGIN
  -- A person raising trust on a quarantined head releases that version: it becomes what readers get.
  IF NEW.actor_kind = 'human' AND NEW.to_trust IN ('proposed', 'approved') THEN
    SELECT * INTO v FROM entry_versions WHERE entry_id = NEW.entry_id AND version_no = NEW.for_version;
    SELECT * INTO s FROM entry_summaries WHERE entry_id = NEW.entry_id AND for_version = NEW.for_version
      AND status = 'kept' ORDER BY id DESC LIMIT 1;
    UPDATE entries SET served_version = v.version_no, kind = v.kind, title = v.title,
      valid_period = v.valid_period, summary_id = s.id,
      search = setweight(to_tsvector('simple', sb_norm(v.title)), 'A')
            || setweight(to_tsvector('simple', sb_norm(coalesce(s.summary, ''))), 'B')
            || setweight(to_tsvector('simple', sb_norm(left(v.body, 200000))), 'C')
    WHERE id = NEW.entry_id AND served_version IS DISTINCT FROM NEW.for_version;
  END IF;
  UPDATE entries SET
    trust     = coalesce(NEW.to_trust, trust),
    lifecycle = coalesce(NEW.to_life, lifecycle),
    seq       = nextval('entries_seq')
  WHERE id = NEW.entry_id;
  RETURN NULL;
END $$;
CREATE TRIGGER entry_events_after_insert AFTER INSERT ON entry_events
  FOR EACH ROW EXECUTE FUNCTION entry_events_after_insert();

-- The Consolidator's queue: fallback summaries, and proposed summaries waiting for a Keep.
CREATE VIEW summaries_needing_work AS
SELECT e.id AS entry_id, e.workspace_id, e.memory_id, e.served_version,
       CASE WHEN s.id IS NULL THEN 'missing' WHEN s.source = 'fallback' THEN 'fallback' END AS reason
FROM entries e LEFT JOIN entry_summaries s ON s.id = e.summary_id
WHERE e.forgotten_at IS NULL AND e.served_version IS NOT NULL
  AND (s.id IS NULL OR s.source = 'fallback');

-- ---------------------------------------------------------------------------------------------
-- 7. Links inside one brain. Cross-brain pointers are soft refs (sharing step), never FKs.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE entry_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  from_entry   uuid NOT NULL,
  to_entry     uuid NOT NULL,
  to_version   integer,          -- pinned for derived_from and supersedes
  relation     link_relation NOT NULL,
  status       link_status NOT NULL DEFAULT 'proposed',
  made_by_kind actor_kind NOT NULL,
  made_by      text NOT NULL,
  on_behalf_of text NOT NULL,
  reason       text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),   -- secret-scanned
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  decided_by   text,
  decided_at   timestamptz,
  ended_at     timestamptz,
  CONSTRAINT el_from_fk FOREIGN KEY (from_entry, workspace_id) REFERENCES entries(id, workspace_id),
  CONSTRAINT el_to_fk   FOREIGN KEY (to_entry, workspace_id)   REFERENCES entries(id, workspace_id),
  CONSTRAINT el_to_v_fk FOREIGN KEY (to_entry, to_version)     REFERENCES entry_versions(entry_id, version_no),
  CONSTRAINT el_not_self CHECK (from_entry <> to_entry),
  CONSTRAINT el_pinned   CHECK (relation NOT IN ('derived_from', 'supersedes') OR to_version IS NOT NULL),
  -- rule and person links are born accepted; agent links stay proposed and make NO approval card (R4-10)
  CONSTRAINT el_agent_proposed CHECK (made_by_kind <> 'agent' OR status = 'proposed' OR decided_by IS NOT NULL)
);
CREATE UNIQUE INDEX entry_links_live ON entry_links (from_entry, to_entry, relation) WHERE ended_at IS NULL AND status <> 'rejected';
CREATE INDEX entry_links_from_idx ON entry_links (from_entry) WHERE ended_at IS NULL;   -- hops go outward from seeds (R3-02)
CREATE INDEX entry_links_to_idx   ON entry_links (to_entry)   WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 8. Episodes (immutable raw input) and evidence (lineage)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE episodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  memory_id     uuid NOT NULL,
  origin_key    text NOT NULL CHECK (char_length(origin_key) <= 500),  -- 'url:..', 'person:..', 'doc:<sha256>', 'ci:..'
  episode_kind  text NOT NULL CHECK (episode_kind IN ('conversation', 'report', 'web_page', 'import_file',
                                                      'voice_note', 'ci_run', 'commit', 'meeting', 'other')),
  title         text NOT NULL CHECK (char_length(title) <= 200),
  content       text CHECK (octet_length(content) <= 1048576),
  blob_key      text,             -- private store key; the API streams it, never returns a URL (R1-12)
  occurred_period tstzrange,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  source        entry_source NOT NULL,
  captured_by_kind actor_kind NOT NULL,
  captured_by   text NOT NULL,
  on_behalf_of  text NOT NULL,
  quarantined_because text,       -- web sources are born quarantined (R1-14.3)
  redacted_at   timestamptz,
  CONSTRAINT episodes_memory_fk FOREIGN KEY (memory_id, workspace_id) REFERENCES memories(id, workspace_id),
  CONSTRAINT episodes_id_ws UNIQUE (id, workspace_id),
  CONSTRAINT episodes_has_content CHECK (content IS NOT NULL OR blob_key IS NOT NULL OR redacted_at IS NOT NULL),
  CONSTRAINT episodes_web_quarantined CHECK (source <> 'web' OR quarantined_because IS NOT NULL OR redacted_at IS NOT NULL)
);
CREATE INDEX episodes_origin_idx ON episodes (workspace_id, origin_key);

CREATE TABLE entry_evidence (
  entry_id      uuid NOT NULL,
  version_no    integer NOT NULL,     -- evidence belongs to the CONTENT version (R2-06)
  ord           smallint NOT NULL CHECK (ord BETWEEN 0 AND 49),
  workspace_id  uuid NOT NULL,
  episode_id    uuid,
  cited_entry   uuid,
  cited_version integer,
  ref           text CHECK (char_length(ref) <= 1000),   -- url, path@commit, run id
  origin_key    text,                                    -- lineage root for non-entry evidence
  observed_at   timestamptz,
  PRIMARY KEY (entry_id, version_no, ord),
  FOREIGN KEY (entry_id, version_no) REFERENCES entry_versions(entry_id, version_no),
  FOREIGN KEY (episode_id, workspace_id) REFERENCES episodes(id, workspace_id),
  FOREIGN KEY (cited_entry, cited_version) REFERENCES entry_versions(entry_id, version_no),
  CONSTRAINT evidence_one_target CHECK (num_nonnulls(episode_id, cited_entry, ref) = 1),
  CONSTRAINT evidence_root CHECK (ref IS NULL OR origin_key IS NOT NULL)
);
CREATE INDEX entry_evidence_cited_idx ON entry_evidence (cited_entry) WHERE cited_entry IS NOT NULL;

-- D22: an observation needs evidence on its current content version.
CREATE FUNCTION observation_needs_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'observation' AND NEW.quarantined_because IS NULL AND NOT EXISTS (
       SELECT 1 FROM entry_evidence WHERE entry_id = NEW.entry_id AND version_no = NEW.version_no) THEN
    RAISE EXCEPTION 'an observation needs evidence';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER observation_needs_evidence AFTER INSERT ON entry_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION observation_needs_evidence();

-- ---------------------------------------------------------------------------------------------
-- 9. Logs that cannot be backfilled later (step 5 reads them). Per reader, never shared (R1-05).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE entry_uses (            -- real uses only: appearing in a packet strengthens nothing (psych 3)
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,        -- the brain that owns the entry
  entry_id     uuid NOT NULL REFERENCES entries(id),
  version_no   integer NOT NULL,
  reader_id    text NOT NULL,        -- the person (on_behalf_of), from the token
  actor_kind   actor_kind NOT NULL,
  actor        text NOT NULL,
  kind         use_kind NOT NULL,
  task_id      uuid,
  packet_id    uuid,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entry_uses_reader_idx ON entry_uses (reader_id, entry_id, at);
CREATE INDEX entry_uses_entry_idx  ON entry_uses (entry_id);

CREATE TABLE packets (               -- one row per context packet: ids, never rendered text (R1-12)
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  built_at     timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL,
  reader_id    text NOT NULL,
  task_id      uuid,
  budget_tokens integer,
  PRIMARY KEY (id, built_at)
) PARTITION BY RANGE (built_at);
CREATE TABLE packets_default PARTITION OF packets DEFAULT;

CREATE TABLE packet_items (          -- exposures: what each packet showed, with each signal's part
  packet_id    uuid NOT NULL,
  built_at     timestamptz NOT NULL,
  entry_id     uuid NOT NULL,
  version_no   integer NOT NULL,
  summary_id   bigint,
  section      text NOT NULL CHECK (section IN ('about_me', 'rules', 'decisions', 'task', 'recall', 'collaborators', 'unknowns')),
  rank         smallint NOT NULL,
  score_parts  jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (packet_id, built_at, entry_id)
) PARTITION BY RANGE (built_at);     -- monthly partitions, dropped after 90 days (R3-08)
CREATE TABLE packet_items_default PARTITION OF packet_items DEFAULT;
CREATE INDEX packet_items_entry_idx ON packet_items (entry_id);

-- ---------------------------------------------------------------------------------------------
-- 10. Append-only guards. Only forget_entry (owned by the migration role) may scrub (R1-01, R2-01).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION memory_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND in_forget() THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['entry_versions', 'entry_events', 'entry_summaries', 'entry_evidence', 'episodes'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION memory_append_only()',
                   t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION memory_append_only()',
                   t || '_no_truncate', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 11. Hard forget: the one exception to append-only. Owner only, identity from the session,
--     one explicit scrub list (R1-01, R1-13, R2-03). Embeddings are added to it in step 4.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION forget_entry(p_entry uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e entries%ROWTYPE; who text := app_person();
BEGIN
  IF who IS NULL OR app_actor_kind() <> 'human' THEN
    RAISE EXCEPTION 'forget needs a signed-in person' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO e FROM entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM workspaces WHERE id = e.workspace_id AND owner_user_id = who) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'no_data_found';     -- same answer for "not yours"
  END IF;
  UPDATE entry_versions SET title = '[forgotten]', body = '', content_hash = NULL, props = '{}',
         capture_context = NULL, change_note = NULL, quarantined_because = NULL WHERE entry_id = p_entry;
  UPDATE entry_summaries SET summary = '[forgotten]', questions = '{}' WHERE entry_id = p_entry;
  UPDATE entry_events SET reason = NULL WHERE entry_id = p_entry;
  UPDATE entry_evidence SET ref = '[forgotten]' WHERE entry_id = p_entry AND ref IS NOT NULL;
  UPDATE entry_links SET reason = '[forgotten]', ended_at = coalesce(ended_at, now())
   WHERE from_entry = p_entry OR to_entry = p_entry;
  DELETE FROM packet_items WHERE entry_id = p_entry;
  -- everything built on it waits for the owner (R1-13.2)
  WITH RECURSIVE built_on(id) AS (
    SELECT from_entry FROM entry_links WHERE to_entry = p_entry AND relation = 'derived_from'
    UNION SELECT l.from_entry FROM entry_links l JOIN built_on b ON l.to_entry = b.id AND l.relation = 'derived_from')
  UPDATE entries SET forget_review = true WHERE id IN (SELECT id FROM built_on);
  UPDATE entries SET forgotten_at = now(), title = '[forgotten]', search = NULL, forget_review = false
   WHERE id = p_entry;
  INSERT INTO audit_log (workspace_id, actor, action, target_id, details)
  VALUES (e.workspace_id, who, 'entry.forget', p_entry, jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
END $$;
REVOKE ALL ON FUNCTION forget_entry(uuid, text) FROM PUBLIC;
