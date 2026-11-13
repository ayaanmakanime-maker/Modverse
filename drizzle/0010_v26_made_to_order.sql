ALTER TABLE "cart_items" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "kind" text DEFAULT 'design' NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "library" jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "kind" text DEFAULT 'design' NOT NULL;