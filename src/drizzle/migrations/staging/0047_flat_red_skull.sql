CREATE TYPE "public"."credit_grant_source" AS ENUM('grant', 'removal');--> statement-breakpoint
CREATE TYPE "public"."message_paid_with" AS ENUM('unlimited', 'plan', 'credit');--> statement-breakpoint
CREATE TABLE "credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"credit_type" varchar(30) NOT NULL,
	"source" "credit_grant_source" NOT NULL,
	"credits_total" integer NOT NULL,
	"credits_left" integer NOT NULL,
	"granted_by" uuid NOT NULL,
	"reason" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"expiry_reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_type" varchar(30) NOT NULL,
	"credits" integer NOT NULL,
	"price_inr" numeric(10, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"changed_by" uuid,
	"reason" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_type" varchar(30) NOT NULL,
	"expiry_days" integer NOT NULL,
	"reminder_days" integer NOT NULL,
	"warn_percent" integer NOT NULL,
	"unit_cost_inr" numeric(10, 4) NOT NULL,
	"tax_percent" numeric(5, 2) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"changed_by" uuid,
	"reason" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"channel" varchar(30) NOT NULL,
	"message_id" varchar(128) NOT NULL,
	"template_key" varchar(64) NOT NULL,
	"paid_with" "message_paid_with" NOT NULL,
	"credit_grant_id" uuid,
	"billable" boolean,
	"cost_inr" numeric(10, 4),
	"refunded_at" timestamp with time zone,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_message_log_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "clinic_settings" ALTER COLUMN "whatsapp_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "messaging_message_log" ADD CONSTRAINT "messaging_message_log_credit_grant_id_credit_grants_id_fk" FOREIGN KEY ("credit_grant_id") REFERENCES "public"."credit_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_grants_live_idx" ON "credit_grants" USING btree ("clinic_id","credit_type","expires_at") WHERE credits_left > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_packs_type_credits_unique" ON "credit_packs" USING btree ("credit_type","credits");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_settings_type_from_unique" ON "credit_settings" USING btree ("credit_type","effective_from");--> statement-breakpoint
CREATE INDEX "messaging_message_log_plan_usage_idx" ON "messaging_message_log" USING btree ("clinic_id","channel","sent_at") WHERE paid_with = 'plan' AND refunded_at IS NULL;