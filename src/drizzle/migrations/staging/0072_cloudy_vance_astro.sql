CREATE TABLE "whatsapp_message_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "notification_tenant_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_platform_offs" (
	"message_key" varchar(64) PRIMARY KEY NOT NULL,
	"turned_off_by" uuid,
	"turned_off_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_message_prefs_owner_unique" ON "whatsapp_message_prefs" USING btree ("owner_type","owner_id");