ALTER TABLE "users" ADD COLUMN "user_name" varchar(15);--> statement-breakpoint
CREATE INDEX "user_name_idx" ON "users" USING btree ("user_name");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_user_name_unique" UNIQUE("user_name");