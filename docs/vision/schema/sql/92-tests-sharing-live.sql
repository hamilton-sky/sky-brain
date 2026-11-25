-- Part 2: run after the owner role switches sharing on:
--   psql -U postgres -c "INSERT INTO feature_flags VALUES ('rls_enforced', now())"
--   psql -U sky_app -v ON_ERROR_STOP=1 -f 92-tests-sharing-live.sql

\ir test-helpers.sql

SELECT pg_temp.as_('u_dana', 'agent');
SELECT pg_temp.must_fail($q$ SELECT accept_grant('00000000-0000-0000-0000-0000000009a1') $q$, 'only a person accepts');
SELECT pg_temp.as_('u_dana', 'human');
SELECT accept_grant('00000000-0000-0000-0000-0000000009a1');
SELECT pg_temp.ok('Dana reads exactly the shared memory, nothing from core, inbox or notebook',
  (SELECT array_agg(DISTINCT memory_id) FROM entries WHERE workspace_id = '00000000-0000-0000-0000-0000000000a1')
   = ARRAY['00000000-0000-0000-0000-0000000005a2'::uuid]);
SELECT pg_temp.as_('u_stranger', 'human');
SELECT pg_temp.ok('a stranger reads nothing', (SELECT count(*) FROM entries) = 0);
SELECT pg_temp.as_('', 'human');
SELECT pg_temp.ok('no person set: nothing (fails closed)', (SELECT count(*) FROM entries) = 0);
SELECT pg_temp.as_('u_dana', 'human');
UPDATE entries SET salience = 3 WHERE id = '00000000-0000-0000-0000-00000000e001';   -- owner's private inbox entry
SELECT pg_temp.as_('u_owner', 'human');
SELECT pg_temp.ok('Dana cannot touch an entry she cannot read', (SELECT salience FROM entries WHERE id = '00000000-0000-0000-0000-00000000e001') = 0);
SELECT pg_temp.ok('flow rule: shared Health -> private Inbox is fine',
  flow_allowed('00000000-0000-0000-0000-0000000005a1', ARRAY['00000000-0000-0000-0000-0000000005a2'::uuid]));
SELECT pg_temp.ok('flow rule: private Inbox -> shared Health needs a person',
  NOT flow_allowed('00000000-0000-0000-0000-0000000005a2', ARRAY['00000000-0000-0000-0000-0000000005a1'::uuid]));

-- ===================== forget =====================
SELECT pg_temp.as_('u_stranger', 'human');
SELECT pg_temp.must_fail($q$ SELECT forget_entry('00000000-0000-0000-0000-00000000e001', 'x') $q$, 'not found');
SELECT pg_temp.as_('u_owner', 'agent');
SELECT pg_temp.must_fail($q$ SELECT forget_entry('00000000-0000-0000-0000-00000000e001', 'x') $q$, 'signed-in person');
SELECT pg_temp.must_fail($q$
  SELECT set_config('sky_brain.forget', 'on', true);
  UPDATE entry_versions SET body = '' WHERE entry_id = '00000000-0000-0000-0000-00000000e001'
$q$, 'append-only');
SELECT pg_temp.as_('u_owner', 'human');
SELECT forget_entry('00000000-0000-0000-0000-00000000e001', 'owner asked');
SELECT pg_temp.ok('forget scrubs text, summaries, hash and link reasons',
  (SELECT bool_and(body = '' AND content_hash IS NULL) FROM entry_versions WHERE entry_id = '00000000-0000-0000-0000-00000000e001')
  AND (SELECT bool_and(summary = '[forgotten]') FROM entry_summaries WHERE entry_id = '00000000-0000-0000-0000-00000000e001')
  AND (SELECT bool_and(reason = '[forgotten]') FROM entry_links WHERE to_entry = '00000000-0000-0000-0000-00000000e001')
  AND (SELECT forgotten_at IS NOT NULL AND search IS NULL FROM entries WHERE id = '00000000-0000-0000-0000-00000000e001'));
SELECT pg_temp.ok('the gist built on it waits for the owner',
  (SELECT forget_review FROM entries WHERE id = '00000000-0000-0000-0000-00000000e005'));
SELECT pg_temp.ok('forget is audited', EXISTS (SELECT 1 FROM audit_log WHERE action = 'entry.forget'));
