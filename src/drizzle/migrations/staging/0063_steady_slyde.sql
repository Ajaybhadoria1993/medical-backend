CREATE TABLE "support_access_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"path" varchar(255) NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_access_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"super_admin_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"target_role" varchar(30) NOT NULL,
	"reason" varchar(255) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(20)
);
--> statement-breakpoint
CREATE INDEX "support_views_session_idx" ON "support_access_views" USING btree ("session_id","viewed_at");--> statement-breakpoint
CREATE INDEX "support_sessions_clinic_idx" ON "support_access_sessions" USING btree ("clinic_id","started_at");--> statement-breakpoint
CREATE INDEX "support_sessions_admin_idx" ON "support_access_sessions" USING btree ("super_admin_id","ended_at");