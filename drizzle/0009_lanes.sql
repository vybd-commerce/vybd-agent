CREATE TABLE "lane_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_by" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lanes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"owner_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lane_tasks" ADD CONSTRAINT "lane_tasks_lane_id_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."lanes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_tasks" ADD CONSTRAINT "lane_tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lane_tasks_lane_idx" ON "lane_tasks" USING btree ("lane_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "lanes_brand_key_idx" ON "lanes" USING btree ("brand_id","key");--> statement-breakpoint
-- Backfill: existing brands get the default lanes. Keep in sync with DEFAULT_LANES in src/lib/services/lanes.ts.
INSERT INTO "lanes" ("brand_id", "key", "title", "position")
SELECT b."id", d."key", d."title", d."position"
FROM "brands" b
CROSS JOIN (VALUES ('positioning', 'Positioning', 0), ('research', 'Research', 1), ('product', 'Product', 2), ('sourcing', 'Sourcing', 3)) AS d("key", "title", "position")
ON CONFLICT DO NOTHING;
