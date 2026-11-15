DROP INDEX "unique_refresh_token_user_platform";--> statement-breakpoint
CREATE INDEX "idx_refresh_token_user_platform" ON "refresh_tokens" USING btree ("user_id","platform");