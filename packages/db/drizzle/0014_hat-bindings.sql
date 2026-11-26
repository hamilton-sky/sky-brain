CREATE TABLE "hat_bindings" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"hat_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hat_bindings_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "hat_bindings" ADD CONSTRAINT "hat_bindings_hat_id_hats_id_fk" FOREIGN KEY ("hat_id") REFERENCES "public"."hats"("id") ON DELETE cascade ON UPDATE no action;