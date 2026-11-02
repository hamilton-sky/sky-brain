CREATE TABLE "device_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"client_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"interval_seconds" integer NOT NULL,
	"last_polled_at" timestamp with time zone,
	"approved_by" text,
	"device_id" uuid,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_codes_device_code_hash_unique" UNIQUE("device_code_hash")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "secret_hash" text;--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_codes_pending_user_code_idx" ON "device_codes" USING btree ("user_code") WHERE "device_codes"."device_id" is null;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_secret_hash_unique" UNIQUE("secret_hash");