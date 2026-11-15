CREATE TYPE "public"."billing_mismatch_kind" AS ENUM('not_applied', 'state_differs', 'amount_differs', 'refund_stuck');--> statement-breakpoint
CREATE TYPE "public"."billing_mismatch_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."subscription_add_on_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_billing_cycle" AS ENUM('monthly', 'yearly', 'none');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled', 'expired', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."subscription_owner_type" AS ENUM('clinic', 'lab', 'pharmacy');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan_kind" AS ENUM('free', 'paid');--> statement-breakpoint
CREATE TYPE "public"."subscription_mandate_method" AS ENUM('card', 'upi', 'emandate');--> statement-breakpoint
CREATE TYPE "public"."subscription_mandate_status" AS ENUM('pending', 'active', 'paused', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subscription_invoice_status" AS ENUM('issued', 'void');--> statement-breakpoint
CREATE TYPE "public"."subscription_payment_kind" AS ENUM('plan_purchase', 'plan_change', 'addon_purchase', 'renewal', 'mandate_setup', 'manual_adjustment', 'credit_purchase');--> statement-breakpoint
CREATE TYPE "public"."subscription_payment_status" AS ENUM('created', 'pending', 'captured', 'failed', 'abandoned', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."subscription_webhook_event_status" AS ENUM('received', 'processing', 'processed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."credit_grant_source" ADD VALUE 'purchase';--> statement-breakpoint
CREATE TABLE "add_on_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"add_on_id" uuid NOT NULL,
	"monthly_price" numeric(12, 2) NOT NULL,
	"yearly_price" numeric(12, 2) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "add_on_prices_prices_ck" CHECK ("add_on_prices"."monthly_price" >= 0 AND "add_on_prices"."yearly_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_mismatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "billing_mismatch_kind" NOT NULL,
	"status" "billing_mismatch_status" DEFAULT 'open' NOT NULL,
	"owner_type" "subscription_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"payment_id" uuid,
	"provider_order_id" varchar(255),
	"provider_payment_id" varchar(255),
	"ours" jsonb NOT NULL,
	"theirs" jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "subscription_add_ons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "subscription_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"add_on_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" "subscription_add_on_status" DEFAULT 'active' NOT NULL,
	"scheduled_quantity" integer,
	"scheduled_deactivate_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_add_ons_quantity_ck" CHECK ("subscription_add_ons"."quantity" > 0),
	CONSTRAINT "subscription_add_ons_scheduled_quantity_ck" CHECK ("subscription_add_ons"."scheduled_quantity" IS NULL OR "subscription_add_ons"."scheduled_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "subscription_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"billing_cycle" "subscription_billing_cycle" NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone,
	"billing_anchor_day" integer,
	"is_trial" boolean DEFAULT false NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" varchar(255),
	"scheduled_plan_id" uuid,
	"scheduled_billing_cycle" "subscription_billing_cycle",
	"scheduled_change_at" timestamp with time zone,
	"scheduled_staff_change" jsonb,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_period_ck" CHECK ("subscriptions"."current_period_end" IS NULL OR "subscriptions"."current_period_end" > "subscriptions"."current_period_start"),
	CONSTRAINT "subscriptions_anchor_day_ck" CHECK ("subscriptions"."billing_anchor_day" IS NULL OR "subscriptions"."billing_anchor_day" BETWEEN 1 AND 31),
	CONSTRAINT "subscriptions_renewing_ck" CHECK ("subscriptions"."billing_cycle" = 'none' OR ("subscriptions"."current_period_end" IS NOT NULL AND "subscriptions"."billing_anchor_day" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"monthly_price" numeric(12, 2),
	"yearly_price" numeric(12, 2),
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_versions_prices_ck" CHECK (("plan_versions"."monthly_price" IS NULL OR "plan_versions"."monthly_price" >= 0) AND ("plan_versions"."yearly_price" IS NULL OR "plan_versions"."yearly_price" >= 0)),
	CONSTRAINT "plan_versions_version_no_ck" CHECK ("plan_versions"."version_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "subscription_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "subscription_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" varchar(20) DEFAULT 'razorpay' NOT NULL,
	"provider_customer_id" varchar(255) NOT NULL,
	"provider_token_id" varchar(255),
	"method" "subscription_mandate_method" NOT NULL,
	"max_amount_paise" bigint NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" "subscription_mandate_status" DEFAULT 'pending' NOT NULL,
	"authorized_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failure_reason" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_mandates_provider_token_id_unique" UNIQUE("provider_token_id"),
	CONSTRAINT "subscription_mandates_max_amount_ck" CHECK ("subscription_mandates"."max_amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"owner_type" "subscription_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"credit_note_number" varchar(40) NOT NULL,
	"financial_year" varchar(7) NOT NULL,
	"issue_date" date NOT NULL,
	"reason" varchar(255) NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"pdf_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_credit_notes_invoice_id_unique" UNIQUE("invoice_id"),
	CONSTRAINT "subscription_credit_notes_credit_note_number_unique" UNIQUE("credit_note_number"),
	CONSTRAINT "subscription_credit_notes_total_ck" CHECK ("subscription_credit_notes"."total_paise" = "subscription_credit_notes"."taxable_paise" + "subscription_credit_notes"."cgst_paise" + "subscription_credit_notes"."sgst_paise" + "subscription_credit_notes"."igst_paise")
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"owner_type" "subscription_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"invoice_number" varchar(40) NOT NULL,
	"financial_year" varchar(7) NOT NULL,
	"status" "subscription_invoice_status" DEFAULT 'issued' NOT NULL,
	"issue_date" date NOT NULL,
	"seller" jsonb NOT NULL,
	"bill_to" jsonb NOT NULL,
	"place_of_supply" varchar(2) NOT NULL,
	"sac_code" varchar(10) NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"pdf_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoices_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "subscription_invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "subscription_invoices_amounts_ck" CHECK ("subscription_invoices"."taxable_paise" >= 0 AND "subscription_invoices"."cgst_paise" >= 0 AND "subscription_invoices"."sgst_paise" >= 0 AND "subscription_invoices"."igst_paise" >= 0),
	CONSTRAINT "subscription_invoices_total_ck" CHECK ("subscription_invoices"."total_paise" = "subscription_invoices"."taxable_paise" + "subscription_invoices"."cgst_paise" + "subscription_invoices"."sgst_paise" + "subscription_invoices"."igst_paise")
);
--> statement-breakpoint
CREATE TABLE "subscription_invoice_sequences" (
	"financial_year" varchar(7) PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"last_credit_note" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "subscription_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"subscription_id" uuid,
	"kind" "subscription_payment_kind" NOT NULL,
	"status" "subscription_payment_status" DEFAULT 'created' NOT NULL,
	"amount_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"coupon_id" integer,
	"lines" jsonb NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"provider" varchar(20),
	"provider_order_id" varchar(255),
	"provider_payment_id" varchar(255),
	"payment_method" varchar(20),
	"mandate_id" uuid,
	"idempotency_key" varchar(64),
	"needs_refund" boolean DEFAULT false NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"failure_reason" varchar(255),
	"reason" varchar(255),
	"done_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payments_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "subscription_payments_amount_ck" CHECK ("subscription_payments"."amount_paise" >= 0),
	CONSTRAINT "subscription_payments_discount_ck" CHECK ("subscription_payments"."discount_paise" >= 0),
	CONSTRAINT "subscription_payments_manual_ck" CHECK ("subscription_payments"."kind" <> 'manual_adjustment' OR ("subscription_payments"."amount_paise" = 0 AND "subscription_payments"."reason" IS NOT NULL AND "subscription_payments"."done_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "subscription_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(20) DEFAULT 'razorpay' NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb,
	"status" "subscription_webhook_event_status" DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "subscription_webhook_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
DROP INDEX "plan_add_on_limits_plan_addon_unique";--> statement-breakpoint
DROP INDEX "plan_features_plan_key_unique";--> statement-breakpoint
ALTER TABLE "credit_grants" ALTER COLUMN "granted_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_add_on_limits" ADD COLUMN "plan_version_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_features" ADD COLUMN "plan_version_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_features" ADD COLUMN "linked_feature_key" varchar(100);--> statement-breakpoint
ALTER TABLE "clinic_subscriptions" ADD COLUMN "provider_payment_id" varchar(255);--> statement-breakpoint
ALTER TABLE "clinic_subscriptions" ADD COLUMN "provider_order_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "owner_type" "subscription_owner_type" DEFAULT 'clinic' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "kind" "subscription_plan_kind" DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "replacement_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_mismatches" ADD CONSTRAINT "billing_mismatches_payment_id_subscription_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."subscription_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_add_ons" ADD CONSTRAINT "subscription_add_ons_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_add_ons" ADD CONSTRAINT "subscription_add_ons_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_plan_id_subscription_plans_id_fk" FOREIGN KEY ("scheduled_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_credit_notes" ADD CONSTRAINT "subscription_credit_notes_invoice_id_subscription_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."subscription_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_credit_notes" ADD CONSTRAINT "subscription_credit_notes_payment_id_subscription_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."subscription_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_payment_id_subscription_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."subscription_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_mandate_id_subscription_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."subscription_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "add_on_prices_add_on_from_unique" ON "add_on_prices" USING btree ("add_on_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_mismatches_one_open" ON "billing_mismatches" USING btree ("kind","payment_id") WHERE "billing_mismatches"."status" = 'open';--> statement-breakpoint
CREATE INDEX "billing_mismatches_status_idx" ON "billing_mismatches" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "billing_mismatches_owner_idx" ON "billing_mismatches" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_add_ons_one_active_per_add_on" ON "subscription_add_ons" USING btree ("subscription_id","add_on_id") WHERE "subscription_add_ons"."status" = 'active';--> statement-breakpoint
CREATE INDEX "subscription_add_ons_owner_idx" ON "subscription_add_ons" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "subscription_add_ons_add_on_idx" ON "subscription_add_ons" USING btree ("add_on_id");--> statement-breakpoint
CREATE INDEX "subscriptions_owner_idx" ON "subscriptions" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_current_per_owner" ON "subscriptions" USING btree ("owner_type","owner_id") WHERE "subscriptions"."status" IN ('trialing', 'active', 'past_due');--> statement-breakpoint
CREATE INDEX "subscriptions_status_period_end_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "subscriptions_scheduled_change_idx" ON "subscriptions" USING btree ("scheduled_change_at") WHERE "subscriptions"."scheduled_change_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "subscriptions_plan_version_idx" ON "subscriptions" USING btree ("plan_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_plan_version_no_unique" ON "plan_versions" USING btree ("plan_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_plan_effective_from_unique" ON "plan_versions" USING btree ("plan_id","effective_from");--> statement-breakpoint
CREATE INDEX "subscription_mandates_owner_idx" ON "subscription_mandates" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_mandates_one_active_per_owner" ON "subscription_mandates" USING btree ("owner_type","owner_id") WHERE "subscription_mandates"."status" = 'active';--> statement-breakpoint
CREATE INDEX "subscription_credit_notes_owner_idx" ON "subscription_credit_notes" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "subscription_invoices_owner_issue_idx" ON "subscription_invoices" USING btree ("owner_type","owner_id","issue_date");--> statement-breakpoint
CREATE INDEX "subscription_payments_owner_created_idx" ON "subscription_payments" USING btree ("owner_type","owner_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_payments_subscription_idx" ON "subscription_payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_payments_mandate_idx" ON "subscription_payments" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "subscription_payments_status_next_attempt_idx" ON "subscription_payments" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "subscription_payments_coupon_owner_idx" ON "subscription_payments" USING btree ("coupon_id","owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_provider_payment_unique" ON "subscription_payments" USING btree ("provider_payment_id") WHERE "subscription_payments"."provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_idempotency_unique" ON "subscription_payments" USING btree ("owner_type","owner_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_one_open_checkout" ON "subscription_payments" USING btree ("owner_type","owner_id") WHERE "subscription_payments"."status" IN ('created', 'pending') AND "subscription_payments"."kind" IN ('plan_purchase', 'plan_change', 'addon_purchase');--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_one_renewal_per_period" ON "subscription_payments" USING btree ("subscription_id","period_start") WHERE "subscription_payments"."kind" = 'renewal' AND "subscription_payments"."status" NOT IN ('abandoned', 'failed', 'refunded') AND NOT "subscription_payments"."needs_refund";--> statement-breakpoint
CREATE INDEX "subscription_webhook_events_status_next_attempt_idx" ON "subscription_webhook_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "plan_add_on_limits" ADD CONSTRAINT "plan_add_on_limits_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_replacement_plan_id_subscription_plans_id_fk" FOREIGN KEY ("replacement_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grants_payment_unique" ON "credit_grants" USING btree ("payment_id") WHERE payment_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_add_on_limits_version_addon_unique" ON "plan_add_on_limits" USING btree ("plan_version_id","add_on_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_features_version_key_unique" ON "plan_features" USING btree ("plan_version_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_subscription_provider_payment" ON "clinic_subscriptions" USING btree ("clinic_id","provider_payment_id") WHERE "clinic_subscriptions"."provider_payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plans_one_trial_per_owner_type" ON "subscription_plans" USING btree ("owner_type") WHERE "subscription_plans"."is_trial_plan" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plans_one_fallback_per_owner_type" ON "subscription_plans" USING btree ("owner_type") WHERE "subscription_plans"."is_default_fallback" = true;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_source_ck" CHECK (("credit_grants"."source"::text = 'purchase' AND "credit_grants"."payment_id" IS NOT NULL AND "credit_grants"."granted_by" IS NULL) OR ("credit_grants"."source"::text <> 'purchase' AND "credit_grants"."granted_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_replacement_ck" CHECK ("subscription_plans"."replacement_plan_id" IS NULL OR ("subscription_plans"."replacement_plan_id" <> "subscription_plans"."id" AND "subscription_plans"."ends_at" IS NOT NULL));--> statement-breakpoint
INSERT INTO "plan_versions" ("plan_id", "version_no", "monthly_price", "yearly_price", "effective_from")
SELECT p."id", 1,
  CASE WHEN COALESCE(p."price", 0) <= 0 THEN NULL ELSE p."price" END,
  CASE WHEN COALESCE(p."price", 0) <= 0 THEN NULL ELSE ROUND(p."price" * 12 * 0.8) END,
  '2020-01-01T00:00:00Z'
FROM "subscription_plans" p
WHERE NOT EXISTS (SELECT 1 FROM "plan_versions" v WHERE v."plan_id" = p."id" AND v."version_no" = 1);
--> statement-breakpoint
UPDATE "plan_add_on_limits" l SET "plan_version_id" = v."id"
FROM "plan_versions" v WHERE v."plan_id" = l."plan_id" AND v."version_no" = 1 AND l."plan_version_id" IS NULL;
--> statement-breakpoint
UPDATE "plan_features" f SET "plan_version_id" = v."id"
FROM "plan_versions" v WHERE v."plan_id" = f."plan_id" AND v."version_no" = 1 AND f."plan_version_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "plan_add_on_limits" ALTER COLUMN "plan_version_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_features" ALTER COLUMN "plan_version_id" SET NOT NULL;
