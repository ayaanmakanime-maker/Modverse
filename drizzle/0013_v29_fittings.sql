CREATE TABLE "fittings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"audience" text NOT NULL,
	"measurements" jsonb NOT NULL,
	"build" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"garment_id" text,
	"design_id" uuid,
	"size" text,
	"fabric_id" text,
	"colour_id" text,
	"styling" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pose" text,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fittings" ADD CONSTRAINT "fittings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fittings_user_idx" ON "fittings" USING btree ("user_id");