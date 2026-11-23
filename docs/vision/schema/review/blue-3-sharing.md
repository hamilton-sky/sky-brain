# Blue 3: sharing, invitations and permissions

Lens: who may see and change which memory, how people are invited, how agents act, and how the
database enforces it. Written against the repo as it is on 23 Nov 2026 (`workspaces`, `members`,
`invites`, `resolveScope`, `memberRole`, `effectiveRole`, run tokens, `onSignIn`).

Assumed from the data-model member (only the columns this design depends on):

```sql
-- memories: the container. One core per owner, many of the other layers.
memories(id uuid PK, owner_id text NOT NULL, layer memory_layer NOT NULL  -- 'core'|'long'|'short'|'working'
         , name text, description text, archived_at timestamptz, created_at timestamptz)
-- entries (and entry versions, chunks/summaries with embeddings) carry memory_id and owner_id.
-- entry_links(from_id, to_id, relation, ...).
```

If the data-model design names these differently, the SQL below maps one to one.

---

## 1. Decisions in one screen

| # | Decision | Short reason |
|---|---|---|
| S1 | **The unit of sharing is one memory.** No layer-wide grants, no tag grants. "Share a layer" in the UI writes one grant per memory that exists now. | Layers are lifecycle stages, not topics. A layer grant would make consolidation (short to long) a sharing act, and would share memories created later without anyone deciding to. |
| S2 | **Core memory is never granted.** The owner may mark single core entries as *profile*; profile entries are readable, read-only, by people who hold an accepted grant on any of the owner's memories. | Core holds identity and standing rules for the owner's own agents. Sharing it whole is never the intent; a small "about me" slice is. |
| S3 | **Roles:** `viewer` < `contributor` < `editor` < `admin`, plus the implicit `owner`, who never has a grant row. | Matches D22 (only people raise trust) and the roadmap's commenter role; `contributor` is the commenter-plus-propose role. |
| S4 | **One table, `memory_grants`**, append-only in spirit: a role change is revoke plus new row. Email invites are rows with no user id yet. Grants take effect only after the grantee accepts. | History for free; one place to check; acceptance stops someone from pushing content (and prompt injection) into another person's agents. |
| S5 | **Agents get the intersection:** person's role on that memory, capped at `contributor` for writes, cut to the token's memory set, cut again to shared memories the person opted into for agent context. | Hard rule 3 unchanged; another person's agent can do only what that person can, and less. |
| S6 | **Information may not flow to a wider audience without a person.** A derived entry (summary, digest, consolidation, link, move) may be written into memory M only if every reader of M can read every source. Agents are refused; the owner is warned and must confirm. | This is the one rule that covers links, summaries, digests, consolidation and embeddings at once. |
| S7 | **Enforcement: both layers, with a clean split.** Postgres RLS enforces the read boundary (which memories a person can see) on every content table. The app enforces the rest (roles, trust, agent caps, flow rule) through one `resolveMemory()` that replaces `resolveScope()`. | A forgotten filter in a new query returns nothing instead of leaking. RLS is cheap here because the predicate is one array check per row. |
| S8 | **Every grant change writes its own audit row from a database trigger**, so no code path can skip it. | Hard rule: grant changes audited. |
| S9 | **`workspaces`/`members`/`invites` are retired.** The workspace becomes the owner; members become grants on memories; invites become pending grants. | D17 already made one workspace per person, so the workspace adds nothing once memories exist. |

---

## 2. Grant target: memory, not layer (S1)

The owner asked for invites "to a specific memory, or a layer". I recommend grants on memories
only, and a UI action that covers the layer case without the hazards.

**Why a layer-wide grant is wrong as a stored rule:**

1. **Layers are stages in time, not subjects.** An entry moves short to long when it is
   consolidated, and working entries become long-term lessons. If Dana holds "all my short-term",
   a note becomes invisible to her the day it is consolidated; if she holds "all my long-term",
   private short-term notes become visible to her the day they are consolidated. Sharing would
   change because memory aged. Nobody would predict that.
2. **Future memories would be shared silently.** "All my long-term memories" includes the
   "Health" long-term memory the owner makes next month. A grant must name what it shares at the
   moment it is given.
3. **"All my long-term memories about work" is a topic.** Topics are exactly what a memory
   container is for: the owner makes a long-term memory called "Work" (and a working memory
   "Work board", maybe a short-term "Work inbox") and shares those.

**Why not grants on tags instead:** tags are cheap and mutable, and the Librarian (an agent)
suggests them. A tag grant would make tagging a sharing act, so an agent could share content by
tagging it. Hard rule 3 forbids that path.

**What the UI offers instead:**

- *Share several memories at once*: pick memories (or "all my current long-term memories") and
  one person and role. The server writes one grant row per memory, in one transaction, and
  lists them before confirming.
- *When a new memory is made*: "Share with the same people as Work?" One click writes the rows.
  Never automatic.
- A later `memory_groups` table (a named, owner-curated set) is possible, but adding a memory to
  a group must itself count as a grant change (audited, confirmed). Not in v1.

---

## 3. Core memory (S2)

- `memory_grants` cannot point at a core memory. This is declarative: the grant row carries the
  memory's layer through a composite foreign key and a `CHECK (layer <> 'core')` (SQL in §5).
- Core entries get one boolean, `in_profile` (default false). Only the owner sets it, never an
  agent, and setting it is audited (`profile.publish` / `profile.unpublish`).
- **Who reads the profile:** any person with an accepted, live grant on at least one of the
  owner's memories ("people I work with"). Read-only. No search hits, no links into it, no
  embedding neighbours outside it; it is served as a short fenced block, "About <owner>", in that
  person's context packet only when the packet also draws on one of the owner's memories.
- **Standing rules in core never travel.** A rule in A's core steers A's agents. B's agent
  working in A's shared memory follows rules that live *in that memory* (approved by A or an
  admin), never A's core rules, and never sees them unless A put them in the profile.
- Why not a "public profile memory" of its own: it would be a copy of core entries that drifts.
  A flag on the original entry has one source of truth; a new version of the entry keeps or
  drops the flag explicitly (the owner is asked).

---

## 4. Roles and the permission matrix (S3)

Ranks: `viewer` 1, `contributor` 2, `editor` 3, `admin` 4, `owner` 5 (implicit, from
`memories.owner_id`). The Postgres enum is declared in that order, so `role >= 'editor'` works.

### 4.1 Role x action (applies to long, short and working layers)

| Action | viewer | contributor | editor | admin | owner | agent for a person with role R |
|---|---|---|---|---|---|---|
| See the memory in "Shared with me" (name, description, owner) | yes | yes | yes | yes | yes | as R |
| See other grantees' names and roles | no | yes | yes | yes | yes | no |
| See grantees' emails, pending invites, expiries | no | no | no | yes | yes | no |
| Read approved and proposed entries, versions, links (both ends readable) | yes | yes | yes | yes | yes | as R, cut to token set and opt-in |
| Read quarantined entries | own only | own only | own only | yes | yes | never |
| Search and context packet over this memory | yes | yes | yes | yes | yes | only if the person opted the memory into agent context |
| Write a new entry (lands `proposed`) | no | yes | yes | yes | yes | if R >= contributor (always `proposed`) |
| Write a new entry as `approved` | no | no | yes | yes | yes | never |
| Answer a question, comment | no | yes | yes | yes | yes | if R >= contributor and the asker allowed agent answers |
| Supersede own proposed entry (new version) | no | yes | yes | yes | yes | if R >= contributor (`proposed`) |
| Supersede anyone's entry (new version) | no | no | yes | yes | yes | proposes only, if R >= contributor |
| Approve or reject a proposed entry | no | no | yes | yes | yes | never |
| Write or approve a memory rule (`rule` kind, scoped to this memory) | no | no | no | yes | yes | never |
| Release quarantine | no | no | no | yes | yes | never |
| Create a link from an entry here (needs read on the target) | no | yes | yes | yes | yes | proposes, if R >= contributor |
| Copy or move an entry out to another memory | readers only, flow rule §7 | same | same | same | owner may confirm a wider audience | flow rule, refused if wider |
| Invite or change a viewer, contributor or editor | no | no | no | yes | yes | never |
| Invite or change an admin | no | no | no | no | yes | never |
| Revoke a grant | own (leave) | own | own | below admin, any | any | never |
| Rename, describe the memory | no | no | no | yes | yes | never |
| Archive, delete (forget) the memory; real deletion of an entry | no | no | no | no | yes | never |
| Export the memory (bulk read) | yes, audited | yes, audited | yes, audited | yes, audited | yes | as R, audited |
| Read the memory's audit trail | own grant rows | own grant rows | own grant rows | grant rows of the memory | all | never |

Notes:

- **Contributor is new.** It is the roadmap's "commenter" plus the right to propose. A human
  contributor's writes land `proposed`, like an agent's: it is not their brain, so an editor,
  admin or owner decides.
- **Export is allowed to every reader** and audited. Blocking it would be theatre: a viewer can
  read every entry already. The audit row is the real control.
- **Grants made by an admin stay when that admin is revoked.** The owner gets a filter "grants
  made by Dana" to review them.

### 4.2 Layer-specific rules

| Layer | Grantable | Specific rules |
|---|---|---|
| core | **never** | Owner only. `in_profile` entries are readable, read-only, by people with any accepted live grant from the owner (§3). Agents of other people never write here. |
| long | yes | Default target for sharing knowledge. Flow rule applies to consolidation into it. |
| short | yes | Normally private (inbox). Sharing suits a shared inbox (family, a meeting). Fading/decay signals (use count, last used) are per reader, see §7.6. Consolidation from a shared short memory into the owner's private long memory is always allowed (narrower audience). |
| working | yes | The board. Create goal (draft): contributor+. Approve goal: editor+, human only. Claim, renew, release, report a task: contributor+ (and, by D20, a device runs without confirmation only tasks from goals **its own person** approved, so Dana's device runs Dana-approved goals in Shammai's board, never Shammai-approved ones unless Dana also approves). Cancel goal: editor+. |

---

## 5. SQL

Postgres 16+, matching the existing migrations (text user ids from Better Auth, `timestamptz`,
`gen_random_uuid()`).

### 5.1 Types and the grant table

```sql
-- Declaration order is the rank: comparisons and max() use it.
CREATE TYPE access_role AS ENUM ('viewer', 'contributor', 'editor', 'admin', 'owner');

-- memories must expose (id, owner_id, layer) as a key so grants can carry all three.
ALTER TABLE memories ADD CONSTRAINT memories_id_owner_layer_key UNIQUE (id, owner_id, layer);

CREATE TABLE memory_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id         uuid NOT NULL,
  owner_id          text NOT NULL,                 -- copied from memories; FK keeps it honest
  layer             memory_layer NOT NULL,         -- copied from memories; FK keeps it honest
  grantee_user_id   text,                          -- null until an email invite is bound at sign-in
  grantee_email     text,                          -- lower-cased, as the inviter typed it
  role              access_role NOT NULL,
  granted_by        text NOT NULL,                 -- a person's user id; agents cannot grant
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  invite_expires_at timestamptz,                   -- an unbound email invite lapses after this
  bound_at          timestamptz,                   -- when grantee_user_id was filled from the email
  accepted_at       timestamptz,                   -- the grant is live only after this
  expires_at        timestamptz,                   -- optional end of access
  revoked_at        timestamptz,
  revoked_by        text,
  revoke_reason     text,

  CONSTRAINT memory_grants_memory_fk
    FOREIGN KEY (memory_id, owner_id, layer)
    REFERENCES memories (id, owner_id, layer) ON DELETE CASCADE,
  CONSTRAINT memory_grants_not_core      CHECK (layer <> 'core'),
  CONSTRAINT memory_grants_not_owner_role CHECK (role <> 'owner'),
  CONSTRAINT memory_grants_has_grantee   CHECK (grantee_user_id IS NOT NULL OR grantee_email IS NOT NULL),
  CONSTRAINT memory_grants_email_lower   CHECK (grantee_email IS NULL OR grantee_email = lower(grantee_email)),
  CONSTRAINT memory_grants_not_self      CHECK (grantee_user_id IS DISTINCT FROM owner_id),
  CONSTRAINT memory_grants_expiry_after  CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT memory_grants_accept_needs_user CHECK (accepted_at IS NULL OR grantee_user_id IS NOT NULL),
  CONSTRAINT memory_grants_revoke_pair   CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)
                                                AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT memory_grants_revoke_reason CHECK (revoke_reason IS NULL OR revoke_reason IN
      ('revoked', 'replaced', 'left', 'declined', 'invite_lapsed', 'memory_archived')),
  CONSTRAINT memory_grants_note_len      CHECK (note IS NULL OR length(note) <= 500)
);

-- At most one open grant per person per memory, and one open invite per email per memory.
CREATE UNIQUE INDEX memory_grants_one_open_user
  ON memory_grants (memory_id, grantee_user_id)
  WHERE revoked_at IS NULL AND grantee_user_id IS NOT NULL;
CREATE UNIQUE INDEX memory_grants_one_open_email
  ON memory_grants (memory_id, grantee_email)
  WHERE revoked_at IS NULL AND grantee_user_id IS NULL;

-- The hot path: "which memories can this person read".
CREATE INDEX memory_grants_live_by_grantee
  ON memory_grants (grantee_user_id, memory_id)
  INCLUDE (role, expires_at)
  WHERE revoked_at IS NULL AND accepted_at IS NOT NULL;
CREATE INDEX memory_grants_unbound_email
  ON memory_grants (grantee_email)
  WHERE grantee_user_id IS NULL AND revoked_at IS NULL;
CREATE INDEX memory_grants_by_memory ON memory_grants (memory_id) WHERE revoked_at IS NULL;

-- memories.layer never changes (a different layer is a different memory).
CREATE FUNCTION memories_layer_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layer <> OLD.layer OR NEW.owner_id <> OLD.owner_id THEN
    RAISE EXCEPTION 'a memory''s layer and owner never change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memories_layer_fixed BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_layer_fixed();
```

### 5.2 Grants change in only three ways

A grant row is never edited otherwise and never deleted (except by cascade when the owner truly
deletes the memory; the audit rows survive). Allowed transitions: bind (fill
`grantee_user_id` + `bound_at` once), accept (fill `accepted_at` once), revoke (fill the three
revoke columns once).

```sql
CREATE FUNCTION memory_grants_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only the cascade from a deleted memory may remove grants.
    IF EXISTS (SELECT 1 FROM memories WHERE id = OLD.memory_id) THEN
      RAISE EXCEPTION 'memory_grants rows are revoked, not deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW.id, NEW.memory_id, NEW.owner_id, NEW.layer, NEW.grantee_email, NEW.role,
      NEW.granted_by, NEW.note, NEW.created_at, NEW.invite_expires_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.memory_id, OLD.owner_id, OLD.layer, OLD.grantee_email, OLD.role,
      OLD.granted_by, OLD.note, OLD.created_at, OLD.invite_expires_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'a grant''s terms never change: revoke it and grant again' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.grantee_user_id IS NOT NULL AND NEW.grantee_user_id IS DISTINCT FROM OLD.grantee_user_id THEN
    RAISE EXCEPTION 'a bound grant cannot move to another person' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'accepted_at is written once' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked grant is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER memory_grants_guard BEFORE UPDATE OR DELETE ON memory_grants
  FOR EACH ROW EXECUTE FUNCTION memory_grants_guard();
```

### 5.3 Request context (who is asking)

Every request runs inside one transaction that first sets three transaction-local settings. A
missing setting means "nobody": every read policy returns no rows (fail closed).

```sql
CREATE FUNCTION app_person() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.person', true), '') $$;

CREATE FUNCTION app_actor_kind() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.actor_kind', true), ''), 'agent') $$;  -- unknown = least power

-- The memory set a run token, or a connector limit, narrows the request to. Null = no narrowing.
CREATE FUNCTION app_token_memories() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.token_memories', true), '')::uuid[] $$;

-- The actor string for audit rows ('human:<id>' or 'agent:<id>'), set with the others.
CREATE FUNCTION app_actor() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.actor', true), ''), 'system') $$;
```

### 5.4 The access functions (the single source of truth)

`SECURITY DEFINER`, owned by the table owner, so they read `memories` and `memory_grants`
without being filtered by those tables' own policies.

```sql
-- A person's role on one memory, ignoring token narrowing and agent caps (the app adds those).
CREATE FUNCTION memory_role(p_person text, p_memory uuid) RETURNS access_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
           WHEN m.owner_id = p_person THEN 'owner'::access_role
           ELSE (SELECT max(g.role) FROM memory_grants g
                  WHERE g.memory_id = m.id
                    AND g.grantee_user_id = p_person
                    AND g.revoked_at IS NULL
                    AND g.accepted_at IS NOT NULL
                    AND (g.expires_at IS NULL OR g.expires_at > now()))
         END
  FROM memories m
  WHERE m.id = p_memory
    AND (m.archived_at IS NULL OR m.owner_id = p_person)
$$;

-- Every memory the current request may read: own (core included) plus live accepted grants,
-- cut to the token's memory set when there is one.
CREATE FUNCTION app_readable_memories() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(x.id), '{}')
  FROM (
    SELECT m.id FROM memories m WHERE m.owner_id = app_person()
    UNION
    SELECT g.memory_id
      FROM memory_grants g JOIN memories m ON m.id = g.memory_id AND m.archived_at IS NULL
     WHERE g.grantee_user_id = app_person()
       AND g.revoked_at IS NULL AND g.accepted_at IS NOT NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())
  ) x
  WHERE app_token_memories() IS NULL OR x.id = ANY (app_token_memories())
$$;

-- Memories the request may write into: role >= contributor. Agents are capped by the app at
-- 'contributor' and by the trust triggers at 'proposed'; this set is the same for both.
CREATE FUNCTION app_writable_memories() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(x.id), '{}')
  FROM (
    SELECT m.id FROM memories m WHERE m.owner_id = app_person() AND m.archived_at IS NULL
    UNION
    SELECT g.memory_id
      FROM memory_grants g JOIN memories m ON m.id = g.memory_id AND m.archived_at IS NULL
     WHERE g.grantee_user_id = app_person()
       AND g.role >= 'contributor'
       AND g.revoked_at IS NULL AND g.accepted_at IS NOT NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())
  ) x
  WHERE app_token_memories() IS NULL OR x.id = ANY (app_token_memories())
$$;

-- Owners whose profile slice the request may read: those who granted this person a live,
-- accepted grant on a memory inside the token's set.
CREATE FUNCTION app_profile_owners() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT g.owner_id), '{}')
  FROM memory_grants g
  WHERE g.grantee_user_id = app_person()
    AND g.revoked_at IS NULL AND g.accepted_at IS NOT NULL
    AND (g.expires_at IS NULL OR g.expires_at > now())
    AND (app_token_memories() IS NULL OR g.memory_id = ANY (app_token_memories()))
$$;

-- The flow rule (§7): may content from p_sources be written into p_target without widening
-- its audience? True when every reader of the target can read every source.
CREATE FUNCTION flow_allowed(p_target uuid, p_sources uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH target_readers AS (
    SELECT owner_id AS person FROM memories WHERE id = p_target
    UNION
    SELECT grantee_user_id FROM memory_grants
     WHERE memory_id = p_target AND revoked_at IS NULL AND grantee_user_id IS NOT NULL
       AND (expires_at IS NULL OR expires_at > now())
     -- pending and not-yet-accepted grants count as readers: they may be accepted tomorrow
  )
  SELECT NOT EXISTS (
    SELECT 1 FROM target_readers r, unnest(p_sources) s(memory_id)
    WHERE s.memory_id <> p_target
      AND memory_role(r.person, s.memory_id) IS NULL
  )
  -- an unbound email invite on the target is an unknown reader: only target-internal sources pass
  AND (NOT EXISTS (SELECT 1 FROM memory_grants
                    WHERE memory_id = p_target AND revoked_at IS NULL AND grantee_user_id IS NULL)
       OR p_sources <@ ARRAY[p_target])
$$;
```

### 5.5 Row Level Security on content tables

The runtime connects (or `SET LOCAL ROLE`s, §8) as `sky_app`, which owns nothing. Migrations run
as the owner role. Content tables get `FORCE` as a second guard in case the runtime ever runs as
the owner by mistake. `memories` and `memory_grants` are not forced, so the `SECURITY DEFINER`
functions above (owned by the owner) can read them unfiltered.

```sql
CREATE ROLE sky_app NOLOGIN;
GRANT USAGE ON SCHEMA public TO sky_app;
GRANT SELECT, INSERT, UPDATE ON entries, entry_links, memories TO sky_app;  -- per table as the data model needs
GRANT SELECT ON memory_grants TO sky_app;          -- writes only through the functions in 5.6
GRANT SELECT, INSERT ON audit_log TO sky_app;      -- append-only trigger already blocks the rest
-- no DELETE on content tables for sky_app: real deletion goes through forget_* functions (owner only)

-- The `(SELECT f())` wrapper makes Postgres run f once per statement (an InitPlan), not per row.

ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries FORCE ROW LEVEL SECURITY;
CREATE POLICY entries_read ON entries FOR SELECT TO sky_app USING (
     memory_id = ANY ((SELECT app_readable_memories()))
  OR (in_profile AND owner_id = ANY ((SELECT app_profile_owners())))
);
CREATE POLICY entries_insert ON entries FOR INSERT TO sky_app WITH CHECK (
  memory_id = ANY ((SELECT app_writable_memories()))
  AND owner_id = (SELECT owner_id FROM memories WHERE id = memory_id)   -- denormalized copy is right
  AND (app_actor_kind() = 'human' OR trust IN ('proposed', 'quarantined'))  -- backstop for hard rule 3
);
CREATE POLICY entries_update ON entries FOR UPDATE TO sky_app
  USING (memory_id = ANY ((SELECT app_writable_memories())))
  WITH CHECK (memory_id = ANY ((SELECT app_writable_memories())));
-- (status/trust changes are further limited by the app and the data model's own triggers;
--  memory_id on an entry is immutable: a move is a new version in the target memory.)

-- Links store both ends' memory ids (filled and checked by composite FKs to entries(id, memory_id)),
-- so the policy needs no join. A link is visible only when both ends are.
ALTER TABLE entry_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_links FORCE ROW LEVEL SECURITY;
CREATE POLICY links_read ON entry_links FOR SELECT TO sky_app USING (
      from_memory_id = ANY ((SELECT app_readable_memories()))
  AND to_memory_id   = ANY ((SELECT app_readable_memories()))
);
CREATE POLICY links_insert ON entry_links FOR INSERT TO sky_app WITH CHECK (
      from_memory_id = ANY ((SELECT app_writable_memories()))
  AND to_memory_id   = ANY ((SELECT app_readable_memories()))
);

-- The same two policies (read / insert) go on every table that holds entry text or anything
-- computed from it: entry versions, chunks, summaries, embeddings, episode rows, digests.
-- Each such table carries memory_id. Example for a chunk table with the summary vector:
ALTER TABLE entry_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY chunks_read ON entry_chunks FOR SELECT TO sky_app
  USING (memory_id = ANY ((SELECT app_readable_memories())));

-- memories: you see your own, and those you hold a live accepted grant on.
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY memories_read ON memories FOR SELECT TO sky_app
  USING (id = ANY ((SELECT app_readable_memories())));
CREATE POLICY memories_insert ON memories FOR INSERT TO sky_app
  WITH CHECK (owner_id = app_person() AND app_actor_kind() = 'human');
CREATE POLICY memories_update ON memories FOR UPDATE TO sky_app
  USING (memory_role(app_person(), id) >= 'admin' AND app_actor_kind() = 'human');

-- memory_grants: a grantee sees their own rows (including pending invites bound to them);
-- the owner and admins see the memory's rows.
ALTER TABLE memory_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY grants_read ON memory_grants FOR SELECT TO sky_app USING (
     grantee_user_id = app_person()
  OR owner_id = app_person()
  OR memory_role(app_person(), memory_id) >= 'admin'
);

-- audit_log: the owner sees everything about their brain; a person sees rows about themselves.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_log FOR SELECT TO sky_app USING (
     owner_id = app_person()
  OR subject_user_id = app_person()
  OR (memory_id IS NOT NULL AND action LIKE 'grant.%'
      AND memory_role(app_person(), memory_id) >= 'admin')
);
CREATE POLICY audit_insert ON audit_log FOR INSERT TO sky_app WITH CHECK (true);
```

Quarantine visibility (author, admin, owner only) is **not** in RLS: it needs a per-row role
lookup and only matters on one small slice of rows. `resolveMemory()` adds the
`trust <> 'quarantined' OR author = me OR role >= admin` filter in the app.

### 5.6 Grant functions (the only write path to `memory_grants`)

```sql
CREATE FUNCTION grant_memory(p_memory uuid, p_user text, p_email text, p_role access_role,
                             p_expires timestamptz, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    text := app_person();
  v_mine  access_role := memory_role(v_me, p_memory);
  v_mem   memories%ROWTYPE;
  v_id    uuid;
BEGIN
  IF app_actor_kind() <> 'human' THEN
    RAISE EXCEPTION 'agents cannot grant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_mine IS NULL OR v_mine < 'admin' THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'no_data_found';   -- the API answers 404
  END IF;
  IF p_role >= 'admin' AND v_mine <> 'owner' THEN
    RAISE EXCEPTION 'only the owner grants admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT count(*) FROM memory_grants WHERE memory_id = p_memory AND revoked_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'too many open grants on this memory' USING ERRCODE = 'program_limit_exceeded';
  END IF;
  SELECT * INTO v_mem FROM memories WHERE id = p_memory;

  -- A role change is revoke + new row.
  UPDATE memory_grants
     SET revoked_at = now(), revoked_by = v_me, revoke_reason = 'replaced'
   WHERE memory_id = p_memory AND revoked_at IS NULL
     AND ((p_user IS NOT NULL AND grantee_user_id = p_user)
       OR (p_user IS NULL AND grantee_user_id IS NULL AND grantee_email = lower(p_email)));

  INSERT INTO memory_grants (memory_id, owner_id, layer, grantee_user_id, grantee_email, role,
                             granted_by, note, expires_at, invite_expires_at, bound_at)
  VALUES (p_memory, v_mem.owner_id, v_mem.layer, p_user, lower(p_email), p_role,
          v_me, p_note, p_expires,
          CASE WHEN p_user IS NULL THEN now() + interval '14 days' END,
          CASE WHEN p_user IS NOT NULL THEN now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION revoke_grant(p_grant uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me text := app_person();
  g    memory_grants%ROWTYPE;
  v_mine access_role;
BEGIN
  IF app_actor_kind() <> 'human' THEN
    RAISE EXCEPTION 'agents cannot revoke' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO g FROM memory_grants WHERE id = p_grant AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'no_data_found'; END IF;
  v_mine := memory_role(v_me, g.memory_id);
  IF g.grantee_user_id = v_me THEN
    p_reason := CASE WHEN g.accepted_at IS NULL THEN 'declined' ELSE 'left' END;
  ELSIF v_mine = 'owner' OR (v_mine = 'admin' AND g.role < 'admin') THEN
    p_reason := 'revoked';
  ELSE
    RAISE EXCEPTION 'not found' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE memory_grants SET revoked_at = now(), revoked_by = v_me, revoke_reason = p_reason
   WHERE id = p_grant;
END $$;

CREATE FUNCTION accept_grant(p_grant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_actor_kind() <> 'human' THEN
    RAISE EXCEPTION 'agents cannot accept' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE memory_grants SET accepted_at = now()
   WHERE id = p_grant AND grantee_user_id = app_person()
     AND revoked_at IS NULL AND accepted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'no_data_found'; END IF;
END $$;

-- Called from onSignIn with the verified email from the user row (never from a request).
CREATE FUNCTION bind_invites(p_user text, p_email text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE memory_grants
     SET revoked_at = now(), revoked_by = 'system', revoke_reason = 'invite_lapsed'
   WHERE grantee_email = lower(p_email) AND grantee_user_id IS NULL
     AND revoked_at IS NULL AND invite_expires_at <= now();
  UPDATE memory_grants
     SET grantee_user_id = p_user, bound_at = now()
   WHERE grantee_email = lower(p_email) AND grantee_user_id IS NULL
     AND revoked_at IS NULL AND invite_expires_at > now()
     AND owner_id <> p_user;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;   -- bound, not accepted: the person accepts in "Shared with you"
END $$;

REVOKE ALL ON FUNCTION grant_memory, revoke_grant, accept_grant, bind_invites FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grant_memory, revoke_grant, accept_grant TO sky_app;
-- bind_invites runs from onSignIn under the system context only.
```

### 5.7 Audit trigger

`audit_log` gains `owner_id text`, `memory_id uuid`, `subject_user_id text`, and its
`workspace_id` becomes nullable during the move (§9). The trigger writes the row, so no route
can forget it; the app adds extra rows (export, profile publish, flow overrides) itself.

```sql
ALTER TABLE audit_log
  ADD COLUMN owner_id text,
  ADD COLUMN memory_id uuid,
  ADD COLUMN subject_user_id text,
  ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX audit_log_owner_seq_idx  ON audit_log (owner_id, seq);
CREATE INDEX audit_log_memory_seq_idx ON audit_log (memory_id, seq) WHERE memory_id IS NOT NULL;

CREATE FUNCTION memory_grants_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text;
BEGIN
  v_action := CASE
    WHEN TG_OP = 'INSERT'                                            THEN 'grant.create'
    WHEN NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL       THEN 'grant.' || NEW.revoke_reason
    WHEN NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL     THEN 'grant.accept'
    WHEN NEW.grantee_user_id IS NOT NULL AND OLD.grantee_user_id IS NULL THEN 'grant.bind'
  END;
  INSERT INTO audit_log (workspace_id, owner_id, memory_id, subject_user_id, actor, action, target_id, details)
  VALUES (NULL, NEW.owner_id, NEW.memory_id, NEW.grantee_user_id, app_actor(), v_action, NEW.id,
          jsonb_build_object('role', NEW.role, 'layer', NEW.layer,
                             'email', NEW.grantee_email, 'expires_at', NEW.expires_at,
                             'granted_by', NEW.granted_by));
  RETURN NEW;
END $$;

CREATE TRIGGER memory_grants_audit AFTER INSERT OR UPDATE ON memory_grants
  FOR EACH ROW EXECUTE FUNCTION memory_grants_audit();
```

Audit actions (full list): `grant.create`, `grant.bind`, `grant.accept`, `grant.revoked`,
`grant.replaced`, `grant.left`, `grant.declined`, `grant.invite_lapsed`,
`grant.memory_archived`, `grant.expired` (written lazily by a daily job for grants whose
`expires_at` passed; access already stopped at that instant, the row is for the record),
`profile.publish`, `profile.unpublish`, `memory.export`, `memory.archive`, `memory.forget`,
`flow.override` (owner confirmed a wider audience, §7), `prefs.agent_context` (grantee opted a
shared memory in or out of agent context).

Email in `details` is the inviter's input and is already visible to that inviter; it is shown
to the owner and admins only (RLS above).

### 5.8 Grantee-side settings and token scoping

```sql
-- The grantee's own choices about a memory shared with them. Not part of the grant (immutable),
-- and not visible to the owner.
CREATE TABLE shared_memory_prefs (
  user_id           text NOT NULL,
  memory_id         uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  in_agent_context  boolean NOT NULL DEFAULT false,   -- opt-in: may my agents' packets draw on it?
  muted             boolean NOT NULL DEFAULT false,   -- hide from my Digest
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, memory_id)
);
ALTER TABLE shared_memory_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefs_own ON shared_memory_prefs FOR ALL TO sky_app
  USING (user_id = app_person()) WITH CHECK (user_id = app_person() AND app_actor_kind() = 'human');

-- Run tokens are bound to a set of memories instead of (workspace_id, project_id).
ALTER TABLE run_tokens
  ADD COLUMN memory_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT run_tokens_memory_count CHECK (cardinality(memory_ids) BETWEEN 1 AND 16);
-- role keeps its CHECK (editor|viewer) -> becomes (contributor|viewer): an agent never needs more.

-- Optional, phase 2: limit an OAuth connector (e.g. the claude.ai connector) to some memories.
CREATE TABLE connector_memory_limits (
  user_id    text NOT NULL,
  client_id  text NOT NULL,          -- oauth_client.client_id
  memory_ids uuid[] NOT NULL CHECK (cardinality(memory_ids) >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);
```

---

## 6. How agents act (S5)

An agent never holds rights of its own. Per request the server computes:

```
effective(agent, memory) =
    memory_role(person, memory)                       -- the person's grant (or owner)
  ∩ cap 'contributor' for writes, 'viewer'-level reads  -- hard rule 3: never approve, reject,
                                                         -- release, delete, write rules, grant
  ∩ memory ∈ token.memory_ids                         -- run token / connector limit, if any
  ∩ (memory owned by person OR prefs.in_agent_context) -- shared memories are opt-in for agents
```

In TypeScript this replaces `resolveScope` + `memberRole` + `effectiveRole`:

```ts
// scope/resolve-memory.ts
export interface ResolvedMemory {
  memoryId: string; ownerId: string; layer: Layer;
  role: AccessRole;          // the person's role (owner|admin|editor|contributor|viewer)
  effective: AccessRole;     // after agent cap and run-token cap
}

const RANK = { viewer: 1, contributor: 2, editor: 3, admin: 4, owner: 5 } as const;
const AGENT_CAP: AccessRole = "contributor";

export async function resolveMemory(tx: Tx, req: Request, actor: Actor, memoryId: string) {
  // RLS already hides memories the person cannot read; a miss is 404, as today.
  const [m] = await tx.select(...).from(memories).where(eq(memories.id, memoryId));
  if (!m) throw new HttpError(404, "not_found", "No such memory.");
  const role = await memoryRoleOf(tx, personOf(actor), memoryId);   // memory_role()
  if (!role) throw new HttpError(404, "not_found", "No such memory.");
  let effective = role;
  if (actor.kind === "agent") {
    if (m.ownerId !== personOf(actor) && !(await optedIn(tx, personOf(actor), memoryId)))
      throw new HttpError(404, "not_found", "No such memory.");
    effective = min(effective, AGENT_CAP);
  }
  const tokenRole = runContextOf(req)?.role;          // run token role still caps
  if (tokenRole) effective = min(effective, tokenRole);
  return { memoryId, ownerId: m.ownerId, layer: m.layer, role, effective };
}
```

Write checks then read `effective`, plus the existing trust rules (agent writes are `proposed`,
web or instruction-like text `quarantined`).

**Device and run tokens.**

- A device token (`sbd_`) stays per person and still only mints.
- Minting a run token names 1 to 16 memories. The mint checks the person can read each one now
  and refuses memories that the flow rule would make unsafe together (see "sealed runs", §7.4).
  The token's memory set goes into `app.token_memories`, so RLS narrows every query in that run.
- The grant is rechecked on **every request**, never only at mint: a 30-minute run token for a
  revoked grant stops working on its next call.
- `verbs` stays as today; the verb table gains the entries routes (`read`, `propose`, `link`).

**Another person's agent in a shared memory (B's agent in A's memory):**

- Context packet: entries from A's memory are fenced with their owner, e.g.
  `[memory "Kitchen remodel" · owner shammai · approved by shammai]`. "Approved" means approved by
  someone in that memory, never by B; the packet says so.
- Rules: only rules that live in A's memory apply, and only to work in A's memory. A's core
  rules never appear. B's core rules still steer B's agent.
- Prompt injection: A could fill a shared memory with text aimed at B's agents. Defences: B must
  accept the grant, B must opt the memory into agent context, A's entries are fenced as quoted
  data like everything else, and quarantine applies to text written into shared memories as it
  does to any write.
- Tasks: by D20 a device runs without confirmation only tasks from goals its own person
  approved. B's device in A's board therefore needs B to be editor+ and to approve the goal
  personally. This keeps "A cannot make B's machine run things" true.

---

## 7. Cross-memory concerns (S6)

### 7.1 The flow rule

> Content may be written into memory M only if every reader of M can already read every source
> it came from. Pending invites on M count as readers; an unbound email invite counts as an
> unknown reader, so only M-internal sources pass.

"Content" means any write that carries text or meaning from other entries: a summary, a digest,
a consolidated entry, a moved or copied entry, a link, an agent answer composed from a packet.
The server knows sources when the write carries lineage (`derived_from`, `refs`, link ends,
packet ids of the run). It checks `flow_allowed(target, sources)`:

- **Agent writes** that fail are refused (`409 flow_widens_audience`). This is the important
  case: a *proposed* entry in a shared memory is already visible to its viewers, so checking at
  approval is too late.
- **Owner writes** that fail show "This will let Dana and Eli read text from *Health*. Continue?"
  and, on yes, write a `flow.override` audit row.
- **Grantee writes** (editor, admin) that fail are refused: only the owner may widen an
  audience in the owner's brain.

Flowing into a narrower audience (shared to private) always passes. That is the normal
direction: the owner's Consolidator turns a shared short-term memory into private long-term
knowledge.

The rule is checked when a grant is *added*, too: before Dana is invited to M, the server counts
entries in M whose lineage includes memories Dana cannot read, and the owner sees "M holds 12
entries built from memories Dana cannot see. Share anyway?" This catches widening by granting,
not just by writing.

### 7.2 Links from a shared memory into a private one

- A link is visible only when **both** ends are readable (RLS `links_read`). The grantee sees
  nothing: not the target, not a placeholder, not the relation name, not a count. "There is a
  `contradicts` link to something private" already leaks.
- A link is a flow (it carries the target's existence and the relation) so creating a link from
  a shared memory to a private one is the owner's act, audited, and agents are refused. A link
  from a private memory to a shared entry is always fine.
- **Spreading activation** (graph walk for retrieval) must apply the filter at every hop, inside
  the recursive query, not on the final results. If activation passes through a hidden node, the
  ranking of visible nodes reveals that a hidden path exists. With RLS on `entry_links` this is
  automatic: the recursive CTE simply cannot see hidden edges.

### 7.3 Search across memories

- The readable set is computed once per statement (`app_readable_memories()` as an InitPlan) and
  applied by RLS, before ranking. Counts, facets, "N more results", snippets and highlights are
  computed from the filtered rows only.
- **Vector search with a filter:** HNSW scans the graph, then RLS drops rows. For a person who
  can read a small part of a large table, plain HNSW returns too few rows. Use pgvector 0.8's
  iterative scan (`SET LOCAL hnsw.iterative_scan = relaxed_order; SET LOCAL hnsw.max_scan_tuples
  = 20000`) and re-sort. When the readable set is small (say under 20k chunks, one cheap
  `count(*)` on a btree `(memory_id)` index), skip HNSW and do an exact scan with
  `ORDER BY embedding <=> $q` over `memory_id = ANY(...)`; at this product's size that is the
  common case and gives exact recall.
- Full-text search uses the same rows and the same RLS. (Language config is for the retrieval
  member; with Hebrew and English, `simple` plus trigram is safer than `english`.)

### 7.4 Summaries, digests, consolidation, and "sealed runs"

- **Digest** is built per reader at read time from that reader's readable set (minus muted
  memories). A stored digest belongs to one person and lives in that person's private space;
  it is never written into a shared memory.
- **Consolidator** runs as the owner's agent. Writing into a private memory: always allowed.
  Writing into a shared memory: only from sources the flow rule allows; it proposes, never
  approves (D22).
- **Sealed runs:** lineage cannot catch an agent that paraphrases private text into a shared
  memory without citing it. For runs the server mints (run tokens, the Consolidator), the mint
  picks a memory set where reads cannot widen writes: if the run writes into M, its readable set
  is cut to memories whose readers include all of M's readers. For an interactive Claude session
  over the connector this cannot be enforced (the model sees what the person sees); the packet
  labels every entry with its memory and audience, and the write tool refuses lineage that fails
  the flow rule. This is a stated, accepted gap.

### 7.5 Embeddings and other derived data

- A vector is content: embedding inversion recovers much of the input text. Every table holding
  vectors, summaries or chunks carries `memory_id` and gets the same RLS. Vectors are never
  returned by any API or written to logs.
- No cross-owner caches. An embedding cache keyed by text hash must be keyed by owner too, or a
  cache hit tells one person that another person's brain holds that exact text.
- Memory-level aggregates (centroids, topic clusters, "what this memory is about" vectors) are
  derived content of that memory only. A cross-memory aggregate is owner-private.
- "Forget" (real deletion, owner only) must remove the entry's versions, chunks, summary,
  vectors, links and any digest that quoted it. Audit rows keep ids and the action, not text.

### 7.6 Signals and side channels

- **Use counts and last-used** (forgetting curve, spacing) on an owner's entries must not move
  when a grantee reads them: it would tell the owner what Dana looked at and bend the owner's
  own recall towards Dana's interests. Keep `use_count`/`last_used` on the entry for the
  owner's own use, and keep grantees' signals in a per-person table `(person, entry_id,
  use_count, last_used)`. (For the retrieval and lifecycle members.)
- **Existence:** every miss is 404, as today (`resolveScope`). An id of a memory or entry you
  cannot read, and one that does not exist, give the same answer.
- **Memory names are visible to grantees.** The share dialog says so.

### 7.7 Moving an entry between memories

`memory_id` on an entry is immutable. A move is a new version in the target memory (append-only,
D21), with `supersedes` pointing at the old one. It needs write on the target, read on the
source, and the flow rule. The superseded original stays in the source memory, readable by the
source's readers only.

---

## 8. Enforcement: RLS plus app checks (S7)

### 8.1 The choice

| | App-level filter only | RLS only | **RLS for reads + app for actions (chosen)** |
|---|---|---|---|
| A new query that forgets the filter | leaks | returns nothing | returns nothing |
| 404 vs 403, role caps, agent caps, trust | easy | awkward (errors are generic) | app does it |
| Cost per query | none | one array check per row | same |
| Fits Drizzle | yes | yes, with a per-request tx | yes |
| Fits PgBouncer transaction mode / Vercel | yes | yes, if settings are `SET LOCAL` | yes |
| Testable in PGlite | yes | yes, with `SET LOCAL ROLE` (superuser bypasses RLS) | yes |

Hard rule 4 today depends on every author remembering to join `members` and on a test per query.
Sharing multiplies the number of queries that cross memories (search, links, graph walks,
digests, packets). RLS turns the common mistake (a missing filter) into an empty result that the
author's own test catches, instead of a leak no test was written for. The app keeps everything
RLS is bad at: exact errors, role ranks, agent caps, the flow rule, quarantine visibility.

### 8.2 How it is wired

```ts
// db/with-actor.ts: the only way route code reaches the database.
export async function withActor<T>(db: Db, req: Request, actor: Actor,
                                   fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tokenMemories = runContextOf(req)?.memoryIds ?? connectorLimitOf(req);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE sky_app`);   // in every env: tests run as superuser
    await tx.execute(sql`
      select set_config('app.person',         ${personOf(actor)}, true),
             set_config('app.actor_kind',     ${actor.kind}, true),
             set_config('app.actor',          ${auditActor(actor).actor}, true),
             set_config('app.token_memories', ${tokenMemories ? `{${tokenMemories.join(",")}}` : ""}, true)`);
    return fn(tx);
  });
}
```

- `is_local = true` everywhere, so nothing outlives the transaction on a pooled connection
  (the server already relies on transaction-scoped locks for PgBouncer, see `onSignIn`).
- The pooled `db` is not importable from route modules (an ESLint `no-restricted-imports`
  rule); only `withActor` and the system paths (migrations, `onSignIn`, the expiry job) use it.
- No setting means `app_person()` is null: every policy returns nothing. A route that forgot
  `withActor` fails its own tests instead of leaking.
- `createPostgresDb` already supports `SET ROLE`; production runs migrations as the Nanogres
  owner role and requests as `sky_app`. To check: that the Nanogres login role may be granted
  membership in `sky_app` (needed for `SET ROLE`).
- System jobs (expiry audit rows, the Consolidator) run through `withActor` too, as the owner's
  agent. Nothing reads content as "system".

### 8.3 Tests (hard rule 4, extended)

Each in PGlite, through `withActor`, allowed case and refused case:

1. Stranger cannot read a memory, its entries, links, chunks, or grants (404 and empty lists).
2. Viewer reads; cannot write; cannot see quarantined entries of others.
3. Contributor writes land `proposed` even when a human writes `approved`.
4. Editor approves; cannot write a rule; cannot grant.
5. Admin grants editor, cannot grant admin, cannot revoke another admin.
6. Owner cannot grant on core (constraint), `in_profile` entry visible to a grantee, other core
   entries not.
7. Pending (not accepted) grant gives nothing; expired grant gives nothing at `expires_at`;
   revoked grant gives nothing on the next request, including through a live run token.
8. Agent for an editor cannot approve; agent for a grantee cannot read a shared memory until
   the person opts it into agent context.
9. Run token limited to memory A cannot read memory B of the same person.
10. Link from shared to private is invisible to the grantee in list, get and graph walk.
11. Search returns no hidden rows and no hidden counts; vector search through the exact path and
    the HNSW path give the same visible set.
12. Agent write with lineage from a private memory into a shared memory is refused (409).
13. A route that skips `withActor` returns nothing (guard test for the fail-closed default).
14. Every grant transition writes exactly one audit row; `UPDATE` of a grant's role raises.
15. Invite bound only to the verified email of the signed-in user, never to an email in a
    request body; an email invite for the owner's own email never binds.

---

## 9. Invitations and revocation in practice

### 9.1 Invite flow

1. Owner (or admin, for roles below admin) picks a memory, enters an email or picks a known
   person, a role, an optional end date.
2. If a user with that email exists, the grant is bound at once (pending acceptance). Otherwise
   it is an email-only row that lapses after 14 days.
3. sky-brain cannot let anyone in. `mayEnter` stays the whole gate (D17): the invitee also needs
   the sky-brain product in Perminister. The share dialog says "Dana also needs access to
   sky-brain in Perminister" and links there. sky-brain sends no email in v1 (it must not become
   a mail relay); the owner tells the person. No token or code goes in the URL (hard rule 5);
   binding is by verified email at sign-in.
4. `onSignIn` calls `bind_invites(user_id, user.email)` with the email from the `user` row.
   Requirement on Perminister: the email it returns is verified. If it is not, an attacker who
   registers someone else's address inherits their invites; this must be confirmed with
   Perminister before invites by email ship.
5. The invitee sees "Shared with you: *Kitchen remodel* from shammai, as contributor" and
   accepts or declines. Accepting makes it live. Opting it into agent context is a separate
   switch, off by default.

Limits: 50 open grants per memory, 30 new invites per owner per day (rate limiter bucket), one
open grant per person per memory.

### 9.2 Revocation

- **Takes effect on the next request.** Nothing caches grants across requests; run tokens are
  rechecked each call.
- **Work in progress:** task claims held by the revoked person's devices in that memory are
  released (`task_events` kind `reclaimed`, reason `grant_revoked`), so the board does not wait
  for a lease to run out.
- **What the grantee keeps:** what they already read. Packets already delivered, copies they
  made into their own memories, agent transcripts: none of that can be recalled. The revoke
  dialog says so plainly.
- **What stays in the memory:** entries the grantee wrote. They belong to the owner (requirement
  4); authorship (`author`, `on_behalf_of`) is kept. Their proposed entries stay proposed for
  the owner to decide.
- **Links the grantee made** from their own memories into the owner's: they stay in the
  grantee's memory and become invisible to everyone (neither side can read both ends).
- **Grantee prefs** for that memory are deleted.
- **Re-inviting** writes a new row. History shows each period of access.
- **Expiry** works the same at `expires_at`, with no job needed for access; a daily job only
  writes the `grant.expired` audit rows.
- **Archiving a memory** revokes its grants (`memory_archived`); un-archiving does not restore
  them.
- **Owner account deleted:** the brain goes with it; grants cascade; audit rows remain.
- **No ownership transfer.** One owner, forever. To hand a memory over, the owner exports it and
  the other person imports it into their own brain.

---

## 10. Replacing `workspaces` / `members` / `invites` (S9)

| Today | After |
|---|---|
| `workspaces` (one per person since D17) | gone; the person (`owner_id`) is the root |
| `members` (owner row) | `memories.owner_id` |
| `members` (editor/viewer rows in someone else's workspace) | `memory_grants`, one per memory of that workspace except core, role carried over, `accepted_at = now()` (they already accepted) |
| `invites` (pending) | `memory_grants` email rows on every non-core memory of that workspace |
| `projects` | data model's call; most likely each project becomes a working memory (and its long-term knowledge a long memory); `memories.legacy_project_id` during the move |
| `resolveScope`, `memberRole` | `resolveMemory`, `memory_role()` |
| `effectiveRole` (run token caps member role) | kept, inside `resolveMemory` |
| `run_tokens.workspace_id, project_id` | `run_tokens.memory_ids` |
| `audit_log.workspace_id` | `owner_id`, `memory_id`, `subject_user_id`; `workspace_id` nullable, kept for old rows |
| "agents never write to the workspace scope" | "agents never write to core, never write rules" |

Order: (1) add `memories`, `memory_grants`, functions, audit columns, with RLS **enabled but
not forced**; (2) backfill from workspaces, members, invites; (3) move routes to `withActor` +
`resolveMemory` one router at a time, each with the §8.3 tests; (4) `FORCE` RLS and switch the
runtime to `sky_app`; (5) drop `members`, `invites`, then `workspaces`. Because D17 gave every
person their own workspace and almost nobody is a member elsewhere, the backfill is small.

---

## 11. Open questions for the owner

1. Is `admin` needed at all in v1, or is owner + editor enough? (Recommend: keep the enum value,
   hide it in the UI until someone asks.)
2. Should viewers be able to export? (Recommend yes, audited; blocking is theatre.)
3. Profile audience: "anyone I share anything with" (proposed) or an explicit list?
4. Confirm Perminister returns verified emails only (blocks email invites until confirmed).
5. Should a grantee see who else is in the memory? (Proposed: contributor and up see names and
   roles, not emails.)
