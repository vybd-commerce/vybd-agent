ALTER TABLE "jobs" ADD COLUMN "agent_wait_until" timestamp;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "agent_state" jsonb;