-- Custom SQL migration file, put your code below! --
-- task_events is append-only (cloud-task-board spec.md Events and audit): no row is ever changed
-- or removed, not even when its task, goal or workspace is deleted.
CREATE FUNCTION task_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'task_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER task_events_no_update_delete
  BEFORE UPDATE OR DELETE ON task_events
  FOR EACH ROW EXECUTE FUNCTION task_events_append_only();
--> statement-breakpoint
-- Postgres allows TRUNCATE triggers only FOR EACH STATEMENT.
CREATE TRIGGER task_events_no_truncate
  BEFORE TRUNCATE ON task_events
  FOR EACH STATEMENT EXECUTE FUNCTION task_events_append_only();
