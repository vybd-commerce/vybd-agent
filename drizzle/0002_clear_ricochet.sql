ALTER TABLE "brief_versions" ADD COLUMN "author_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "author_id" text;--> statement-breakpoint
ALTER TABLE "brief_versions" ADD CONSTRAINT "brief_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;