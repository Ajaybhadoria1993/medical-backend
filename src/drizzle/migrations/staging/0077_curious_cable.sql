CREATE TYPE "public"."billing_tax_mode" AS ENUM('inclusive', 'exclusive', 'none');--> statement-breakpoint
CREATE TYPE "public"."cron_run_status" AS ENUM('ok', 'failed');--> statement-breakpoint
CREATE TABLE "billing_tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_bp" integer NOT NULL,
	"mode" "billing_tax_mode" NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"notice_days" integer DEFAULT 0 NOT NULL,
	"reason" varchar(255) NOT NULL,
	"created_by" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_tax_rates_rate_ck" CHECK ("billing_tax_rates"."rate_bp" >= 0 AND "billing_tax_rates"."rate_bp" <= 10000),
	CONSTRAINT "billing_tax_rates_none_ck" CHECK ("billing_tax_rates"."mode" <> 'none' OR "billing_tax_rates"."rate_bp" = 0),
	CONSTRAINT "billing_tax_rates_notice_ck" CHECK ("billing_tax_rates"."notice_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trial_requests" (
	"owner_type" "subscription_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" uuid,
	CONSTRAINT "trial_requests_owner_type_owner_id_pk" PRIMARY KEY("owner_type","owner_id")
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" varchar(80) NOT NULL,
	"status" "cron_run_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"summary" varchar(255),
	"error" text,
	"triggered_by" uuid
);
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "compare_at_monthly" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "compare_at_yearly" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN "tax_rate_bp" integer DEFAULT 1800 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN "tax_mode" "billing_tax_mode" DEFAULT 'inclusive' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "tax_rate_bp" integer DEFAULT 1800 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "tax_mode" "billing_tax_mode" DEFAULT 'inclusive' NOT NULL;--> statement-breakpoint
CREATE INDEX "billing_tax_rates_effective_idx" ON "billing_tax_rates" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "cron_runs_job_started_idx" ON "cron_runs" USING btree ("job","started_at");