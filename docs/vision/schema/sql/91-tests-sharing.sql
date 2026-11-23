-- Sharing cases, part 1 (before sharing is switched on). Run AFTER 90-tests.sql, logged in as sky_app (session_user = sky_app, as
-- in production), with 03-sharing.sql applied by the owner role in between:
--   psql -U postgres -f 03-sharing.sql ; psql -U sky_app -v ON_ERROR_STOP=1 -f 91-tests-forget-sharing.sql
-- (feature flag 'rls_enforced' is switched on by the owner role at the marked point.)

\ir test-helpers.sql

-- ===================== sharing =====================
-- Dana signs in: her own brain with her own core.
SELECT pg_temp.as_('u_dana', 'human');
BEGIN;
INSERT INTO workspaces (id, name, owner_user_id) VALUES ('00000000-0000-0000-0000-0000000000d1', 'Dana brain', 'u_dana');
INSERT INTO memories (id, workspace_id, layer, slug, name, is_default, created_by) VALUES
  ('00000000-0000-0000-0000-00000000c0d1', '00000000-0000-0000-0000-0000000000d1', 'core', 'about-me', 'About me', true, 'u_dana');
COMMIT;

-- The owner shares the "Health inbox" (not the whole short layer) with Dana as a viewer.
SELECT pg_temp.as_('u_owner', 'human');
INSERT INTO memory_grants (id, memory_id, workspace_id, layer, grantee_user_id, role, granted_by, bound_at)
VALUES ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000a1',
        'short', 'u_dana', 'viewer', 'u_owner', now());
SELECT pg_temp.must_fail($q$
  INSERT INTO memory_grants (memory_id, workspace_id, layer, grantee_user_id, role, granted_by)
  VALUES ('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-0000000000a1', 'core', 'u_dana', 'viewer', 'u_owner')
$q$, 'mg_not_core');
SELECT pg_temp.must_fail($q$ UPDATE memory_grants SET role = 'editor' WHERE id = '00000000-0000-0000-0000-0000000009a1' $q$, 'terms never change');
SELECT pg_temp.ok('grant creation is audited', EXISTS (SELECT 1 FROM audit_log WHERE action = 'grant.create'));

-- Owner writes into the shared memory; a contributor-style profile laundering attempt is refused (R1-07).
BEGIN;
INSERT INTO entries (id, workspace_id, memory_id, layer, item_type, created_by_kind, created_by, on_behalf_of)
VALUES ('00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000005a2',
        'short', 'capture', 'human', 'u_owner', 'u_owner');
INSERT INTO entry_versions (entry_id, version_no, workspace_id, title, body, kind, source, author_kind, author, on_behalf_of)
VALUES ('00000000-0000-0000-0000-00000000e0a1', 1, '00000000-0000-0000-0000-0000000000a1', 'Dentist on Tuesday', 'body',
        'fact', 'human', 'human', 'u_owner', 'u_owner');
INSERT INTO entry_summaries (entry_id, for_version, workspace_id, summary, source, written_by_kind, written_by, on_behalf_of)
VALUES ('00000000-0000-0000-0000-00000000e0a1', 1, '00000000-0000-0000-0000-0000000000a1', 'Dentist on Tuesday', 'fallback',
        'rule', 'server', 'u_owner');
COMMIT;
SELECT pg_temp.must_fail($q$
  INSERT INTO entries (workspace_id, memory_id, layer, item_type, created_by_kind, created_by, on_behalf_of, in_profile)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000005a2', 'short', 'capture',
          'agent', 'x', 'u_owner', true)
$q$, 'row-level security');

-- Not live until Dana accepts, and accepting is refused until RLS is enforced (R1-02).
SELECT pg_temp.as_('u_dana', 'human');
SELECT pg_temp.ok('Dana sees nothing of the owner before accepting', (SELECT count(*) FROM entries WHERE workspace_id = '00000000-0000-0000-0000-0000000000a1') = 0);
SELECT pg_temp.must_fail($q$ SELECT accept_grant('00000000-0000-0000-0000-0000000009a1') $q$, 'not switched on');
