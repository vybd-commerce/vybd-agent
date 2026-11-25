ALTER TABLE "jobs" ADD COLUMN "agent_lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "agent_attempts" integer DEFAULT 0 NOT NULL;