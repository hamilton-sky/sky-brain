CREATE TYPE "public"."entry_source" AS ENUM('human', 'agent', 'web', 'import');--> statement-breakpoint
CREATE TYPE "public"."entry_topic" AS ENUM('rule', 'question', 'answer', 'lesson', 'note', 'artifact');--> statement-breakpoint
CREATE TYPE "public"."knowledge_kind" AS ENUM('fact', 'decision', 'hypothesis', 'observation', 'external');--> statement-breakpoint
CREATE TYPE "public"."memory_layer" AS ENUM('core', 'long', 'short', 'working');--> statement-breakpoint
CREATE TYPE "public"."summary_source" AS ENUM('writer', 'fallback');--> statement-breakpoint
CREATE TYPE "public"."trust_level" AS ENUM('quarantined', 'proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE SEQUENCE "public"."entries_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint DEFAULT nextval('entries_seq') NOT NULL,
	"workspace_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"layer" "memory_layer" NOT NULL,
	"kind" "knowledge_kind" NOT NULL,
	"topic" "entry_topic",
	"trust" "trust_level" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"summary" text NOT NULL,
	"summary_source" "summary_source" NOT NULL,
	"questions" text[] DEFAULT '{}' NOT NULL,
	"refs" text[] DEFAULT '{}' NOT NULL,
	"author_kind" text NOT NULL,
	"author" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"source" "entry_source" NOT NULL,
	"quarantined_because" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', sb_norm("title")), 'A') || setweight(to_tsvector('simple', sb_norm("summary" || ' ' || sb_join("questions"))), 'B') || setweight(to_tsvector('simple', sb_norm("body")), 'C')) STORED,
	CONSTRAINT "entries_author_kind" CHECK ("entries"."author_kind" in ('human', 'agent')),
	CONSTRAINT "entries_core_human" CHECK ("entries"."layer" <> 'core' or "entries"."author_kind" = 'human'),
	CONSTRAINT "entries_short_fades" CHECK (("entries"."layer" = 'short') = ("entries"."expires_at" is not null)),
	CONSTRAINT "entries_external_kind" CHECK ("entries"."source" not in ('web', 'import') or "entries"."kind" = 'external'),
	CONSTRAINT "entries_quarantine_reason" CHECK (("entries"."trust" = 'quarantined') = ("entries"."quarantined_because" is not null))
);
--> statement-breakpoint
CREATE TABLE "entry_versions" (
	"entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" "knowledge_kind" NOT NULL,
	"topic" "entry_topic",
	"title" text NOT NULL,
	"body" text NOT NULL,
	"summary" text NOT NULL,
	"summary_source" "summary_source" NOT NULL,
	"questions" text[] DEFAULT '{}' NOT NULL,
	"refs" text[] DEFAULT '{}' NOT NULL,
	"author_kind" text NOT NULL,
	"author" text NOT NULL,
	"quarantined_because" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_versions_entry_id_version_pk" PRIMARY KEY("entry_id","version"),
	CONSTRAINT "entry_versions_author_kind" CHECK ("entry_versions"."author_kind" in ('human', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"layer" "memory_layer" NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_id_ws_layer_unique" UNIQUE("id","workspace_id","layer"),
	CONSTRAINT "memories_core_is_default" CHECK ("memories"."layer" <> 'core' or "memories"."is_default")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_in_memory_fk" FOREIGN KEY ("memory_id","workspace_id","layer") REFERENCES "public"."memories"("id","workspace_id","layer") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_versions" ADD CONSTRAINT "entry_versions_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_search_idx" ON "entries" USING gin ("search");--> statement-breakpoint
CREATE INDEX "entries_workspace_seq_idx" ON "entries" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE INDEX "entries_memory_idx" ON "entries" USING btree ("memory_id","trust");--> statement-breakpoint
CREATE UNIQUE INDEX "memories_one_core" ON "memories" USING btree ("workspace_id") WHERE "memories"."layer" = 'core';--> statement-breakpoint
CREATE UNIQUE INDEX "memories_one_default_per_layer" ON "memories" USING btree ("workspace_id","layer") WHERE "memories"."is_default";