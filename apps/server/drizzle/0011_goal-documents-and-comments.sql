-- IF NOT EXISTS: the pull request preview of goal documents created this table once (as
-- migration 0010_goal-documents) before main took 0010 for approval requests.
CREATE TABLE IF NOT EXISTS "goal_documents" (
	"goal_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_documents_pk" PRIMARY KEY("goal_id","entry_id"),
	CONSTRAINT "goal_documents_author_kind" CHECK ("goal_documents"."author_kind" in ('human', 'agent')),
	CONSTRAINT "goal_documents_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "goal_documents_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "entry_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"quote" text,
	"body" text NOT NULL,
	"color" text DEFAULT 'yellow' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"author_kind" text NOT NULL,
	"author" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_comments_color" CHECK ("entry_comments"."color" in ('yellow', 'green', 'blue', 'purple', 'orange')),
	CONSTRAINT "entry_comments_author_kind" CHECK ("entry_comments"."author_kind" in ('human', 'agent')),
	CONSTRAINT "entry_comments_body_len" CHECK (char_length("entry_comments"."body") <= 2000),
	CONSTRAINT "entry_comments_quote_len" CHECK ("entry_comments"."quote" is null or char_length("entry_comments"."quote") <= 500)
);
--> statement-breakpoint
ALTER TABLE "entry_comments" ADD CONSTRAINT "entry_comments_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_documents_entry_idx" ON "goal_documents" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_comments_entry_idx" ON "entry_comments" USING btree ("entry_id","created_at");