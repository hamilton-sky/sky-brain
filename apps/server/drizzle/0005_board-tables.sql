CREATE TYPE "public"."goal_executor" AS ENUM('single', 'loop', 'team');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('draft', 'approved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_event_kind" AS ENUM('created', 'claimed', 'renewed', 'released', 'done', 'failed', 'reclaimed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'done', 'failed', 'blocked');--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"feature_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"executor" "goal_executor" NOT NULL,
	"status" "goal_status" DEFAULT 'draft' NOT NULL,
	"assignee" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"quarantined_because" text,
	"author_kind" text NOT NULL,
	"author" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "goals_author_kind" CHECK ("goals"."author_kind" in ('human', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "task_deps" (
	"task_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	CONSTRAINT "task_deps_task_id_depends_on_id_pk" PRIMARY KEY("task_id","depends_on_id"),
	CONSTRAINT "task_deps_not_self" CHECK ("task_deps"."task_id" <> "task_deps"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" "task_event_kind" NOT NULL,
	"actor" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"device_id" uuid,
	"claim_seq" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"lane" text,
	"files" text[],
	"context_refs" text[] DEFAULT '{}' NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"holder_actor" text,
	"holder_person" text,
	"holder_device" uuid,
	"lease_expires_at" timestamp with time zone,
	"claim_seq" bigint DEFAULT 0 NOT NULL,
	"text_hash" text NOT NULL,
	"approved_hash" text,
	"quarantined_because" text,
	"proof" jsonb,
	"fail_reason" text,
	"position" integer NOT NULL,
	"author_kind" text NOT NULL,
	"author" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_max_attempts_range" CHECK ("tasks"."max_attempts" between 1 and 10),
	CONSTRAINT "tasks_author_kind" CHECK ("tasks"."author_kind" in ('human', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_project_in_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_feature_in_project_fk" FOREIGN KEY ("feature_id","project_id") REFERENCES "public"."features"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_deps" ADD CONSTRAINT "task_deps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_deps" ADD CONSTRAINT "task_deps_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_in_project_fk" FOREIGN KEY ("goal_id","project_id") REFERENCES "public"."goals"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_in_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_events_task_seq_idx" ON "task_events" USING btree ("task_id","seq");--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_goal_position_idx" ON "tasks" USING btree ("goal_id","position");