ALTER TABLE "brands" ADD COLUMN "score_unlocked_at" timestamp;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "ip_hash" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "from_team" boolean DEFAULT false NOT NULL;