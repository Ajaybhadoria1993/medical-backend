ALTER TABLE "notifications" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_unresolved_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "notifications"."priority" = 'action_required' AND "notifications"."resolved_at" IS NULL;