CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "brand_members" (
	"brand_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brand_members_brand_id_user_id_pk" PRIMARY KEY("brand_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "invite_uses" (
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"used_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invite_uses_token_user_id_pk" PRIMARY KEY("token","user_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"token" text PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_brand_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_uses" ADD CONSTRAINT "invite_uses_token_invites_token_fk" FOREIGN KEY ("token") REFERENCES "public"."invites"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_uses" ADD CONSTRAINT "invite_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_members_user_idx" ON "brand_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invites_brand_idx" ON "invites" USING btree ("brand_id");--> statement-breakpoint
INSERT INTO "brand_members" ("brand_id", "user_id", "role", "joined_at") SELECT "id", "owner_id", 'owner', "created_at" FROM "brands" ON CONFLICT DO NOTHING;