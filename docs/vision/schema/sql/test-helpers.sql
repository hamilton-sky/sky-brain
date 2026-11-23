-- Helpers for the schema tests: must_fail(sql, expected error), ok(label, condition), as_(person, actor kind).

CREATE FUNCTION pg_temp.must_fail(q text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE q;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'EXPECTED FAILURE did not happen: %', q USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN RAISE;
            WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%' || pat || '%' THEN RAISE EXCEPTION 'wrong error for [%]: % (wanted %)', q, SQLERRM, pat; END IF;
    RAISE NOTICE 'PASS refused: %', pat;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END $$;
CREATE FUNCTION pg_temp.ok(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE FUNCTION pg_temp.as_(person text, kind text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.person', person, false), set_config('app.actor_kind', kind, false) $$;

