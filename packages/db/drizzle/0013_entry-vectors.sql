-- pgvector is already on in Nanogres (0.8.1, enabled by its owner on 15 Nov); IF NOT EXISTS makes
-- this a no-op there and turns it on in PGlite (D44).
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "entry_vectors" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"model" text NOT NULL,
	"embedding" halfvec(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_vectors" ADD CONSTRAINT "entry_vectors_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_vectors_hnsw_idx" ON "entry_vectors" USING hnsw ("embedding" halfvec_cosine_ops);