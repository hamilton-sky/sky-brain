-- Custom SQL migration file, put your code below! --
-- Memory core, step 1 (docs/vision/schema/MEMORY-SCHEMA.md § 9). The old `entries` table never
-- had an API, so it must be empty; refuse to go on rather than drop rows.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM entries) THEN
    RAISE EXCEPTION 'entries is not empty: move its rows before the memory core migration';
  END IF;
  -- sb_norm erases Hebrew letters in a non-UTF8 database (R2-10.7).
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'sky-brain needs a UTF8 database, got %', current_setting('server_encoding');
  END IF;
END $$;
--> statement-breakpoint
-- Word-search normalizer for Hebrew and English: lower case, strip niqqud and cantillation
-- (U+0591 to U+05C7), and join gershayim acronyms (צה"ל -> צהל). IMMUTABLE, so a generated
-- column may use it.
CREATE FUNCTION sb_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(t, '')), '[֑-ׇ]', '', 'g'),
           '([א-ת])["״׳''](?=[א-ת])', '\1', 'g')
$$;
--> statement-breakpoint
-- array_to_string is only STABLE; on text[] it cannot change, so a generated column may use this.
CREATE FUNCTION sb_join(t text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT array_to_string(t, ' ')
$$;
