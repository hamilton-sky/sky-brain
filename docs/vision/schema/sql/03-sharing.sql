-- sky-brain sharing: invite people to single memories. Ships with BUILD-PLAN step 8, or earlier
-- only after a new decision (D23) because it reorders D21 (R4-02). Based on blue-3, with the
-- red-team fixes (R1-02, R1-06, R1-07, R1-10, R1-16, R1-17, R2-05, R2-12, R3-01).
-- Tested on PostgreSQL 16 (90-tests.sql, section "sharing").

CREATE TYPE access_role AS ENUM ('viewer', 'contributor', 'editor');   -- 'admin' waits for a real need

-- members becomes owner-only: all other access is a grant on one memory (R1-06.3).
-- (production: migrate non-owner rows to grants on every non-core memory first, then add this)
ALTER TABLE members ADD CONSTRAINT members_owner_only CHECK (role = 'owner') NOT VALID;

-- A chosen slice of "About me" that people you share with may see. Core only, set by the owner only.
ALTER TABLE entries ADD COLUMN in_profile boolean NOT NULL DEFAULT false;
ALTER TABLE entries ADD CONSTRAINT entries_profile_core CHECK (NOT in_profile OR layer = 'core');

CREATE TABLE memory_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id         uuid NOT NULL,
  workspace_id      uuid NOT NULL,
  layer             memory_layer NOT NULL,
  grantee_user_id   text REFERENCES "user"(id),     -- NO ACTION: who had access survives an account delete (R2)
  grantee_email     text CHECK (grantee_email IS NULL OR grantee_email = lower(grantee_email)),
  role              access_role NOT NULL,
  granted_by        text NOT NULL,                  -- always the owner (a person); agents cannot grant
  created_at        timestamptz NOT NULL DEFAULT now(),
  invite_expires_at timestamptz,                    -- an unbound email invite lapses (14 days)
  bound_at          timestamptz,                    -- grantee_user_id filled from the VERIFIED email at sign-in
  accepted_at       timestamptz,                    -- live only after the grantee accepts
  expires_at        timestamptz,
  revoked_at        timestamptz,
  revoked_by        text,
  CONSTRAINT mg_memory_fk FOREIGN KEY (memory_id, workspace_id, layer) REFERENCES memories(id, workspace_id, layer),
  CONSTRAINT mg_not_core  CHECK (layer <> 'core'),                         -- core is never shared
  CONSTRAINT mg_has_grantee CHECK (grantee_user_id IS NOT NULL OR grantee_email IS NOT NULL),
  CONSTRAINT mg_accept_needs_user CHECK (accepted_at IS NULL OR grantee_user_id IS NOT NULL),
  CONSTRAINT mg_revoke_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX mg_one_open_user  ON memory_grants (memory_id, grantee_user_id) WHERE revoked_at IS NULL AND grantee_user_id IS NOT NULL;
CREATE UNIQUE INDEX mg_one_open_email ON memory_grants (memory_id, grantee_email)   WHERE revoked_at IS NULL AND grantee_user_id IS NULL;
CREATE INDEX mg_live_by_grantee ON memory_grants (grantee_user_id, memory_id) INCLUDE (role, expires_at)
  WHERE revoked_at IS NULL AND accepted_at IS NOT NULL;

-- Terms never change; a grant is bound once, accepted once, revoked once (blue-3 5.2).
CREATE FUNCTION memory_grants_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'grants are revoked, not deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.memory_id, NEW.workspace_id, NEW.layer, NEW.grantee_email, NEW.role, NEW.granted_by,
      NEW.created_at, NEW.invite_expires_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.memory_id, OLD.workspace_id, OLD.layer, OLD.grantee_email, OLD.role, OLD.granted_by,
      OLD.created_at, OLD.invite_expires_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'a grant''s terms never change: revoke it and grant again';
  END IF;
  IF OLD.grantee_user_id IS NOT NULL AND NEW.grantee_user_id IS DISTINCT FROM OLD.grantee_user_id THEN
    RAISE EXCEPTION 'a bound grant cannot move to another person';
  END IF;
  IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'accepted_at is written once';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'a revoked grant is final'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memory_grants_guard BEFORE UPDATE OR DELETE ON memory_grants
  FOR EACH ROW EXECUTE FUNCTION memory_grants_guard();

-- Every grant change is audited, by the DB (R2-12: no-op updates write nothing).
CREATE FUNCTION memory_grants_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a text;
BEGIN
  a := CASE
         WHEN TG_OP = 'INSERT' THEN 'grant.create'
         WHEN NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN 'grant.revoke'
         WHEN NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN 'grant.accept'
         WHEN NEW.grantee_user_id IS NOT NULL AND OLD.grantee_user_id IS NULL THEN 'grant.bind'
       END;
  IF a IS NULL THEN RETURN NULL; END IF;
  INSERT INTO audit_log (workspace_id, actor, action, target_id, details)
  VALUES (NEW.workspace_id, coalesce(app_person(), 'system'), a, NEW.id,
          jsonb_build_object('memory_id', NEW.memory_id, 'role', NEW.role, 'grantee', NEW.grantee_user_id));
  RETURN NULL;
END $$;
CREATE TRIGGER memory_grants_audit AFTER INSERT OR UPDATE ON memory_grants
  FOR EACH ROW EXECUTE FUNCTION memory_grants_audit();

-- The single source of truth for "what may this request read". SECURITY DEFINER so it reads
-- grants unfiltered; it only ever answers for app_person() (R1-17: no p_person parameter).
CREATE FUNCTION app_readable_memories() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(x.id), '{}'::uuid[]) FROM (
    SELECT m.id FROM memories m JOIN workspaces w ON w.id = m.workspace_id
     WHERE w.owner_user_id = app_person()
    UNION
    SELECT g.memory_id FROM memory_grants g JOIN memories m ON m.id = g.memory_id AND m.archived_at IS NULL
     WHERE g.grantee_user_id = app_person() AND g.revoked_at IS NULL AND g.accepted_at IS NOT NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())
  ) x
  WHERE nullif(current_setting('app.token_memories', true), '') IS NULL
     OR x.id = ANY (current_setting('app.token_memories', true)::uuid[])   -- run token narrowing
$$;
REVOKE ALL ON FUNCTION app_readable_memories() FROM PUBLIC;

-- Owners whose profile slice the caller may see: people who share at least one memory with them.
CREATE FUNCTION app_profile_workspaces() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT g.workspace_id), '{}'::uuid[]) FROM memory_grants g
   WHERE g.grantee_user_id = app_person() AND g.revoked_at IS NULL AND g.accepted_at IS NOT NULL
     AND (g.expires_at IS NULL OR g.expires_at > now())
$$;
REVOKE ALL ON FUNCTION app_profile_workspaces() FROM PUBLIC;

-- The flow rule: text never moves to a wider audience without a person (blue-3 7.1). True when
-- everyone who can read `target` can already read every source memory.
CREATE FUNCTION flow_allowed(p_target uuid, p_sources uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM memory_grants t
     WHERE t.memory_id = p_target AND t.revoked_at IS NULL AND t.grantee_user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM unnest(p_sources) s(mid)
                    WHERE s.mid <> p_target AND NOT EXISTS (
                      SELECT 1 FROM memory_grants g
                       WHERE g.memory_id = s.mid AND g.grantee_user_id = t.grantee_user_id
                         AND g.revoked_at IS NULL)))
$$;

-- Row Level Security: the fail-closed default for every ad-hoc query. Retrieval (FTS, trigram,
-- vectors, hops) runs through SECURITY DEFINER functions owned by sky_search with the filter
-- written inside, because RLS disables the GIN indexes (R3-01). sky_app is a LOGIN role with its
-- own DATABASE_URL: no session-level SET ROLE through PgBouncer (R1-15).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sky_app')    THEN CREATE ROLE sky_app;    END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sky_worker') THEN CREATE ROLE sky_worker; END IF;
END $$;
GRANT EXECUTE ON FUNCTION app_readable_memories(), app_profile_workspaces() TO sky_app, sky_worker;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries FORCE ROW LEVEL SECURITY;
CREATE POLICY entries_read ON entries FOR SELECT TO sky_app USING (
  memory_id = ANY ((SELECT app_readable_memories())::uuid[])                         -- R1-16 cast
  OR (in_profile AND layer = 'core' AND trust = 'approved'
      AND workspace_id = ANY ((SELECT app_profile_workspaces())::uuid[])));          -- R1-07
-- Inserts: a person or agent writes only into memories they may write. Head columns are guarded
-- by entries_guard; plain UPDATE is limited to bookkeeping columns, by people only (R1-10).
CREATE POLICY entries_insert ON entries FOR INSERT TO sky_app WITH CHECK (
  memory_id = ANY ((SELECT app_readable_memories())::uuid[]) AND NOT in_profile);
CREATE POLICY entries_update ON entries FOR UPDATE TO sky_app
  USING (app_actor_kind() = 'human' AND memory_id = ANY ((SELECT app_readable_memories())::uuid[]))
  WITH CHECK (app_actor_kind() = 'human' AND (NOT in_profile OR workspace_id IN (
    SELECT id FROM workspaces WHERE owner_user_id = app_person())));
-- Workers (embedding, sweeps) get their own role and policy instead of a USING (true) for everyone (R1-02).
CREATE POLICY entries_worker ON entries FOR SELECT TO sky_worker USING (true);
GRANT SELECT, INSERT ON entries TO sky_app;
GRANT UPDATE (expires_at, salience, core_rank, in_profile) ON entries TO sky_app;   -- column grants (R1-10)
GRANT SELECT ON entries TO sky_worker;
-- (Same pattern on entry_versions, entry_summaries, entry_links, entry_evidence, episodes, entry_vectors
--  via their memory or entry; entry_uses / packets / packet_items by reader_id = app_person() only, R1-05.)

-- Grants go live only once RLS is enforced in production (R1-02): accept is refused until then.
CREATE TABLE feature_flags (name text PRIMARY KEY, on_since timestamptz);
CREATE FUNCTION accept_grant(p_grant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE name = 'rls_enforced') THEN
    RAISE EXCEPTION 'sharing is not switched on yet';
  END IF;
  IF app_actor_kind() <> 'human' THEN RAISE EXCEPTION 'only a person accepts'; END IF;
  -- per-memory advisory lock: grant changes and flow-checked writes do not race (R2-05)
  PERFORM pg_advisory_xact_lock(hashtextextended((SELECT memory_id::text FROM memory_grants WHERE id = p_grant), 0));
  UPDATE memory_grants SET accepted_at = now()
   WHERE id = p_grant AND grantee_user_id = app_person() AND accepted_at IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION accept_grant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_grant(uuid) TO sky_app;
GRANT SELECT, INSERT, UPDATE ON memory_grants TO sky_app;   -- the grant/revoke routes; the guard trigger limits UPDATE
