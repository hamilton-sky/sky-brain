CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author" text NOT NULL,
	"on_behalf_of" text NOT NULL,
	"reason" text NOT NULL,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approval_requests_status" CHECK ("approval_requests"."status" in ('pending', 'approved', 'rejected', 'expired', 'superseded')),
	CONSTRAINT "approval_requests_author_kind" CHECK ("approval_requests"."author_kind" in ('human', 'agent')),
	CONSTRAINT "approval_requests_decided" CHECK (("approval_requests"."status" in ('approved', 'rejected')) = ("approval_requests"."decided_by" is not null and "approval_requests"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_workspace_status_idx" ON "approval_requests" USING btree ("workspace_id","status");