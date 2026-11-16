ALTER TYPE "public"."brief_source" ADD VALUE 'builder';--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "share_hidden_fields" SET DEFAULT '{"customer","alternative","competitors","channels","nameDirections"}';--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "builder_brand_id" text;--> statement-breakpoint
ALTER TABLE "brief_versions" ADD COLUMN "builder_version" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "builder_user_id" text;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_builder_brand_id_unique" UNIQUE("builder_brand_id");--> statement-breakpoint
-- New brief fields start hidden on existing share pages too.
UPDATE "brands" SET "share_hidden_fields" = "share_hidden_fields" || '{"alternative","competitors"}';