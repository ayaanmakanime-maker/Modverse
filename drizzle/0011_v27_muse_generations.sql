CREATE TABLE "image_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"mode" text NOT NULL,
	"prompt" text NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"params" jsonb NOT NULL,
	"reference_upload_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"prompt_id" text,
	"error" text,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_id" uuid,
	"saved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_reference_upload_id_uploaded_assets_id_fk" FOREIGN KEY ("reference_upload_id") REFERENCES "public"."uploaded_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_generations_user_idx" ON "image_generations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "image_generations_status_idx" ON "image_generations" USING btree ("status");