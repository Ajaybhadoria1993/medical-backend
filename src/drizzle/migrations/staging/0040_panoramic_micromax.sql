CREATE TABLE "clinic_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"payment_provider" varchar(50) NOT NULL,
	"gateway_account_id" varchar(255),
	"gateway_stakeholder_id" varchar(255),
	"route_status" varchar(50) DEFAULT 'INACTIVE' NOT NULL,
	"route_onboarded_at" timestamp,
	"route_onboarding_rejection_reason" text,
	"onboarding_draft_data" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fee_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(20) NOT NULL,
	"clinic_id" uuid,
	"version" integer NOT NULL,
	"fee_type" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"calculation_method" varchar(50) NOT NULL,
	"calculation_base" varchar(50) NOT NULL,
	"rate_or_amount" numeric(12, 4) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '18.00' NOT NULL,
	"tax_treatment" varchar(50) DEFAULT 'TAX_EXCLUSIVE' NOT NULL,
	"fee_payer" varchar(50) DEFAULT 'PATIENT' NOT NULL,
	"fee_recipient" varchar(50) DEFAULT 'PLATFORM' NOT NULL,
	"deduction_strategy" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"checkout_reference_id" varchar(255) NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_id" uuid,
	"status" varchar(50) DEFAULT 'REQUIRES_PAYMENT' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"financial_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"payment_mode" varchar(50) NOT NULL,
	"payment_method" varchar(50) NOT NULL,
	"payment_provider" varchar(50),
	"payment_status" varchar(50) DEFAULT 'Pending' NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"gateway_order_id" varchar(255) NOT NULL,
	"transaction_id" varchar(255),
	"gateway_response" jsonb,
	"platform_commission" numeric(12, 2),
	"pg_fee" numeric(12, 2),
	"gst_amount" numeric(12, 2),
	"convenience_fee" numeric(12, 2),
	"transferred_amount" numeric(12, 2),
	"refunded_amount" numeric(12, 2),
	"refund_notes" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DROP TABLE "clinic_commissions" CASCADE;--> statement-breakpoint
DROP TABLE "clinic_razorpay_accounts" CASCADE;--> statement-breakpoint
ALTER TABLE "clinic_payment_accounts" ADD CONSTRAINT "clinic_payment_accounts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_versions" ADD CONSTRAINT "fee_config_versions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_payment_account_clinic_provider_unique" ON "clinic_payment_accounts" USING btree ("clinic_id","payment_provider");--> statement-breakpoint
CREATE INDEX "fee_config_resolution_idx" ON "fee_config_versions" USING btree ("clinic_id","fee_type","is_active");--> statement-breakpoint
CREATE INDEX "fee_config_scope_idx" ON "fee_config_versions" USING btree ("scope","fee_type");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_ref_unique_idx" ON "payment_intents" USING btree ("source_type","checkout_reference_id");--> statement-breakpoint
CREATE INDEX "payment_intent_clinic_idx" ON "payment_intents" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "payment_intent_source_idx" ON "payment_intents" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_order_unique" ON "payment_transactions" USING btree ("payment_provider","gateway_order_id");--> statement-breakpoint
CREATE INDEX "payment_tx_intent_idx" ON "payment_transactions" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "payment_tx_status_idx" ON "payment_transactions" USING btree ("payment_status");