CREATE TYPE "public"."notification_category" AS ENUM('appointments', 'payments', 'prescription', 'lab', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('notification', 'activity');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('action_required', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."notification_tenant_type" AS ENUM('clinic', 'lab', 'pharmacy');--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "tenant_type" "notification_tenant_type";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "category" "notification_category" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "priority" "notification_priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "kind" "notification_kind" DEFAULT 'notification' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_key" varchar(120);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "click_route" varchar(255);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "click_params" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "collapse_key" varchar(200);--> statement-breakpoint
CREATE INDEX "notifications_user_kind_created_idx" ON "notifications" USING btree ("user_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_tenant_created_idx" ON "notifications" USING btree ("tenant_type","tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_collapse_unread_uq" ON "notifications" USING btree ("user_id","collapse_key") WHERE "notifications"."read" = false AND "notifications"."collapse_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_pair_ck" CHECK (("notifications"."tenant_type" IS NULL) = ("notifications"."tenant_id" IS NULL));