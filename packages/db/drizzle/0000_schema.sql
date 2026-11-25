CREATE TYPE "public"."author_kind" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('rule', 'decision', 'claim', 'question', 'answer', 'artifact', 'lesson', 'note');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('human', 'agent', 'code', 'web', 'import');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('proposed', 'approved', 'open', 'answered', 'superseded', 'expired', 'rejected', 'quarantined');--> statement-breakpoint
CREATE SEQUENCE "public"."entries_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint DEFAULT nextval('entries_seq') NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"feature_id" uuid,
	"kind" "entry_kind" NOT NULL,
	"status" "entry_status" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_kind" "author_kind" NOT NULL,
	"author" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"source" "entry_source" NOT NULL,
	"refs" text[] DEFAULT '{}' NOT NULL,
	"reply_to" uuid,
	"supersedes" uuid,
	"confidence" real,
	"expires_at" timestamp with time zone,
	"allow_agent_answers" boolean DEFAULT false NOT NULL,
	"quarantined_because" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', "body"), 'B')) STORED,
	CONSTRAINT "entries_seq_unique" UNIQUE("seq"),
	CONSTRAINT "entries_confidence_range" CHECK ("entries"."confidence" is null or ("entries"."confidence" >= 0 and "entries"."confidence" <= 1)),
	CONSTRAINT "entries_feature_needs_project" CHECK ("entries"."feature_id" is null or "entries"."project_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "features_project_id_slug_unique" UNIQUE("project_id","slug"),
	CONSTRAINT "features_id_project_id_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "role" NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "invites_workspace_id_email_unique" UNIQUE("workspace_id","email")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"git_remote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_workspace_id_slug_unique" UNIQUE("workspace_id","slug"),
	CONSTRAINT "projects_workspace_id_git_remote_unique" UNIQUE("workspace_id","git_remote"),
	CONSTRAINT "projects_id_workspace_id_unique" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_reply_to_entries_id_fk" FOREIGN KEY ("reply_to") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_supersedes_entries_id_fk" FOREIGN KEY ("supersedes") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_project_in_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_feature_in_project_fk" FOREIGN KEY ("feature_id","project_id") REFERENCES "public"."features"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_workspace_seq_idx" ON "audit_log" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE INDEX "entries_search_idx" ON "entries" USING gin ("search");--> statement-breakpoint
CREATE INDEX "entries_workspace_seq_idx" ON "entries" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE INDEX "entries_scope_idx" ON "entries" USING btree ("workspace_id","project_id","feature_id","kind","status");--> statement-breakpoint
CREATE INDEX "entries_reply_to_idx" ON "entries" USING btree ("reply_to");--> statement-breakpoint
CREATE INDEX "entries_supersedes_idx" ON "entries" USING btree ("supersedes");