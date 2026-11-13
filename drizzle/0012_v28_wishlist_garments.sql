CREATE TABLE "wishlist_garments" (
	"user_id" uuid NOT NULL,
	"garment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_garments_user_id_garment_id_pk" PRIMARY KEY("user_id","garment_id")
);
--> statement-breakpoint
ALTER TABLE "wishlist_garments" ADD CONSTRAINT "wishlist_garments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;