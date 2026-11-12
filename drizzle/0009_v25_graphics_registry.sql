CREATE TABLE "graphic_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_url" text NOT NULL,
	"package" text,
	"creator" text NOT NULL,
	"licence" text NOT NULL,
	"licence_url" text,
	"commercial" boolean NOT NULL,
	"attribution_required" boolean NOT NULL,
	"attribution" text NOT NULL,
	"redistribution" text NOT NULL,
	"original_format" text NOT NULL,
	"optimized_format" text NOT NULL,
	"downloaded_at" text NOT NULL,
	"approval" text DEFAULT 'approved' NOT NULL,
	"style" text,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creative_assets" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD COLUMN "creator" text;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD COLUMN "attribution" text;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD COLUMN "categories" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD COLUMN "style" text;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD COLUMN "approval" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
CREATE INDEX "assets_source_idx" ON "creative_assets" USING btree ("source_id");