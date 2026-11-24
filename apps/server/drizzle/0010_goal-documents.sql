CREATE TABLE "goal_documents" (
	"goal_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_documents_pk" PRIMARY KEY("goal_id","entry_id"),
	CONSTRAINT "goal_documents_author_kind" CHECK ("goal_documents"."author_kind" in ('human', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "goal_documents" ADD CONSTRAINT "goal_documents_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_documents" ADD CONSTRAINT "goal_documents_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_documents_entry_idx" ON "goal_documents" USING btree ("entry_id");