CREATE TABLE "run_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"verbs" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "run_tokens_role" CHECK ("run_tokens"."role" in ('editor', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "run_tokens" ADD CONSTRAINT "run_tokens_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_tokens" ADD CONSTRAINT "run_tokens_project_in_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_tokens_device_idx" ON "run_tokens" USING btree ("device_id");