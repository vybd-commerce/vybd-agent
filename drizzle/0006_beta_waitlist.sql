CREATE TABLE "waitlist" (
	"email" text PRIMARY KEY NOT NULL,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"approved_by" text
);
--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;