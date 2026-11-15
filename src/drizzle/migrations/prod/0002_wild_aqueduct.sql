CREATE TYPE "public"."credit_grant_source" AS ENUM('grant', 'removal');--> statement-breakpoint
CREATE TYPE "public"."message_paid_with" AS ENUM('unlimited', 'plan', 'credit');--> statement-breakpoint
CREATE SEQUENCE "public"."clinic_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "doctor_gallery_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_image_id" uuid,
	"image_url" text NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"note" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_onboarding_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"performed_by" uuid NOT NULL,
	"reason" varchar(500),
	"reset_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "clinic_settlement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"payment_provider" varchar(50) NOT NULL,
	"appointment_payment_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"provider_transfer_id" varchar(255),
	"clinic_amount" numeric(12, 2) NOT NULL,
	"reversed_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" varchar(30) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"payment_provider" varchar(50) NOT NULL,
	"provider_settlement_id" varchar(255) NOT NULL,
	"gateway_account_id" varchar(255),
	"cycle_start" timestamp NOT NULL,
	"cycle_end" timestamp NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(30) NOT NULL,
	"failure_reason" varchar(500),
	"expected_settlement_at" timestamp,
	"settled_at" timestamp,
	"gateway_response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"storage_url" text NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"provider_evidence_id" varchar(255),
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"appointment_payment_id" uuid NOT NULL,
	"payment_provider" varchar(50) NOT NULL,
	"provider_dispute_id" varchar(255) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(40) NOT NULL,
	"resolution_party" varchar(20),
	"filed_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"provider_response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "refund_review_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_review_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"storage_url" text NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_refund_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"cancellation_request_id" uuid NOT NULL,
	"cancellation_refund_id" uuid,
	"reason_category" varchar(100) NOT NULL,
	"policy_reference" varchar(100),
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(30) DEFAULT 'PENDING' NOT NULL,
	"patient_note" text,
	"decision" varchar(20),
	"decision_note" text,
	"failure_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
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
CREATE TABLE "plan_add_on_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"add_on_id" uuid NOT NULL,
	"max_cap" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "followup_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followup_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"priority" varchar(8) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"owner_admin_id" uuid,
	"reason" varchar(255) NOT NULL,
	"trigger_data" jsonb,
	"snoozed_until" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"outcome" varchar(32),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_commissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clinic_razorpay_accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "clinic_commissions" CASCADE;--> statement-breakpoint
DROP TABLE "clinic_razorpay_accounts" CASCADE;--> statement-breakpoint
ALTER TABLE "clinic_settings" ALTER COLUMN "whatsapp_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "doctor_qualifications" ALTER COLUMN "qualification_type" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "delete_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "clinic_code" varchar(16) DEFAULT 'MED-' || lpad(nextval('clinic_code_seq')::text, 6, '0') NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "acquisition_source" varchar(32) DEFAULT 'Unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_qualifications" ADD COLUMN "notes" varchar(300);--> statement-breakpoint
ALTER TABLE "doctor_preferences" ADD COLUMN "pre_diagnosis_list" json DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "clinic_add_ons" ADD COLUMN "scheduled_reduction_by" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_add_ons" ADD COLUMN "reduction_effective_at" timestamp;--> statement-breakpoint
ALTER TABLE "clinic_add_ons" ADD COLUMN "scheduled_deactivate_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "is_trial_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "trial_days" integer;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "is_default_fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_gallery_share" ADD CONSTRAINT "doctor_gallery_share_gallery_image_id_doctor_gallery_id_fk" FOREIGN KEY ("gallery_image_id") REFERENCES "public"."doctor_gallery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_gallery_share" ADD CONSTRAINT "doctor_gallery_share_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_gallery_share" ADD CONSTRAINT "doctor_gallery_share_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_gallery_share" ADD CONSTRAINT "doctor_gallery_share_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_onboarding_resets" ADD CONSTRAINT "clinic_onboarding_resets_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_onboarding_resets" ADD CONSTRAINT "clinic_onboarding_resets_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_payment_accounts" ADD CONSTRAINT "clinic_payment_accounts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlement_items" ADD CONSTRAINT "clinic_settlement_items_settlement_id_clinic_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."clinic_settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlement_items" ADD CONSTRAINT "clinic_settlement_items_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlement_items" ADD CONSTRAINT "clinic_settlement_items_appointment_payment_id_appointment_payments_id_fk" FOREIGN KEY ("appointment_payment_id") REFERENCES "public"."appointment_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlement_items" ADD CONSTRAINT "clinic_settlement_items_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlements" ADD CONSTRAINT "clinic_settlements_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_evidence" ADD CONSTRAINT "payment_dispute_evidence_dispute_id_payment_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."payment_disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_evidence" ADD CONSTRAINT "payment_dispute_evidence_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_evidence" ADD CONSTRAINT "payment_dispute_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_appointment_payment_id_appointment_payments_id_fk" FOREIGN KEY ("appointment_payment_id") REFERENCES "public"."appointment_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_review_documents" ADD CONSTRAINT "refund_review_documents_refund_review_id_cancellation_refund_reviews_id_fk" FOREIGN KEY ("refund_review_id") REFERENCES "public"."cancellation_refund_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_review_documents" ADD CONSTRAINT "refund_review_documents_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_review_documents" ADD CONSTRAINT "refund_review_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_cancellation_request_id_cancellation_requests_id_fk" FOREIGN KEY ("cancellation_request_id") REFERENCES "public"."cancellation_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_cancellation_refund_id_cancellation_refunds_id_fk" FOREIGN KEY ("cancellation_refund_id") REFERENCES "public"."cancellation_refunds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_message_log" ADD CONSTRAINT "messaging_message_log_credit_grant_id_credit_grants_id_fk" FOREIGN KEY ("credit_grant_id") REFERENCES "public"."credit_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_versions" ADD CONSTRAINT "fee_config_versions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_add_on_limits" ADD CONSTRAINT "plan_add_on_limits_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_add_on_limits" ADD CONSTRAINT "plan_add_on_limits_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_notes" ADD CONSTRAINT "followup_notes_task_id_followup_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."followup_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_gallery_share_appointment_image_uq" ON "doctor_gallery_share" USING btree ("appointment_id","image_url");--> statement-breakpoint
CREATE INDEX "doctor_gallery_share_patient_idx" ON "doctor_gallery_share" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_clinic_onboarding_resets_clinic" ON "clinic_onboarding_resets" USING btree ("clinic_id","reset_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_payment_account_clinic_provider_unique" ON "clinic_payment_accounts" USING btree ("clinic_id","payment_provider");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_settlement_transfer_unique" ON "clinic_settlement_items" USING btree ("payment_provider","provider_transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_settlement_payment_unique" ON "clinic_settlement_items" USING btree ("settlement_id","appointment_payment_id");--> statement-breakpoint
CREATE INDEX "clinic_settlement_item_clinic_idx" ON "clinic_settlement_items" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_settlement_item_appointment_idx" ON "clinic_settlement_items" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_settlement_provider_unique" ON "clinic_settlements" USING btree ("payment_provider","provider_settlement_id");--> statement-breakpoint
CREATE INDEX "clinic_settlement_clinic_status_idx" ON "clinic_settlements" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "clinic_settlement_cycle_idx" ON "clinic_settlements" USING btree ("clinic_id","cycle_start","cycle_end");--> statement-breakpoint
CREATE INDEX "payment_dispute_evidence_dispute_idx" ON "payment_dispute_evidence" USING btree ("dispute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_dispute_provider_unique" ON "payment_disputes" USING btree ("payment_provider","provider_dispute_id");--> statement-breakpoint
CREATE INDEX "payment_dispute_clinic_status_idx" ON "payment_disputes" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "payment_dispute_appointment_idx" ON "payment_disputes" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "refund_review_document_review_idx" ON "refund_review_documents" USING btree ("refund_review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_review_appointment_unique" ON "cancellation_refund_reviews" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "refund_review_clinic_status_idx" ON "cancellation_refund_reviews" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "credit_grants_live_idx" ON "credit_grants" USING btree ("clinic_id","credit_type","expires_at") WHERE credits_left > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_packs_type_credits_unique" ON "credit_packs" USING btree ("credit_type","credits");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_settings_type_from_unique" ON "credit_settings" USING btree ("credit_type","effective_from");--> statement-breakpoint
CREATE INDEX "messaging_message_log_plan_usage_idx" ON "messaging_message_log" USING btree ("clinic_id","channel","sent_at") WHERE paid_with = 'plan' AND refunded_at IS NULL;--> statement-breakpoint
CREATE INDEX "fee_config_resolution_idx" ON "fee_config_versions" USING btree ("clinic_id","fee_type","is_active");--> statement-breakpoint
CREATE INDEX "fee_config_scope_idx" ON "fee_config_versions" USING btree ("scope","fee_type");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_ref_unique_idx" ON "payment_intents" USING btree ("source_type","checkout_reference_id");--> statement-breakpoint
CREATE INDEX "payment_intent_clinic_idx" ON "payment_intents" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "payment_intent_source_idx" ON "payment_intents" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_order_unique" ON "payment_transactions" USING btree ("payment_provider","gateway_order_id");--> statement-breakpoint
CREATE INDEX "payment_tx_intent_idx" ON "payment_transactions" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "payment_tx_status_idx" ON "payment_transactions" USING btree ("payment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_add_on_limits_plan_addon_unique" ON "plan_add_on_limits" USING btree ("plan_id","add_on_id");--> statement-breakpoint
CREATE INDEX "plan_add_on_limits_plan_idx" ON "plan_add_on_limits" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_add_on_limits_addon_idx" ON "plan_add_on_limits" USING btree ("add_on_id");--> statement-breakpoint
CREATE INDEX "followup_notes_task_created_idx" ON "followup_notes" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "followup_tasks_live_unique" ON "followup_tasks" USING btree ("clinic_id","type") WHERE status <> 'resolved';--> statement-breakpoint
CREATE INDEX "followup_tasks_status_opened_idx" ON "followup_tasks" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "followup_tasks_clinic_idx" ON "followup_tasks" USING btree ("clinic_id");--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_patient_doctor_idx" ON "appointments" USING btree ("patient_id","doctor_id");--> statement-breakpoint
CREATE INDEX "appointment_multiple_service_appointment_id_idx" ON "appointment_multiple_service" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinics_clinic_code_unique" ON "clinics" USING btree ("clinic_code");--> statement-breakpoint
CREATE INDEX "ix_clinics_name_trgm" ON "clinics" USING gin ("clinic_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_clinics_code_trgm" ON "clinics" USING gin ("clinic_code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_clinics_phone_trgm" ON "clinics" USING gin ("clinic_phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_clinics_city_trgm" ON "clinics" USING gin ("city" gin_trgm_ops);