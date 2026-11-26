CREATE TABLE "core_entry_hats" (
	"entry_id" uuid NOT NULL,
	"hat_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_entry_hats_pk" PRIMARY KEY("entry_id","hat_id")
);
--> statement-breakpoint
CREATE TABLE "hats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hats_ws_slug_unique" UNIQUE("workspace_id","slug"),
	CONSTRAINT "hats_id_ws_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "hats_slug_format" CHECK ("hats"."slug" ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
	CONSTRAINT "hats_name_length" CHECK (char_length("hats"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "entry_versions" ADD COLUMN "capture_hat_id" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "hat_id" uuid;--> statement-breakpoint
ALTER TABLE "core_entry_hats" ADD CONSTRAINT "core_entry_hats_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_entry_hats" ADD CONSTRAINT "core_entry_hats_hat_in_ws_fk" FOREIGN KEY ("hat_id","workspace_id") REFERENCES "public"."hats"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hats" ADD CONSTRAINT "hats_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_entry_hats_hat_idx" ON "core_entry_hats" USING btree ("hat_id");--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_hat_in_ws_fk" FOREIGN KEY ("hat_id","workspace_id") REFERENCES "public"."hats"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_hat_idx" ON "memories" USING btree ("hat_id");--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_core_no_hat" CHECK ("memories"."layer" <> 'core' or "memories"."hat_id" is null);--> statement-breakpoint
-- A hat tag goes on an About me entry of the same brain only (D30): other layers take their
-- hat from their memory.
CREATE FUNCTION core_entry_hats_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM entries e
    WHERE e.id = NEW.entry_id AND e.workspace_id = NEW.workspace_id AND e.layer = 'core'
  ) THEN
    RAISE EXCEPTION 'core_entry_hats: entry % is not an About me entry of this brain', NEW.entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER core_entry_hats_core_only
  BEFORE INSERT OR UPDATE ON core_entry_hats
  FOR EACH ROW EXECUTE FUNCTION core_entry_hats_check();
