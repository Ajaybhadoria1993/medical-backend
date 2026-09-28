CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(20) DEFAULT 'web' NOT NULL,
	"token_hash" varchar(200) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"user_agent" varchar(500),
	"ip_address" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_refresh_token_user_platform" ON "refresh_tokens" USING btree ("user_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_refresh_token_hash" ON "refresh_tokens" USING btree ("token_hash");