-- Custom SQL migration file, put your code below! --
-- Memory core guards (MEMORY-SCHEMA.md § 4) and the backfill of every existing brain.

-- entry_versions is append-only: a version is never changed, and never removed on its own. A
-- workspace delete may still cascade through it (pg_trigger_depth() > 1 inside a cascade).
CREATE FUNCTION entry_versions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'entry_versions is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entry_versions_no_update_delete
  BEFORE UPDATE OR DELETE ON entry_versions
  FOR EACH ROW EXECUTE FUNCTION entry_versions_append_only();
--> statement-breakpoint
CREATE TRIGGER entry_versions_no_truncate
  BEFORE TRUNCATE ON entry_versions
  FOR EACH STATEMENT EXECUTE FUNCTION entry_versions_append_only();
--> statement-breakpoint
-- An entry never moves (rule 4) and never changes author; its text changes only together with
-- a new version row; and an agent-written entry cannot reach About me.
CREATE FUNCTION entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.memory_id IS DISTINCT FROM OLD.memory_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.layer IS DISTINCT FROM OLD.layer
     OR NEW.author_kind IS DISTINCT FROM OLD.author_kind
     OR NEW.author IS DISTINCT FROM OLD.author
     OR NEW.on_behalf_of IS DISTINCT FROM OLD.on_behalf_of
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'an entry never moves or changes author'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.title, NEW.body, NEW.summary, NEW.kind, NEW.topic, NEW.questions, NEW.refs)
       IS DISTINCT FROM
     (OLD.title, OLD.body, OLD.summary, OLD.kind, OLD.topic, OLD.questions, OLD.refs)
     AND NOT EXISTS (
       SELECT 1 FROM entry_versions v
       WHERE v.entry_id = NEW.id AND v.version = NEW.version AND NEW.version > OLD.version
     ) THEN
    RAISE EXCEPTION 'entry text changes only with a new version'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.seq := nextval('entries_seq');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entries_guard
  BEFORE UPDATE ON entries
  FOR EACH ROW EXECUTE FUNCTION entries_guard();
--> statement-breakpoint
-- Every existing brain gets its About me, a default Inbox and a default Notebook.
INSERT INTO memories (workspace_id, layer, name, is_default)
SELECT w.id, l.layer::memory_layer, l.name, true
FROM workspaces w
CROSS JOIN (VALUES ('core', 'About me'), ('short', 'Inbox'), ('long', 'Notebook')) AS l(layer, name);
