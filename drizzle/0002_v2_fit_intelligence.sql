CREATE TABLE "fit_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"size" text NOT NULL,
	"fit" text NOT NULL,
	"overall" text NOT NULL,
	"areas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "measurement_profiles" ADD COLUMN "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fit_feedback" ADD CONSTRAINT "fit_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_feedback" ADD CONSTRAINT "fit_feedback_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fit_feedback_user_idx" ON "fit_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fit_feedback_item_uq" ON "fit_feedback" USING btree ("order_item_id");