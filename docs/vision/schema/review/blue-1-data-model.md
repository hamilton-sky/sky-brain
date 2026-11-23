# Blue 1: data model and storage for the four memory levels

Author: blue team member 1 (designer). Lens: Postgres schema. 23 Nov 2026.
Covers core, long, short and working memory; the memory container; versions, valid and recorded time;
provenance and evidence lineage; links; consolidation; the bridge to today's board; a migration path.
Embedding/search detail (blue-retrieval) and sharing detail are left as hooks with real FKs.

---

## 0. The decisions in one table

| # | Decision | Short reason |
|---|---|---|
| 1 | The **brain is the workspace**. `workspaces.owner_user_id` is unique, so one person = one brain. | D17 already gives each person one workspace; reuse the membership filter (hard rule 4) instead of inventing a second root. |
| 2 | New **`memories`** table: the container. `layer` is on the memory. | A unit you can name, share, archive and point a board at. Requirement 2 and 3. |
| 3 | **Exactly one core memory per brain**: partial unique index for "at most one", a deferred constraint trigger for "at least one", and a delete guard. | Enforced by the DB, not by app code. |
| 4 | Entries carry **both** `memory_id` and a denormalized `layer`, kept honest by a composite FK `(memory_id, workspace_id, layer) → memories(id, workspace_id, layer)`. | Per-layer `CHECK` constraints and cheap layer filters need the column on the row; the composite FK makes drift impossible. |
| 5 | **Split identity from content**: `entries` = identity, placement, retention bookkeeping and a trigger-maintained *head cache*; `entry_versions` = append-only content, kind, trust, valid time, provenance. | D22 rule 3 ("nothing edited in place") without making every query a `DISTINCT ON`. |
| 6 | **Bitemporal**: `valid_period tstzrange` (when it was true) + `recorded_at` (when the brain learned it) on every version. | REVIEW.md B; "what did I believe on date X about date Y". |
| 7 | **Summary on every version** (owner direction): writer-supplied on agent writes, fallback on human writes flagged for the Consolidator; `summary_by`, `summary_author`, `summary_for_version` recorded. Vectors are built from the summary, never the full body. | Requirement 1. |
| 8 | An entry **never changes layer**. Consolidation = a **new derived entry** in the target memory with a version-pinned `derived_from` link. Refiling inside one layer is a versioned placement change. | Layers have different constraints, trust and permissions; a move would silently widen or narrow who can read the text and lose the episodic trace. |
| 9 | **Working memory = one per project**, linked by `memories.project_id`; `goals.memory_id` points at it; tasks inherit through their goal. Scratch entries scope to `goal_id`/`task_id`. | Keeps the board's per-project lock, run tokens and D20 rules untouched. Non-code work gets a plain project (git_remote is already nullable). |
| 10 | Links live in **`entry_links`**, entry-to-entry within one brain (composite FK on workspace), across memories and layers freely, with optional version pins, status, reason and valid time. | VISION "Self-made links"; cross-memory is the normal case (short → long). |
| 11 | Lineage: immutable **`episodes`** (raw input) with an `origin_key`; `entry_evidence` per version; independent sources = distinct `origin_key` over the `derived_from` closure. | REVIEW.md C: repetition is not evidence. |
| 12 | DB-level defence in depth for hard rule 3: agents cannot write core, cannot write `approved`, cannot raise trust, cannot change kind, cannot version an approved entry. | Server code is still the gate; the DB makes a bug fail closed. |
| 13 | Hooks: `entry_chunks` keyed to `(entry_id, version_no)` with `memory_id` denormalized for filtered ANN; `memory_grants` per memory or per layer; `entry_uses` access log. | For blue-retrieval and the sharing designer. |

---

## 1. The brain root: workspaces

Today `onSignIn` creates a workspace and an `owner` row in `members` when the person has no
`members` row at all. That test is fragile: a person whose first sign-in also accepts an invite
still gets an own workspace (invites are applied after), but "owner of which workspace" is only
recoverable from `members.role`. Make it a column.

```sql
-- M1 (additive)
ALTER TABLE workspaces ADD COLUMN owner_user_id text REFERENCES "user"(id) ON DELETE RESTRICT;

UPDATE workspaces w SET owner_user_id = m.user_id
FROM members m WHERE m.workspace_id = w.id AND m.role = 'owner';
-- if a workspace has two owner rows, the backfill must pick one by hand first (expect none: D17).

ALTER TABLE workspaces ALTER COLUMN owner_user_id SET NOT NULL;
CREATE UNIQUE INDEX workspaces_one_brain_per_person ON workspaces (owner_user_id);
```

"One core memory per person" then reduces to "one core memory per workspace". If team brains ever
come, add `is_personal boolean` and make this index partial on it; the core rule moves with it.

`members` keeps meaning "full access to the whole brain" (today: the owner, plus any legacy
invites). New collaborators get `memory_grants` rows (section 9), not `members` rows.

---

## 2. Enums and the type catalogue

```sql
CREATE TYPE memory_layer    AS ENUM ('core', 'long', 'short', 'working');
CREATE TYPE memory_state    AS ENUM ('active', 'archived');
-- D22 kind. Named knowledge_kind because entry_kind is today's (legacy) enum.
CREATE TYPE knowledge_kind  AS ENUM ('fact', 'decision', 'hypothesis', 'observation', 'external');
-- D22 trust. Declared low to high so `>` means "raises trust".
CREATE TYPE trust_level     AS ENUM ('quarantined', 'proposed', 'approved');
-- Lifecycle is separate from trust: an approved decision can be superseded; a proposed one rejected.
-- 'expired' is NOT stored: it is computed at read time from expires_at, as entries-view.ts does today.
CREATE TYPE entry_lifecycle AS ENUM ('active', 'superseded', 'closed', 'rejected', 'retracted', 'consolidated');
-- Where the statement came from epistemically (VISION brain-science #2, source monitoring).
-- entry_source (human/agent/code/web/import) stays: that is the channel.
CREATE TYPE entry_origin    AS ENUM ('stated', 'observed', 'inferred', 'consolidated', 'imported');
CREATE TYPE version_change  AS ENUM ('create', 'edit', 'trust', 'kind', 'lifecycle', 'refile', 'resummarize', 'redact');
CREATE TYPE summary_origin  AS ENUM ('writer', 'fallback', 'steward', 'person');
CREATE TYPE link_relation   AS ENUM ('supports', 'contradicts', 'supersedes', 'derived_from', 'answers',
                                     'about', 'part_of', 'depends_on', 'related');
CREATE TYPE link_status     AS ENUM ('proposed', 'accepted', 'rejected');
CREATE TYPE link_maker      AS ENUM ('person', 'rule', 'steward', 'agent');
```

D22 keeps "what the item is about" (rule, question, lesson, note...) apart from `kind`. That is
`item_type`, and types are data (VISION "Tables: generic core, configured by data"):

```sql
CREATE TABLE item_types (
  slug          text PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9_]{1,39}$'),
  layers        memory_layer[] NOT NULL CHECK (cardinality(layers) > 0),
  kind_required boolean NOT NULL DEFAULT true,   -- false only for non-statements (question)
  description   text NOT NULL
);

-- Seed (descriptions omitted here). kind_required is false only for 'question'.
-- core:    about_me, value, preference(+long), standing_rule(+long), relationship(+long)
-- long:    rule(+working), decision_record, lesson, person, topic (schema node),
--          summary (layered summaries), note(+short,+working), artifact(+working),
--          answer(+short,+working), question(+short,+working)
-- short:   capture, episode_note
-- working: scratch, finding, resume_note, plan
```

---

## 3. `memories`: the container

```sql
CREATE TABLE memories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  layer        memory_layer NOT NULL,
  slug         text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description  text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  project_id   uuid,                          -- working: required; long: optional (a project's knowledge)
  is_default   boolean NOT NULL DEFAULT false, -- the inbox / general long memory / core
  state        memory_state NOT NULL DEFAULT 'active',
  default_ttl  interval,                       -- short only: fade window for new items
  max_items    integer,                        -- core only: hard cap on active items
  token_budget integer,                        -- core only: what "always loaded" may cost
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,

  CONSTRAINT memories_slug_unique         UNIQUE (workspace_id, slug),
  CONSTRAINT memories_id_ws_unique        UNIQUE (id, workspace_id),
  CONSTRAINT memories_id_ws_layer_unique  UNIQUE (id, workspace_id, layer),
  CONSTRAINT memories_id_project_layer_unique UNIQUE (id, project_id, layer),
  -- PG15+: on project delete null only project_id; the working CHECK below then refuses it,
  -- so a project cannot be deleted while its working memory exists (archive that first),
  -- while a long memory about the project survives with project_id null.
  CONSTRAINT memories_project_in_workspace_fk FOREIGN KEY (project_id, workspace_id)
    REFERENCES projects(id, workspace_id) ON DELETE SET NULL (project_id),

  CONSTRAINT memories_core_shape CHECK (layer <> 'core' OR (
      project_id IS NULL AND is_default AND state = 'active'
      AND max_items BETWEEN 1 AND 500 AND token_budget BETWEEN 200 AND 8000)),
  CONSTRAINT memories_core_only_caps CHECK (layer = 'core' OR (max_items IS NULL AND token_budget IS NULL)),
  CONSTRAINT memories_working_has_project CHECK (layer <> 'working' OR project_id IS NOT NULL),
  CONSTRAINT memories_short_ttl CHECK (
      (layer = 'short' AND default_ttl BETWEEN interval '1 day' AND interval '365 days')
   OR (layer <> 'short' AND default_ttl IS NULL)),
  CONSTRAINT memories_archived_at CHECK ((state = 'archived') = (archived_at IS NOT NULL))
);

-- Requirement 2, "at most one": one core per brain (and brain = person, section 1).
CREATE UNIQUE INDEX memories_one_core_per_workspace ON memories (workspace_id) WHERE layer = 'core';
-- One default per layer: the inbox (short), the general long memory, the core.
CREATE UNIQUE INDEX memories_one_default_per_layer ON memories (workspace_id, layer) WHERE is_default;
-- One working memory (board) per project.
CREATE UNIQUE INDEX memories_one_working_per_project ON memories (project_id) WHERE layer = 'working';
CREATE INDEX memories_ws_layer_idx ON memories (workspace_id, layer, state);
```

### 3.1 "Exactly one" core, enforced in the database

```sql
-- Layer and brain never change; core is never archived or deleted on its own.
CREATE FUNCTION memories_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.layer <> OLD.layer OR NEW.workspace_id <> OLD.workspace_id THEN
      RAISE EXCEPTION 'a memory never changes layer or brain' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE: allowed for core only when its workspace is already gone (cascade from a brain delete).
  IF OLD.layer = 'core' AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'the core memory cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER memories_guard BEFORE UPDATE OR DELETE ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_guard();

-- "At least one": a brain must have its core by the end of the transaction that creates it.
CREATE FUNCTION workspaces_need_core() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspaces WHERE id = NEW.id)          -- not deleted later in the tx
     AND NOT EXISTS (SELECT 1 FROM memories WHERE workspace_id = NEW.id AND layer = 'core') THEN
    RAISE EXCEPTION 'workspace % has no core memory', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workspaces_need_core AFTER INSERT ON workspaces
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspaces_need_core();
```

`onSignIn` then inserts, in its existing transaction: the workspace, the owner `members` row, the
core memory (`max_items` 60, `token_budget` 1500), a default short memory `inbox`
(`default_ttl` 30 days) and a default long memory `general`. The test "cascade delete sees the
parent gone" in `memories_guard` must be proven in PGlite and Postgres (an RI cascade runs after
the parent row is deleted, so the `EXISTS` is false), with an allowed and a refused case.

### Why `layer` sits on the memory, and why also on the entry

- On the memory because a memory *is* a layer: its rules (TTL, cap, who may write), its grants
  and its place in the packet are layer rules. A grant "all my short memories" needs it there.
- Also on the entry because per-layer `CHECK`s (short must expire; core has no goal; long facts
  need valid time) can only read columns of the same row, and the hottest filter (`layer`,
  `lifecycle`, `trust`) should not need a join. The composite FK to
  `memories(id, workspace_id, layer)` plus "a memory never changes layer" means the copy can
  never disagree. Same pattern the repo already uses for `(project_id, workspace_id)`.
- Rejected: layer only on entries (the sketch): no unit to share, no place to hang "one core",
  no per-memory policy. Layer only on memories: every check becomes a trigger and every filter a join.

---

## 4. `entries` (identity + head cache) and `entry_versions` (content)

Today's `entries` has no API (BUILD-PLAN: "exists with no API or tools"), so it can be reshaped
now. The legacy table is renamed and copied (section 11).

### 4.1 `entries`

```sql
CREATE TABLE entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigint NOT NULL DEFAULT nextval('entries_seq'),  -- bumped on every new version
  workspace_id  uuid NOT NULL,
  memory_id     uuid NOT NULL,                  -- head cache: placement of the head version
  layer         memory_layer NOT NULL,          -- fixed at birth; never changes
  -- placement inside the memory (bookkeeping, audited, not content)
  feature_id    uuid REFERENCES features(id) ON DELETE SET NULL,
  goal_id       uuid REFERENCES goals(id)    ON DELETE SET NULL,   -- working only
  task_id       uuid REFERENCES tasks(id)    ON DELETE SET NULL,   -- working only
  -- head cache, written ONLY by the entry_versions trigger (4.3)
  head_version  integer NOT NULL DEFAULT 0,
  kind          knowledge_kind,
  item_type     text,
  trust         trust_level,
  lifecycle     entry_lifecycle,
  title         text,
  summary       text,
  needs_summary boolean NOT NULL DEFAULT false, -- head summary is a fallback: Consolidator queue
  valid_period  tstzrange,
  search        tsvector,                       -- 'simple' config: Hebrew + English
  -- retention and salience bookkeeping (mutable through the API, every change audited)
  expires_at    timestamptz,                    -- short: fades; working: set when the goal closes
  review_due_at timestamptz,                    -- long/core: next "still true?" check (1,7,30,90 d)
  salience      smallint NOT NULL DEFAULT 0 CHECK (salience BETWEEN 0 AND 3), -- person flag; priority, never trust
  core_rank     smallint,                       -- core: load order in the always-on packet
  consolidate_into uuid,                        -- proposal: "this belongs in memory X" (review queue)
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  forgotten_at  timestamptz,                    -- hard forget tombstone (section 10)

  CONSTRAINT entries_seq_unique   UNIQUE (seq),
  CONSTRAINT entries_id_ws_unique UNIQUE (id, workspace_id),
  CONSTRAINT entries_in_memory_fk FOREIGN KEY (memory_id, workspace_id, layer)
    REFERENCES memories(id, workspace_id, layer),        -- NO ACTION: history pins its memory
  CONSTRAINT entries_consolidate_into_fk FOREIGN KEY (consolidate_into, workspace_id)
    REFERENCES memories(id, workspace_id),
  CONSTRAINT entries_item_type_fk FOREIGN KEY (item_type) REFERENCES item_types(slug),

  CONSTRAINT entries_head_filled CHECK (head_version = 0 OR (
      kind IS NOT NULL OR item_type = 'question') AND trust IS NOT NULL AND lifecycle IS NOT NULL
      AND title IS NOT NULL AND summary IS NOT NULL AND search IS NOT NULL),
  -- per-layer shape
  CONSTRAINT entries_short_fades   CHECK (layer <> 'short' OR expires_at IS NOT NULL),
  CONSTRAINT entries_durable_no_ttl CHECK (layer NOT IN ('core', 'long') OR expires_at IS NULL),
  CONSTRAINT entries_task_scope    CHECK (layer = 'working' OR (goal_id IS NULL AND task_id IS NULL)),
  CONSTRAINT entries_core_rank     CHECK ((layer = 'core') = (core_rank IS NOT NULL)),
  CONSTRAINT entries_review_due    CHECK (review_due_at IS NULL OR layer IN ('core', 'long')),
  CONSTRAINT entries_consolidate_from CHECK (consolidate_into IS NULL OR layer IN ('short', 'working'))
);

CREATE INDEX entries_memory_live_idx ON entries (memory_id, lifecycle, trust, updated_at DESC)
  WHERE forgotten_at IS NULL;
CREATE INDEX entries_ws_layer_idx    ON entries (workspace_id, layer, lifecycle) WHERE forgotten_at IS NULL;
CREATE INDEX entries_ws_seq_idx      ON entries (workspace_id, seq);            -- "what changed since"
CREATE INDEX entries_search_idx      ON entries USING gin (search);
CREATE INDEX entries_title_trgm_idx  ON entries USING gin (title gin_trgm_ops); -- Hebrew prefix/typo
CREATE INDEX entries_short_fade_idx  ON entries (memory_id, expires_at) WHERE layer = 'short';
CREATE INDEX entries_review_idx      ON entries (workspace_id, review_due_at) WHERE review_due_at IS NOT NULL;
CREATE INDEX entries_goal_idx        ON entries (goal_id, task_id) WHERE goal_id IS NOT NULL;
CREATE INDEX entries_needs_summary_idx ON entries (workspace_id) WHERE needs_summary;
CREATE INDEX entries_consolidate_idx ON entries (consolidate_into) WHERE consolidate_into IS NOT NULL;
```

### 4.2 `entry_versions` (append-only)

```sql
CREATE TABLE entry_versions (
  entry_id      uuid NOT NULL REFERENCES entries(id),   -- NO ACTION: see forget (section 10)
  version_no    integer NOT NULL CHECK (version_no >= 1),
  workspace_id  uuid NOT NULL,
  memory_id     uuid NOT NULL,          -- placement as of this version (refile history)
  layer         memory_layer NOT NULL,
  change        version_change NOT NULL,
  change_note   text CHECK (char_length(change_note) <= 500),

  -- content
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body          text NOT NULL CHECK (octet_length(body) <= 262144),  -- markdown; Gatekeeper caps lower per source
  content_hash  bytea NOT NULL,         -- sha256(title || 0x00 || body): dedupe, "content unchanged" checks
  content_from_version integer NOT NULL, -- the version whose text this is (= version_no on create/edit)
  lang          text CHECK (lang IN ('he', 'en', 'mixed', 'other')),
  props         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(props) = 'object'),

  -- summary (owner direction, 23 Nov): every version carries one
  summary       text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 600),
  summary_by    summary_origin NOT NULL,  -- writer | fallback | steward | person
  summary_author text NOT NULL,           -- user id or agent identity that wrote the summary text
  summary_for_version integer NOT NULL,   -- the content version the summary was written for

  -- D22 + lifecycle
  kind          knowledge_kind,           -- null only for item_type 'question'
  item_type     text NOT NULL REFERENCES item_types(slug),
  trust         trust_level NOT NULL,
  lifecycle     entry_lifecycle NOT NULL DEFAULT 'active',
  quarantined_because text,

  -- time
  valid_period  tstzrange,                -- valid time: when the statement held in the world
  recorded_at   timestamptz NOT NULL DEFAULT now(),  -- recorded time: when the brain learned it
  confidence    real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  confidence_at_encoding real CHECK (confidence_at_encoding IS NULL OR confidence_at_encoding BETWEEN 0 AND 1),
  capture_context jsonb CHECK (capture_context IS NULL OR jsonb_typeof(capture_context) = 'object'),
      -- encoding context: {project, goal_id, task_id, persona, client, conversation, place, ...}

  -- content provenance (who wrote the TEXT; copied forward when the text is unchanged)
  source        entry_source NOT NULL,    -- channel: human | agent | code | web | import
  origin        entry_origin NOT NULL,    -- stated | observed | inferred | consolidated | imported
  author_kind   author_kind NOT NULL,
  author        text NOT NULL,            -- user id or e.g. 'claude-code/builder'
  -- change provenance (who made THIS version)
  changed_by_kind author_kind NOT NULL,
  changed_by    text NOT NULL,
  on_behalf_of  text NOT NULL,            -- the person whose session/device it was (from the token)
  device_id     uuid REFERENCES devices(id),
  client_id     text,                     -- OAuth client, for MCP writes
  run_task_id   uuid,                     -- task under claim when written
  run_claim_seq bigint,                   -- with run_task_id: which claim (fencing number)
  redacted_at   timestamptz,

  PRIMARY KEY (entry_id, version_no),
  CONSTRAINT entry_versions_in_memory_fk FOREIGN KEY (memory_id, workspace_id, layer)
    REFERENCES memories(id, workspace_id, layer),
  CONSTRAINT ev_content_from CHECK (content_from_version BETWEEN 1 AND version_no),
  CONSTRAINT ev_summary_for  CHECK (summary_for_version BETWEEN 1 AND version_no),
  CONSTRAINT ev_create_is_v1 CHECK ((change = 'create') = (version_no = 1)),
  CONSTRAINT ev_kind_present CHECK (kind IS NOT NULL OR item_type = 'question'),
  CONSTRAINT ev_valid_nonempty CHECK (valid_period IS NULL OR NOT isempty(valid_period)),
  -- D22: an observation carries the time it held (its evidence: deferred trigger 4.4)
  CONSTRAINT ev_observation_time CHECK (kind IS DISTINCT FROM 'observation'
      OR (valid_period IS NOT NULL AND NOT lower_inf(valid_period))),
  -- long memory: facts and decisions say since when they hold
  CONSTRAINT ev_long_valid_time CHECK (layer <> 'long' OR kind NOT IN ('fact', 'decision')
      OR (valid_period IS NOT NULL AND NOT lower_inf(valid_period))),
  -- hard rule 3, defence in depth
  CONSTRAINT ev_agent_never_approves CHECK (changed_by_kind = 'human' OR trust <> 'approved'),
  CONSTRAINT ev_core_is_human  CHECK (layer <> 'core' OR changed_by_kind = 'human'),
  CONSTRAINT ev_fallback_human CHECK (summary_by <> 'fallback' OR author_kind = 'human'),
  CONSTRAINT ev_quarantine_reason CHECK (quarantined_because IS NULL OR trust = 'quarantined'
      OR version_no > 1)  -- reason is kept on the version that held it
);

CREATE INDEX entry_versions_asof_idx ON entry_versions (workspace_id, recorded_at);
CREATE INDEX entry_versions_valid_idx ON entry_versions USING gist (valid_period);
CREATE INDEX entry_versions_hash_idx ON entry_versions (workspace_id, content_hash);  -- near-dup guard
```

**The summary rule (owner direction) in columns.**

- Agent writes: `summary` is required in the request; the Gatekeeper refuses a missing or
  over-length one (and secret-scans it like the body). Stored with `summary_by='writer'`,
  `summary_author = author`, `summary_for_version = version_no`.
- Human writes without one: the server stores `title || ' — ' || <first ~500 chars of body,
  cut at a sentence or line>` with `summary_by='fallback'`; the head trigger sets
  `entries.needs_summary = true`, which is the Consolidator's queue (`entries_needs_summary_idx`).
- The Consolidator's better summary is a new version with `change='resummarize'`: title, body,
  kind, trust, lifecycle and provenance copied, `content_from_version` and `summary_for_version`
  pointing at the content version, `summary_by='steward'`, `summary_author` = the Steward.
  This is the one change an agent may make to an approved entry (trigger 4.3 checks the content
  hash is unchanged). The packet labels a steward summary as such. Core is human-only, so core
  fallbacks are re-summarized by a person or stay as they are.
- A summary whose `summary_for_version` is older than the head's `content_from_version` is stale;
  the trigger sets `needs_summary` then too (a human edit without a new summary).
- Embeddings are built from the summary (and optional question chunks), never from the body
  (section 9). Full-text search keeps the body.

### 4.3 The head trigger and the write rules

```sql
CREATE FUNCTION entry_versions_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e entries%ROWTYPE; prev entry_versions%ROWTYPE; it item_types%ROWTYPE;
BEGIN
  SELECT * INTO e FROM entries WHERE id = NEW.entry_id FOR UPDATE;   -- serializes writers per entry
  -- optimistic concurrency: the writer sends the version it started from (+1); stale = refused
  IF NEW.version_no <> e.head_version + 1 THEN
    RAISE EXCEPTION 'stale write: entry % is at version %', e.id, e.head_version
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF NEW.layer <> e.layer OR NEW.workspace_id <> e.workspace_id THEN
    RAISE EXCEPTION 'an entry never changes layer or brain; consolidate into a new entry'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO it FROM item_types WHERE slug = NEW.item_type;
  IF NOT (NEW.layer = ANY (it.layers)) THEN
    RAISE EXCEPTION 'item type % is not allowed in % memory', NEW.item_type, NEW.layer;
  END IF;
  IF NEW.version_no > 1 THEN
    SELECT * INTO prev FROM entry_versions WHERE entry_id = NEW.entry_id AND version_no = e.head_version;
    IF NEW.confidence_at_encoding IS DISTINCT FROM prev.confidence_at_encoding THEN
      RAISE EXCEPTION 'confidence_at_encoding is frozen at the first version';
    END IF;
    IF NEW.changed_by_kind = 'agent' THEN
      IF NEW.trust > prev.trust THEN RAISE EXCEPTION 'only a person raises trust'; END IF;
      IF NEW.kind IS DISTINCT FROM prev.kind THEN RAISE EXCEPTION 'only a person changes kind'; END IF;
      IF prev.trust = 'approved' AND NOT (NEW.change = 'resummarize'
           AND NEW.content_hash = prev.content_hash AND NEW.trust = prev.trust
           AND NEW.lifecycle = prev.lifecycle AND NEW.memory_id = prev.memory_id) THEN
        RAISE EXCEPTION 'agents do not version an approved entry; propose a superseding entry';
      END IF;
      IF NEW.lifecycle <> prev.lifecycle AND NEW.lifecycle NOT IN ('consolidated') THEN
        RAISE EXCEPTION 'only a person closes, rejects or supersedes';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_versions_before_insert BEFORE INSERT ON entry_versions
  FOR EACH ROW EXECUTE FUNCTION entry_versions_before_insert();

CREATE FUNCTION entry_versions_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m memories%ROWTYPE; n integer;
BEGIN
  PERFORM set_config('sky_brain.head_sync', 'on', true);
  UPDATE entries SET
    head_version = NEW.version_no, seq = nextval('entries_seq'), updated_at = now(),
    memory_id = NEW.memory_id, kind = NEW.kind, item_type = NEW.item_type, trust = NEW.trust,
    lifecycle = NEW.lifecycle, title = NEW.title, summary = NEW.summary, valid_period = NEW.valid_period,
    needs_summary = (NEW.summary_by = 'fallback' OR NEW.summary_for_version < NEW.content_from_version),
    search = setweight(to_tsvector('simple', NEW.title), 'A')
          || setweight(to_tsvector('simple', NEW.summary), 'B')
          || setweight(to_tsvector('simple', left(NEW.body, 200000)), 'C')
  WHERE id = NEW.entry_id;
  PERFORM set_config('sky_brain.head_sync', 'off', true);

  IF NEW.layer = 'core' AND NEW.lifecycle = 'active' THEN          -- core stays small
    SELECT * INTO m FROM memories WHERE id = NEW.memory_id FOR UPDATE;
    SELECT count(*) INTO n FROM entries WHERE memory_id = m.id AND lifecycle = 'active' AND forgotten_at IS NULL;
    IF n > m.max_items THEN
      RAISE EXCEPTION 'core memory is full (% items); close or merge one first', m.max_items;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER entry_versions_after_insert AFTER INSERT ON entry_versions
  FOR EACH ROW EXECUTE FUNCTION entry_versions_after_insert();

-- The head cache and the layer can only be written by the trigger above.
CREATE FUNCTION entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layer <> OLD.layer OR NEW.workspace_id <> OLD.workspace_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'entry identity is immutable';
  END IF;
  IF coalesce(current_setting('sky_brain.head_sync', true), 'off') <> 'on' AND
     (NEW.head_version, NEW.memory_id, NEW.kind, NEW.item_type, NEW.trust, NEW.lifecycle,
      NEW.title, NEW.summary, NEW.valid_period, NEW.search, NEW.seq)
     IS DISTINCT FROM
     (OLD.head_version, OLD.memory_id, OLD.kind, OLD.item_type, OLD.trust, OLD.lifecycle,
      OLD.title, OLD.summary, OLD.valid_period, OLD.search, OLD.seq) THEN
    RAISE EXCEPTION 'entries content changes only through a new entry_versions row'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entries_guard BEFORE UPDATE ON entries FOR EACH ROW EXECUTE FUNCTION entries_guard();

-- Append-only, except the forget path (section 10).
CREATE FUNCTION entry_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('sky_brain.forget', true), 'off') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'entry_versions is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER entry_versions_no_update_delete BEFORE UPDATE OR DELETE ON entry_versions
  FOR EACH ROW EXECUTE FUNCTION entry_versions_append_only();
CREATE TRIGGER entry_versions_no_truncate BEFORE TRUNCATE ON entry_versions
  FOR EACH STATEMENT EXECUTE FUNCTION entry_versions_append_only();
```

A write is always: `INSERT INTO entries (..., head_version 0)` (create only) then
`INSERT INTO entry_versions (...)` in the same transaction. Placement and bookkeeping
(`goal_id`, `task_id`, `feature_id`, `expires_at`, `review_due_at`, `salience`, `core_rank`,
`consolidate_into`) are plain `UPDATE`s through the API, each with an `audit_log` row. They are
not content: bumping `expires_at` on every use must not mint a version.

### 4.4 Deferred checks at commit

```sql
CREATE FUNCTION entries_commit_checks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e entries%ROWTYPE; g_project uuid; m_project uuid;
BEGIN
  SELECT * INTO e FROM entries WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF e.head_version = 0 THEN
    RAISE EXCEPTION 'entry % has no version', e.id;
  END IF;
  -- D22: an observation must carry evidence
  IF e.kind = 'observation' AND NOT EXISTS (
       SELECT 1 FROM entry_evidence WHERE entry_id = e.id AND version_no = e.head_version) THEN
    RAISE EXCEPTION 'an observation needs evidence';
  END IF;
  -- working scope: goal/task belong to the memory's project
  IF e.goal_id IS NOT NULL THEN
    SELECT project_id INTO g_project FROM goals WHERE id = e.goal_id;
    SELECT project_id INTO m_project FROM memories WHERE id = e.memory_id;
    IF g_project IS DISTINCT FROM m_project THEN RAISE EXCEPTION 'goal is not on this board'; END IF;
    IF e.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = e.task_id AND goal_id = e.goal_id) THEN
      RAISE EXCEPTION 'task is not under this goal';
    END IF;
  ELSIF e.task_id IS NOT NULL THEN
    RAISE EXCEPTION 'a task scope needs its goal';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entries_commit_checks AFTER INSERT OR UPDATE ON entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION entries_commit_checks();

-- Short items get their memory's TTL when the writer gives none.
CREATE FUNCTION entries_default_ttl() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layer = 'short' AND NEW.expires_at IS NULL THEN
    SELECT now() + default_ttl INTO NEW.expires_at FROM memories WHERE id = NEW.memory_id;
  END IF;
  IF NEW.layer = 'core' AND NEW.core_rank IS NULL THEN NEW.core_rank := 100; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entries_default_ttl BEFORE INSERT ON entries
  FOR EACH ROW EXECUTE FUNCTION entries_default_ttl();
```

### Why split identity and content

- Every FK that means "this entry" (links, uses, goals' context refs, chunks' owner) points at a
  stable `entries.id`; FKs that mean "this exact text" point at `(entry_id, version_no)`.
- Hot reads (packet, lists, search) hit one row per entry with a GIN index on the head; history
  reads hit `entry_versions`. The body is not duplicated on `entries` (only title, summary,
  tsvector); the body is one PK lookup away.
- Rejected: one row per version in `entries` with an `is_head` flag. Flipping the flag is an
  in-place edit, every FK to "the entry" is ambiguous, and partial indexes on the flag churn.
- Rejected: a view `entry_heads` (`DISTINCT ON`) with no cache. Correct but every search and packet
  pays a sort over history; the GIN index can't be on a view.
- Rejected: supersession inside one entry (v2 "replaces" v1). Supersession is between entries
  (a new decision replaces an old one, often written by someone else, with its own trust life),
  so it is a link (section 6). Versions are corrections, trust and lifecycle changes of the *same*
  statement.

---

## 5. What differs per level

| | Core | Long | Short | Working |
|---|---|---|---|---|
| Count per person | exactly 1 (`memories_one_core_per_workspace` + deferred trigger) | many | many; one default `inbox` | many; one per project |
| Size | `max_items` (≤ 500, default 60) active, `token_budget` | unbounded | unbounded, fades | per goal, cleared when done |
| Who writes | people only (`ev_core_is_human`) | people approve; agents propose | anyone; agents propose; web/import quarantined | agents and people; scratch is `proposed` by default |
| Expiry | none (`entries_durable_no_ttl`) | none; `review_due_at` for "still true?" | `expires_at` NOT NULL, default from `default_ttl`; extended by real uses | `expires_at` set when the goal is done/cancelled (+14 d) |
| Valid time | optional | required for facts/decisions (`ev_long_valid_time`) | optional (episodes carry `occurred_period`) | optional |
| Scope | the whole brain | optional `memories.project_id`, `feature_id` | none | `goal_id`, `task_id` (`entries_task_scope`) |
| Loaded | always: approved active items by `core_rank`, summaries only, within `token_budget` | retrieved | retrieved (recent boost) | in the claim packet for its goal/task |
| Item types | about_me, preference, value, standing_rule, relationship | rule, decision_record, lesson, person, topic, summary, note, artifact, answer, question | capture, episode_note, note, question, answer | scratch, finding, resume_note, plan, rule, artifact, question |
| Psychology | self-schema: small, stable, approved | semantic memory, schemas (`topic`, `part_of`) | episodic / hippocampal store: verbatim, fades unless used or consolidated | Baddeley/Cowan working memory: ~4 chunks, cleared on completion |

Notes:
- Short "fades" means it drops out of default retrieval after `expires_at`; it is not deleted.
  A retention job (VISION Growth #2) can later move old unconsolidated bodies to cold storage
  behind the summary. Each counted use (cited, acted on, confirmed) extends `expires_at` on an
  expanding schedule (spacing); appearing in results does not (psych finding 3).
- Core is the old "workspace (global) scope": hard rule 3 says agents never write there, so the
  DB refuses it. An agent that thinks something belongs in core writes it to short or long with
  `consolidate_into = <core memory id>`; a person accepts and the server writes the core entry.

---

## 6. Links (`entry_links`)

```sql
CREATE TABLE entry_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  from_entry    uuid NOT NULL,
  from_version  integer,                -- pinned: which version of the source says this
  to_entry      uuid NOT NULL,
  to_version    integer,                -- pinned: which version it was derived from / supersedes
  relation      link_relation NOT NULL,
  status        link_status NOT NULL DEFAULT 'proposed',
  made_by_kind  link_maker NOT NULL,
  made_by       text NOT NULL,
  on_behalf_of  text NOT NULL,
  run_task_id   uuid,
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  confidence    real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  valid_period  tstzrange,              -- when the relation held
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  decided_by    text,                   -- the person (or rule) that accepted/rejected it
  decided_at    timestamptz,
  ended_at      timestamptz,            -- retracted; kept for history
  ended_by      text,

  -- same brain on both ends; any memory, any layer
  CONSTRAINT entry_links_from_fk FOREIGN KEY (from_entry, workspace_id) REFERENCES entries(id, workspace_id),
  CONSTRAINT entry_links_to_fk   FOREIGN KEY (to_entry, workspace_id)   REFERENCES entries(id, workspace_id),
  CONSTRAINT entry_links_from_v_fk FOREIGN KEY (from_entry, from_version) REFERENCES entry_versions(entry_id, version_no),
  CONSTRAINT entry_links_to_v_fk   FOREIGN KEY (to_entry, to_version)     REFERENCES entry_versions(entry_id, version_no),
  CONSTRAINT entry_links_not_self CHECK (from_entry <> to_entry),
  CONSTRAINT entry_links_pinned CHECK (relation NOT IN ('derived_from', 'supersedes') OR to_version IS NOT NULL),
  CONSTRAINT entry_links_decided CHECK ((status = 'proposed') = (decided_at IS NULL)),
  CONSTRAINT entry_links_accept_by CHECK (status <> 'accepted' OR made_by_kind IN ('person', 'rule')
      OR decided_by IS NOT NULL),
  CONSTRAINT entry_links_ended CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CREATE UNIQUE INDEX entry_links_live_unique ON entry_links (from_entry, to_entry, relation)
  WHERE ended_at IS NULL AND status <> 'rejected';
CREATE INDEX entry_links_from_idx ON entry_links (from_entry, relation) WHERE ended_at IS NULL;
CREATE INDEX entry_links_to_idx   ON entry_links (to_entry, relation)   WHERE ended_at IS NULL;
CREATE INDEX entry_links_proposed_idx ON entry_links (workspace_id, recorded_at) WHERE status = 'proposed';
```

A guard trigger (same shape as `entries_guard`) lets only `status`, `decided_by`, `decided_at`,
`ended_at`, `ended_by` change, each at most once; agents never set `decided_by`.

Rules:
- **Direction**: `from` is the newer or dependent item. "Short capture S was consolidated into
  long lesson L" is `L derived_from S@v`. "Decision B replaces A" is `B supersedes A@v`.
- **Cross-memory and cross-layer** links are ordinary rows: the FK only demands the same brain.
  Links across brains (someone else's shared memory) are not rows; they are refs in `props`.
- **Visibility**: a link is served only when the caller can read both ends' memories (sharing
  designer); otherwise it is silently dropped, so its existence does not leak.
- **Who makes**: `rule` links (server-made, e.g. consolidation's `derived_from`, task→finding
  `part_of`) are born `accepted`; `steward`/`agent` links are born `proposed`; a person accepts.
  VISION's "accepted when retrieval uses them or a second run agrees" is a ranking weight on
  proposed links, not a status change (keeps D22's "nothing promoted automatically").
- **Reverse dependency**: when an entry is superseded or corrected, everything whose
  `derived_from` pin points at an older version is flagged for review (query 12.4).

---

## 7. Consolidation and moving between layers

**Decision: consolidation creates a new entry. It never changes an entry's layer.**

```
short/inbox  S (v1, episode_note, proposed, expires in 30 d)
     │  Consolidator proposes; person keeps
     ▼
long/health  L (v1, lesson, proposed→approved by person, valid from <date>)
             L ──derived_from──▶ S@v1   (rule link, accepted)
             S v2: lifecycle 'consolidated' (stays searchable as history; fading continues)
```

In one server transaction: insert `entries` L (layer long, target memory), insert L v1
(`origin='consolidated'`, `trust='proposed'`, `summary_by='writer'` from the Steward's text,
`valid_period` from the episode), insert the link `L derived_from S@head` (`made_by_kind='rule'`,
accepted), and a version of S with `change='lifecycle'`, `lifecycle='consolidated'` (the one
lifecycle an agent may set). The Consolidator only supplies the text; the server does the writes.

Why not a move (`UPDATE ... SET layer`):
- **Permissions**: a grant on the inbox is not a grant on "Health"; moving text changes who can
  read it without anyone deciding that.
- **Different constraints**: long needs valid time and drops `expires_at`; core needs a person.
- **Trust resets**: a consolidated statement is a new claim (an inference over the episode), so it
  starts `proposed` with `origin='consolidated'`, even if the capture was approved.
- **Episodic vs semantic**: the verbatim episode and the gist both survive (psych finding 5);
  `derived_from` keeps the gist tied to its source, as VISION demands of summaries.
- **Lineage**: the derived entry's independent sources are the source's, not new ones.

Why not a copy without a link: duplicates, and lost justification.

Within one layer, **refiling** (inbox → another short memory; long "general" → long "health")
is a new version with `change='refile'` and a new `memory_id`; same id, history kept. The
grant change is explicit in the audit log. Agents may refile only non-approved entries.

Promotion to core is the same as consolidation, with a person as writer (`ev_core_is_human`).
Reconsolidation (psych finding 8): when a used entry is corrected, it is a new version with a
`change_note`, never an in-place fix; recall itself never edits.

---

## 8. Provenance, evidence and lineage

```sql
CREATE TABLE episodes (           -- immutable raw input: a chat, a report, a page, an import file
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  memory_id     uuid NOT NULL,    -- usually a short memory; grants apply
  origin_key    text NOT NULL CHECK (char_length(origin_key) <= 500),
      -- canonical identity of the ORIGINAL source, for counting independent sources:
      -- 'url:<normalized>', 'person:<user id>', 'doc:<sha256>', 'chat:<client>/<conversation>',
      -- 'ci:<provider>/<run>', 'commit:<remote>@<sha>'
  episode_kind  text NOT NULL CHECK (episode_kind IN ('conversation', 'report', 'web_page',
                  'import_file', 'voice_note', 'ci_run', 'commit', 'meeting', 'other')),
  title         text NOT NULL CHECK (char_length(title) <= 200),
  content       text CHECK (octet_length(content) <= 1048576),
  content_ref   text,             -- Blob URL for large files; text is extracted into content
  content_hash  bytea NOT NULL,
  occurred_period tstzrange,      -- when it happened (valid time)
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  source        entry_source NOT NULL,
  captured_by_kind author_kind NOT NULL,
  captured_by   text NOT NULL,
  on_behalf_of  text NOT NULL,
  capture_context jsonb,
  quarantined_because text,
  redacted_at   timestamptz,
  CONSTRAINT episodes_in_memory_fk FOREIGN KEY (memory_id, workspace_id) REFERENCES memories(id, workspace_id),
  CONSTRAINT episodes_id_ws_unique UNIQUE (id, workspace_id),
  CONSTRAINT episodes_has_content CHECK (content IS NOT NULL OR content_ref IS NOT NULL)
);
CREATE INDEX episodes_origin_idx ON episodes (workspace_id, origin_key);
CREATE INDEX episodes_memory_idx ON episodes (memory_id, recorded_at DESC);
-- append-only trigger as for entry_versions (redact path only)

CREATE TABLE entry_evidence (
  entry_id      uuid NOT NULL,
  version_no    integer NOT NULL,
  ord           smallint NOT NULL CHECK (ord BETWEEN 0 AND 49),
  workspace_id  uuid NOT NULL,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('episode', 'entry', 'url', 'commit',
                  'ci_run', 'test', 'file', 'person')),
  episode_id    uuid,
  cited_entry_id uuid,
  cited_version integer,
  ref           text CHECK (char_length(ref) <= 1000),   -- url, path@commit, run id
  origin_key    text,          -- lineage root for non-entry evidence (same keys as episodes)
  observed_at   timestamptz,   -- when the evidence held (test run time, commit time)
  note          text CHECK (char_length(note) <= 300),
  PRIMARY KEY (entry_id, version_no, ord),
  FOREIGN KEY (entry_id, version_no) REFERENCES entry_versions(entry_id, version_no),
  FOREIGN KEY (episode_id, workspace_id) REFERENCES episodes(id, workspace_id),
  FOREIGN KEY (cited_entry_id, cited_version) REFERENCES entry_versions(entry_id, version_no),
  CONSTRAINT evidence_target CHECK (
       (evidence_kind = 'episode' AND episode_id IS NOT NULL AND cited_entry_id IS NULL)
    OR (evidence_kind = 'entry'   AND cited_entry_id IS NOT NULL AND cited_version IS NOT NULL AND episode_id IS NULL)
    OR (evidence_kind NOT IN ('episode', 'entry') AND ref IS NOT NULL AND origin_key IS NOT NULL)),
  CONSTRAINT evidence_entry_has_no_root CHECK (evidence_kind <> 'entry' OR origin_key IS NULL)
);
CREATE INDEX entry_evidence_cited_idx  ON entry_evidence (cited_entry_id) WHERE cited_entry_id IS NOT NULL;
CREATE INDEX entry_evidence_episode_idx ON entry_evidence (episode_id) WHERE episode_id IS NOT NULL;
-- append-only trigger (forget path only)
```

Provenance per version, in one place:

| Question | Column |
|---|---|
| Through which channel did the text arrive? | `source` |
| Is it said, observed, inferred, consolidated, imported? | `origin` |
| Who wrote the text? | `author_kind`, `author` (carried forward when text is unchanged) |
| Who made this change (approve, close, refile)? | `changed_by_kind`, `changed_by` |
| For whom? | `on_behalf_of` (from the token, never the body: hard rule 2) |
| From which machine / client / claim? | `device_id`, `client_id`, `run_task_id` + `run_claim_seq` |
| On what evidence? | `entry_evidence` rows for this version |
| Who summarized, for which text? | `summary_by`, `summary_author`, `summary_for_version` |
| How sure was the writer at the time? | `confidence_at_encoding` (frozen) vs `confidence` (current) |

Evidence attaches to a *version*: re-approving changed text with old evidence is visible.
**Independent sources** = distinct root `origin_key`s reached through evidence and accepted
`derived_from` links (query 12.3). Three agents repeating one web page count as one.

---

## 9. Hooks for retrieval and sharing

### 9.1 Chunks and embeddings (blue-retrieval owns the detail)

```sql
CREATE TABLE entry_chunks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL,
  memory_id     uuid NOT NULL,       -- denormalized: ANN filtered by readable memories
  layer         memory_layer NOT NULL,
  entry_id      uuid NOT NULL,
  version_no    integer NOT NULL,
  chunk_kind    text NOT NULL CHECK (chunk_kind IN ('summary', 'question', 'body')),
  ord           smallint NOT NULL DEFAULT 0,
  text          text NOT NULL CHECK (char_length(text) <= 2000),
  model         text NOT NULL,       -- e.g. 'multilingual-e5-large@1'
  embedding     halfvec(1024),       -- dimension fixed per model; NULL until computed
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (entry_id, version_no) REFERENCES entry_versions(entry_id, version_no) ON DELETE CASCADE,
  FOREIGN KEY (memory_id, workspace_id, layer) REFERENCES memories(id, workspace_id, layer),
  UNIQUE (entry_id, version_no, chunk_kind, ord, model)
);
CREATE INDEX entry_chunks_pending_idx ON entry_chunks (created_at) WHERE embedding IS NULL;
-- HNSW (halfvec_cosine_ops) and iterative-scan settings: blue-retrieval.
```

Chunks are a derived cache, not truth: mutable, deletable, rebuilt on a model change. Only the
head version needs chunks; older versions' chunks may be dropped. `summary` is mandatory, so
there is always one `summary` chunk; `question` chunks hold "questions this answers" (psych
finding 5). `body` chunks are opt-in for long documents; requirement 1 forbids embedding the
full body as one vector, not chunking it. Refile updates `memory_id` on chunks in the same tx.

### 9.2 Permissions per memory or per layer (sharing designer owns the detail)

```sql
CREATE TABLE memory_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memory_id     uuid,                 -- one memory ...
  layer         memory_layer,         -- ... or every memory of a layer, present and future
  grantee_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('viewer', 'contributor', 'editor')),
  granted_by    text NOT NULL,        -- always the owner (a person)
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    text,
  FOREIGN KEY (memory_id, workspace_id) REFERENCES memories(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT grants_one_target CHECK ((memory_id IS NULL) <> (layer IS NULL)),
  CONSTRAINT grants_core_read_only CHECK (layer IS DISTINCT FROM 'core' OR role = 'viewer')
);
CREATE UNIQUE INDEX memory_grants_live_memory ON memory_grants (memory_id, grantee_user_id)
  WHERE revoked_at IS NULL AND memory_id IS NOT NULL;
CREATE UNIQUE INDEX memory_grants_live_layer ON memory_grants (workspace_id, layer, grantee_user_id)
  WHERE revoked_at IS NULL AND layer IS NOT NULL;
CREATE INDEX memory_grants_grantee_idx ON memory_grants (grantee_user_id) WHERE revoked_at IS NULL;
```

Every read resolves "readable memory ids" once (owner/`members` → all; else grants) and filters
`entries.memory_id = ANY(...)`, `entry_chunks.memory_id = ANY(...)`, and both link ends. That is
hard rule 4 lifted from workspace to memory. A per-memory grant on a core memory needs a check in
a trigger (it cannot be a CHECK across tables); flag for the sharing designer.

### 9.3 Use log (activation, spacing)

```sql
CREATE TABLE entry_uses (
  seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  entry_id   uuid NOT NULL REFERENCES entries(id),
  version_no integer NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  use_kind   text NOT NULL CHECK (use_kind IN ('cited', 'opened', 'acted_on', 'confirmed', 'shown')),
  counted    boolean GENERATED ALWAYS AS (use_kind <> 'shown') STORED,  -- only real uses strengthen
  actor      text NOT NULL,
  on_behalf_of text NOT NULL,
  task_id    uuid,
  cue        jsonb            -- the query / context that retrieved it (encoding-specificity research)
);
CREATE INDEX entry_uses_entry_idx ON entry_uses (entry_id, at DESC) WHERE counted;
-- append-only trigger. Activation caches (retrieval_strength etc.) belong to blue-retrieval.
```

---

## 10. Hard forget versus append-only

VISION Growth #5 needs a real forget. It is the single exception to append-only, and only
through one function:

```sql
CREATE FUNCTION forget_entry(p_entry uuid, p_actor text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('sky_brain.forget', 'on', true);
  UPDATE entry_versions SET title = '[forgotten]', body = '', summary = '[forgotten]',
         props = '{}', capture_context = NULL, change_note = NULL, redacted_at = now()
   WHERE entry_id = p_entry;
  DELETE FROM entry_chunks WHERE entry_id = p_entry;
  PERFORM set_config('sky_brain.head_sync', 'on', true);
  UPDATE entries SET title = '[forgotten]', summary = '[forgotten]', search = ''::tsvector,
         forgotten_at = now() WHERE id = p_entry;
  PERFORM set_config('sky_brain.head_sync', 'off', true);
  PERFORM set_config('sky_brain.forget', 'off', true);
  INSERT INTO audit_log (workspace_id, actor, action, target_id)
    SELECT workspace_id, p_actor, 'entry.forget', id FROM entries WHERE id = p_entry;
END $$;
```

The row, ids, provenance and links stay (so "something was here, forgotten on X by Y" is true);
text, summary and vectors go. Entries that `derived_from` it are queued for review: their text
may restate it. Episodes get the same treatment. Deleting a whole brain is `forget_workspace()`
(sets the GUC, deletes in dependency order); a plain `DELETE FROM workspaces` fails on the
`NO ACTION` FKs from history, which is intended.

---

## 11. Bridge to today's board, and the migration path

### 11.1 Working memory vs `goals` / `tasks`

Options considered:

| Option | Verdict |
|---|---|
| A. Working memory **links to a project**, 1:1; goals get `memory_id`; tasks inherit via goal | **Chosen.** No change to claims, leases, `claim_seq`, per-project advisory lock, run tokens (scoped to project), or D20's "approved by its own person". |
| B. Working memory **owns** goals; drop `goals.project_id` | Rewrites the board and run tokens; breaks D20 tests. Gains nothing a plain project can't give. |
| C. One working memory **per goal** | Too many containers; sharing per goal is too fine; scratch shared across a project's goals (plans, rules) has no home. Goal scope is already `entries.goal_id`. |
| D. Board tables become entries | Loses the typed lease FSM; tasks are not statements about the world. |

Goals and tasks stay their own tables (they are a state machine, not knowledge). The working
memory adds: a sharable container, scratch entries scoped by `goal_id`/`task_id`, resume notes,
and a home for findings that the Consolidator later proposes into long memory.

```sql
ALTER TABLE goals ADD COLUMN memory_id uuid;
ALTER TABLE goals ADD COLUMN memory_layer memory_layer NOT NULL DEFAULT 'working'
  CHECK (memory_layer = 'working');
-- backfill (11.2 M2), then:
ALTER TABLE goals ALTER COLUMN memory_id SET NOT NULL;
ALTER TABLE goals ADD CONSTRAINT goals_working_memory_fk
  FOREIGN KEY (memory_id, project_id, memory_layer) REFERENCES memories(id, project_id, layer);
CREATE INDEX goals_memory_idx ON goals (memory_id, status);
```

The composite FK proves the goal's memory is a working memory of the same project. Non-code
work ("plan the trip") gets a project row without a `git_remote` (already allowed) and its own
working memory. When a goal is done or cancelled, the server sets `expires_at = now() + 14 days`
on its scratch entries; the Consolidator proposes 0–3 lessons into long memory from them before
they fade (BUILD-PLAN step 2), and a released task's `resume_note` stays until the goal closes.
`tasks.context_refs` (text[]) can keep holding entry ids; later a `task_context(task_id,
entry_id, version_no)` table pins the exact versions the packet used (BUILD-PLAN: "stored for
audit").

### 11.2 Ordered migrations (each ships and runs before the next)

| Step | Migration | Risk |
|---|---|---|
| M1 | Enums, `item_types` + seed, `workspaces.owner_user_id` backfill + unique, `memories`, guard + deferred core trigger. Backfill per workspace: core, `inbox` (short, 30 d), `general` (long); one working memory per existing project. `onSignIn` and project creation create them. | Additive. Deferred trigger only fires on new workspaces. |
| M2 | `goals.memory_id` + `memory_layer`, backfill from project → working memory, NOT NULL, FK. Goal create sets it. | One UPDATE; board unchanged. |
| M3 | `ALTER TABLE entries RENAME TO entries_legacy` (and its constraints/indexes). Create new `entries`, `entry_versions`, triggers, `entry_evidence`, `episodes`, `entry_links`. Copy legacy rows (11.3). Reuse `entries_seq`. Rewrite `entries-view.ts` and the shared zod `Entry`. Ship entries API + MCP `capture/search/get` on the new shape (BUILD-PLAN step 1). | No API reads entries today, so nothing live breaks. `pg_trgm` must be enabled. |
| M4 | `entry_uses`; `task_context`. | Additive. |
| M5 | `entry_chunks` (BUILD-PLAN step 4). | Additive; backfill embeddings async. |
| M6 | `memory_grants` + resolver; invites can target a memory/layer (BUILD-PLAN step 8). | Read path change: every query filtered by readable memories; needs refused-case tests. |
| M7 | Drop `entries_legacy`, old `entry_kind`/`entry_status` enums, after one release. | — |

### 11.3 Mapping legacy `entries` rows

| Legacy | New |
|---|---|
| `project_id IS NULL` (workspace scope), kind `rule` or approved `decision` | core memory, `item_type` `standing_rule`, author human (agents could never write there) |
| other workspace-scope rows | `general` long memory |
| `project_id` set | a long memory per project (`proj-<slug>`, `project_id` set), created on demand; `feature_id` kept |
| kind `rule` / `decision` / `claim` / `question` / `answer` / `artifact` / `lesson` / `note` | (kind, item_type) = (decision, rule) / (decision, decision_record) / (hypothesis, note) / (NULL, question) / (fact if human else hypothesis, answer) / (fact, artifact) / (hypothesis, lesson) / (fact if human else hypothesis, note) |
| status `approved` / `proposed` / `quarantined` | trust same, lifecycle `active` |
| `superseded` / `rejected` | trust approved / proposed, lifecycle `superseded` / `rejected` |
| `open` / `answered` | question: trust per author, lifecycle `active`; answered = has an `answers` link |
| `expired` | lifecycle `active`, keep `expires_at` (expiry stays a read-time rule) |
| `supersedes` | `entry_links` relation `supersedes`, pinned to v1, `made_by_kind='rule'`, accepted |
| `reply_to` | `entry_links` relation `answers` |
| `refs` that are entry ids | `related` links (rule, accepted); other refs → `entry_evidence` (`url`/`commit`) |
| `created_at` | `recorded_at` of v1; `valid_period = tstzrange(created_at, NULL)` for long facts/decisions |
| `summary` | fallback (`title — first chunk`), `needs_summary = true` |

Long memories cannot hold an `expires_at`, so legacy project-scope claims with an expiry become
`review_due_at` instead.

---

## 12. Queries the schema must make cheap

```sql
-- 12.2 As-of: what did the brain believe at :t_recorded about the world at :t_valid?
SELECT * FROM (
  SELECT DISTINCT ON (v.entry_id) v.*
  FROM entry_versions v
  WHERE v.workspace_id = :ws AND v.memory_id = ANY(:readable) AND v.recorded_at <= :t_recorded
  ORDER BY v.entry_id, v.version_no DESC) h
WHERE h.lifecycle = 'active' AND (h.valid_period IS NULL OR h.valid_period @> :t_valid::timestamptz);

-- 12.3 Independent sources behind an entry (lineage through derived_from and entry evidence)
WITH RECURSIVE up(entry_id, version_no, depth) AS (
  SELECT :id::uuid, :v, 0
  UNION
  SELECT n.entry_id, n.version_no, u.depth + 1      -- one recursive reference (Postgres rule)
  FROM up u CROSS JOIN LATERAL (
    SELECT x.to_entry, x.to_version FROM entry_links x
     WHERE x.from_entry = u.entry_id AND x.relation = 'derived_from'
       AND x.status = 'accepted' AND x.ended_at IS NULL
    UNION ALL
    SELECT ev.cited_entry_id, ev.cited_version FROM entry_evidence ev
     WHERE ev.entry_id = u.entry_id AND ev.version_no = u.version_no AND ev.evidence_kind = 'entry'
  ) n(entry_id, version_no)
  WHERE u.depth < 8)
SELECT count(DISTINCT coalesce(ep.origin_key, ev.origin_key)) AS independent_sources
FROM up JOIN entry_evidence ev ON ev.entry_id = up.entry_id AND ev.version_no = up.version_no
LEFT JOIN episodes ep ON ep.id = ev.episode_id
WHERE ev.evidence_kind <> 'entry';

-- 12.4 Needs review: entries derived from an older version of :id
SELECT x.from_entry FROM entry_links x JOIN entries e ON e.id = x.to_entry
WHERE x.to_entry = :id AND x.relation = 'derived_from' AND x.ended_at IS NULL
  AND x.to_version < e.head_version;

-- 12.5 Core packet: memories.layer='core' AND trust='approved' AND lifecycle='active'
--      ORDER BY core_rank; the app trims summaries to token_budget.
```

Note on 12.2: as-of uses the version's `memory_id` and `lifecycle`; whether a viewer granted
*today* may see *past* placements is a sharing question (my default: filter by today's grants on
the version's `memory_id`).

---

## 13. Other alternatives rejected

Beyond those argued inline (layer placement 3, head cache 4, moves 7, board options 11.1):
separate tables per layer (consolidation becomes cross-table copies, links need polymorphic FKs,
search must `UNION`); core as `memory_id IS NULL` (no place for caps, budget, grants); a new
`items` table beside `entries` (D21 says extend `entries`, and it has no API yet);
`valid_from`/`valid_to` columns or temporal extensions (`tstzrange` gives `@>`, GiST and
non-empty checks, and needs nothing Nanogres may lack); `use_count`/`last_used` on the row (an
in-place edit per read, no spacing data); an embedding column on the entry (embeds the body,
couples model changes to the truth table); `members` as the sharing unit (workspace-wide by
construction).

---

## 14. Open points for the red team and the owner

1. **Steward re-summaries of approved entries**: allowed (content hash unchanged, trust
   unchanged), but the summary is what gets embedded and what the core packet would show. Is a
   steward-written summary of an approved item acceptable, or should the packet fall back to the
   writer's summary until a person keeps the new one? (Core is safe: human-only.)
2. **Questions have no kind** (D22 lists only statement kinds). Allowed via `kind IS NULL` only for
   `item_type='question'`. D22 should say so explicitly.
3. **Collaborator writes into the owner's brain**: `on_behalf_of` is the collaborator, the brain
   is the owner's. "All of it belongs to one user" (req. 4) holds by `workspace_id`; the owner's
   forget can erase a collaborator's contributions. Intended?
4. **Core cap** (60 by default, ≤ 500) and `token_budget`: numbers to tune with the benchmark.
5. **Cross-brain links** are not modelled (refs only). If two people share a long memory and want
   links into each other's brains, that is a new decision.
6. **Head cache trust**: correctness depends on the triggers. Tests needed for every refused path:
   direct UPDATE of head columns, stale version, agent approve, agent kind change, agent version of
   approved, agent write to core, layer change, core delete, workspace without core, observation
   without evidence, working scope on a non-working entry.
7. **`ON DELETE SET NULL (project_id)`** needs PG15+; PGlite (dev) must support it too, or fall
   back to `RESTRICT` plus app logic.
8. **Hebrew search**: `simple` tsvector + trigram on title. Body trigram is left to blue-retrieval
   (size cost).
