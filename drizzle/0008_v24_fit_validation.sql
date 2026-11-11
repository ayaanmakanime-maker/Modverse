CREATE TABLE "fit_validation_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"audience" text NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"pairs" jsonb NOT NULL,
	"consent" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fit_validation_samples" ADD CONSTRAINT "fit_validation_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fit_validation_user_idx" ON "fit_validation_samples" USING btree ("user_id");