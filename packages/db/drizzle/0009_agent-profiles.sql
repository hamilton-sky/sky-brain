CREATE TABLE "agent_bindings" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_bindings_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profiles_user_slug_unique" UNIQUE("user_id","slug"),
	CONSTRAINT "agent_profiles_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "agent_profiles_kind" CHECK ("agent_profiles"."kind" in ('worker', 'steward'))
);
--> statement-breakpoint
ALTER TABLE "agent_bindings" ADD CONSTRAINT "agent_bindings_profile_of_user_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."agent_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;