CREATE TYPE "public"."money_channel" AS ENUM('desk', 'online');--> statement-breakpoint
CREATE TYPE "public"."money_entry_type" AS ENUM('charge', 'payment', 'refund', 'write_off', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."money_source" AS ENUM('appointment', 'treatment_plan');--> statement-breakpoint
CREATE TYPE "public"."tp_billing_mode" AS ENUM('per_visit', 'advance_per_visit', 'package_full', 'package_instalments');--> statement-breakpoint
CREATE TYPE "public"."tp_booking_mode" AS ENUM('normal', 'dedicated');--> statement-breakpoint
CREATE TYPE "public"."tp_ledger_entry" AS ENUM('charge', 'advance', 'payment', 'refund', 'write_off', 'credit_note', 'paid_at_visit');--> statement-breakpoint
CREATE TYPE "public"."tp_plan_status" AS ENUM('proposed', 'accepted', 'in_treatment', 'completed', 'declined', 'paused', 'ended_early');--> statement-breakpoint
CREATE TYPE "public"."tp_plan_type" AS ENUM('staged', 'package', 'timeline', 'review', 'cycle');--> statement-breakpoint
CREATE TYPE "public"."tp_pricing_mode" AS ENUM('per_step', 'package');--> statement-breakpoint
CREATE TYPE "public"."tp_step_status" AS ENUM('pending', 'in_progress', 'done', 'missed', 'skipped', 'window_missed');--> statement-breakpoint
CREATE TYPE "public"."tp_template_status" AS ENUM('draft', 'active', 'inactive', 'archived');--> statement-breakpoint
CREATE TABLE "money_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid,
	"source_type" "money_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"line_ref" uuid,
	"entry_type" "money_entry_type" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"payment_mode" varchar(20),
	"channel" "money_channel" NOT NULL,
	"receipt_no" varchar(30),
	"gateway_ref" varchar(255),
	"request_id" varchar(100) NOT NULL,
	"reverses_entry_id" uuid,
	"reason" varchar(255),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_entries_amount_ck" CHECK ("money_entries"."amount_paise" > 0),
	CONSTRAINT "money_entries_reason_ck" CHECK ("money_entries"."entry_type" IN ('charge', 'payment') OR "money_entries"."reason" IS NOT NULL),
	CONSTRAINT "money_entries_adjustment_ck" CHECK ("money_entries"."entry_type" <> 'adjustment' OR "money_entries"."reverses_entry_id" IS NOT NULL),
	CONSTRAINT "money_entries_online_ref_ck" CHECK ("money_entries"."channel" = 'desk' OR "money_entries"."entry_type" NOT IN ('payment', 'refund') OR "money_entries"."gateway_ref" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "receipt_sequences" (
	"clinic_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_no" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "receipt_sequences_clinic_id_year_pk" PRIMARY KEY("clinic_id","year")
);
--> statement-breakpoint
CREATE TABLE "treatment_instalments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_instalments_amount_ck" CHECK ("treatment_instalments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "treatment_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"entry_type" "tp_ledger_entry" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"step_id" uuid,
	"instalment_id" uuid,
	"payment_mode" varchar(20),
	"reason" varchar(255),
	"approved_by" uuid,
	"request_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_ledger_amount_ck" CHECK ("treatment_ledger"."amount" > 0),
	CONSTRAINT "treatment_ledger_reason_ck" CHECK ("treatment_ledger"."reason" IS NOT NULL
        OR ("treatment_ledger"."entry_type" NOT IN ('refund', 'write_off', 'credit_note')
          AND NOT ("treatment_ledger"."entry_type" = 'charge' AND "treatment_ledger"."step_id" IS NULL))),
	CONSTRAINT "treatment_ledger_write_off_ck" CHECK ("treatment_ledger"."entry_type" <> 'write_off' OR "treatment_ledger"."approved_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"template_id" uuid,
	"consultation_appointment_id" uuid,
	"proposal_group_id" uuid NOT NULL,
	"option_label" varchar(10),
	"consultation_step_seq" integer,
	"option_name" varchar(60),
	"title" varchar(150) NOT NULL,
	"diagnosis" text NOT NULL,
	"plan_type" "tp_plan_type" NOT NULL,
	"status" "tp_plan_status" DEFAULT 'proposed' NOT NULL,
	"billing_mode" "tp_billing_mode",
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"advance_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"consent_file_url" text,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"follow_up_date" date,
	"end_reason" varchar(255),
	"end_reason_sensitive" boolean DEFAULT false NOT NULL,
	"recall_date" date,
	"consent_required" boolean NOT NULL,
	"package_expiry_days" integer,
	"package_expires_on" date,
	"specialty_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plans_amounts_ck" CHECK ("treatment_plans"."total_amount" >= 0 AND "treatment_plans"."discount_amount" >= 0 AND "treatment_plans"."advance_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"gap_days" integer NOT NULL,
	"duration_minutes" integer,
	"fee" numeric(12, 2) NOT NULL,
	"selected_option" jsonb,
	"specialty_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "tp_step_status" DEFAULT 'pending' NOT NULL,
	"earliest_date" date,
	"gap_override_reason" varchar(255),
	"done_at" timestamp with time zone,
	"done_appointment_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_steps_values_ck" CHECK ("treatment_plan_steps"."seq" >= 1 AND "treatment_plan_steps"."gap_days" >= 0
        AND ("treatment_plan_steps"."duration_minutes" IS NULL OR "treatment_plan_steps"."duration_minutes" > 0)
        AND "treatment_plan_steps"."fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_reason" varchar(255),
	"needs_patient_approval" boolean DEFAULT false NOT NULL,
	"patient_approved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_step_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"linked_by" uuid NOT NULL,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"plan_id" uuid,
	"template_id" uuid,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"from_value" varchar(100),
	"to_value" varchar(100),
	"reason" varchar(255),
	"notes" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_history_owner_ck" CHECK (("treatment_plan_history"."plan_id" IS NULL) <> ("treatment_plan_history"."template_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"billing_modes" "tp_billing_mode"[] DEFAULT ARRAY['per_visit','advance_per_visit','package_full','package_instalments']::tp_billing_mode[] NOT NULL,
	"invoice_timing" varchar(10) DEFAULT 'per_step' NOT NULL,
	"discount_cap_percent" integer DEFAULT 10 NOT NULL,
	"booking_mode" "tp_booking_mode" DEFAULT 'normal' NOT NULL,
	"booking_horizon_days" integer,
	"recall_reminder_days" integer DEFAULT 7 NOT NULL,
	"instalment_reminder_days" integer DEFAULT 2 NOT NULL,
	"package_expiry_reminder_days" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_settings_values_ck" CHECK ("treatment_plan_settings"."discount_cap_percent" BETWEEN 0 AND 100
        AND "treatment_plan_settings"."invoice_timing" IN ('per_step', 'at_end'))
);
--> statement-breakpoint
CREATE TABLE "treatment_specialty_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"specialty" varchar(100) NOT NULL,
	"plan_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"step_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"widget" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"owner_doctor_id" uuid,
	"source_template_id" uuid,
	"code" varchar(64),
	"name" varchar(150) NOT NULL,
	"specialty" varchar(100) NOT NULL,
	"category" varchar(100),
	"plan_type" "tp_plan_type" NOT NULL,
	"status" "tp_template_status" DEFAULT 'draft' NOT NULL,
	"pricing_mode" "tp_pricing_mode" NOT NULL,
	"package_price" numeric(12, 2),
	"session_count" integer,
	"interval_days" integer,
	"package_expiry_days" integer,
	"consent_required" boolean DEFAULT false NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"instalments_allowed" boolean DEFAULT false NOT NULL,
	"recall_after_days" integer,
	"diagnosis_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_templates_package_ck" CHECK ("treatment_templates"."plan_type" <> 'package' OR ("treatment_templates"."session_count" >= 1 AND "treatment_templates"."interval_days" >= 1))
);
--> statement-breakpoint
CREATE TABLE "treatment_template_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"template_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"gap_days" integer NOT NULL,
	"max_gap_days" integer,
	"duration_minutes" integer,
	"fee" numeric(12, 2),
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_template_steps_values_ck" CHECK ("treatment_template_steps"."seq" >= 1 AND "treatment_template_steps"."gap_days" >= 0
        AND ("treatment_template_steps"."duration_minutes" IS NULL OR "treatment_template_steps"."duration_minutes" > 0)
        AND ("treatment_template_steps"."fee" IS NULL OR "treatment_template_steps"."fee" >= 0))
);
--> statement-breakpoint
ALTER TABLE "financial_ledgers" DROP CONSTRAINT "financial_ledgers_appointment_id_appointments_id_fk";
--> statement-breakpoint
ALTER TABLE "financial_ledgers" DROP CONSTRAINT "financial_ledgers_clinic_id_clinics_id_fk";
--> statement-breakpoint
ALTER TABLE "financial_ledgers" DROP CONSTRAINT "financial_ledgers_payment_id_appointment_payments_id_fk";
--> statement-breakpoint
ALTER TABLE "appointment_payments" ALTER COLUMN "payment_status" SET DEFAULT 'Pending';--> statement-breakpoint
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_sequences" ADD CONSTRAINT "receipt_sequences_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_instalments" ADD CONSTRAINT "treatment_instalments_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_ledger" ADD CONSTRAINT "treatment_ledger_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_ledger" ADD CONSTRAINT "treatment_ledger_step_id_treatment_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."treatment_plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_ledger" ADD CONSTRAINT "treatment_ledger_instalment_id_treatment_instalments_id_fk" FOREIGN KEY ("instalment_id") REFERENCES "public"."treatment_instalments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_template_id_treatment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."treatment_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_steps" ADD CONSTRAINT "treatment_plan_steps_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_versions" ADD CONSTRAINT "treatment_plan_versions_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_step_appointments" ADD CONSTRAINT "treatment_step_appointments_step_id_treatment_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."treatment_plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_step_appointments" ADD CONSTRAINT "treatment_step_appointments_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_history" ADD CONSTRAINT "treatment_plan_history_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_history" ADD CONSTRAINT "treatment_plan_history_template_id_treatment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."treatment_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_template_steps" ADD CONSTRAINT "treatment_template_steps_template_id_treatment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."treatment_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "money_entries_request_uq" ON "money_entries" USING btree ("clinic_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "money_entries_receipt_uq" ON "money_entries" USING btree ("clinic_id","receipt_no") WHERE "money_entries"."receipt_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "money_entries_clinic_created_idx" ON "money_entries" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "money_entries_source_idx" ON "money_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "money_entries_patient_idx" ON "money_entries" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "money_entries_doctor_idx" ON "money_entries" USING btree ("clinic_id","doctor_id","created_at");--> statement-breakpoint
CREATE INDEX "money_entries_gateway_idx" ON "money_entries" USING btree ("gateway_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_instalments_seq_uq" ON "treatment_instalments" USING btree ("plan_id","seq");--> statement-breakpoint
CREATE INDEX "treatment_instalments_due_idx" ON "treatment_instalments" USING btree ("due_date") WHERE "treatment_instalments"."paid_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_ledger_step_charge_uq" ON "treatment_ledger" USING btree ("step_id") WHERE "treatment_ledger"."entry_type" = 'charge' AND "treatment_ledger"."step_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_ledger_request_uq" ON "treatment_ledger" USING btree ("clinic_id","request_id") WHERE "treatment_ledger"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "treatment_ledger_plan_idx" ON "treatment_ledger" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "treatment_ledger_clinic_created_idx" ON "treatment_ledger" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "treatment_plans_clinic_status_idx" ON "treatment_plans" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "treatment_plans_clinic_doctor_idx" ON "treatment_plans" USING btree ("clinic_id","doctor_id","status");--> statement-breakpoint
CREATE INDEX "treatment_plans_clinic_patient_idx" ON "treatment_plans" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "treatment_plans_follow_up_idx" ON "treatment_plans" USING btree ("clinic_id","follow_up_date");--> statement-breakpoint
CREATE INDEX "treatment_plans_recall_idx" ON "treatment_plans" USING btree ("clinic_id","recall_date");--> statement-breakpoint
CREATE INDEX "treatment_plans_proposal_group_idx" ON "treatment_plans" USING btree ("proposal_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_steps_seq_uq" ON "treatment_plan_steps" USING btree ("plan_id","seq");--> statement-breakpoint
CREATE INDEX "treatment_plan_steps_need_booking_idx" ON "treatment_plan_steps" USING btree ("clinic_id","earliest_date") WHERE "treatment_plan_steps"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_versions_uq" ON "treatment_plan_versions" USING btree ("plan_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_step_appointments_live_uq" ON "treatment_step_appointments" USING btree ("step_id","appointment_id") WHERE "treatment_step_appointments"."unlinked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "treatment_step_appointments_appt_idx" ON "treatment_step_appointments" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "treatment_plan_history_plan_idx" ON "treatment_plan_history" USING btree ("plan_id","action","created_at");--> statement-breakpoint
CREATE INDEX "treatment_plan_history_template_idx" ON "treatment_plan_history" USING btree ("template_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_settings_clinic_uq" ON "treatment_plan_settings" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_specialty_configs_platform_uq" ON "treatment_specialty_configs" USING btree ("specialty") WHERE "treatment_specialty_configs"."clinic_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_specialty_configs_clinic_uq" ON "treatment_specialty_configs" USING btree ("clinic_id","specialty") WHERE "treatment_specialty_configs"."clinic_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_templates_library_code_uq" ON "treatment_templates" USING btree ("code") WHERE "treatment_templates"."clinic_id" IS NULL;--> statement-breakpoint
CREATE INDEX "treatment_templates_clinic_status_idx" ON "treatment_templates" USING btree ("clinic_id","status","specialty");--> statement-breakpoint
CREATE INDEX "treatment_templates_keywords_gin" ON "treatment_templates" USING gin ("diagnosis_keywords");--> statement-breakpoint
CREATE INDEX "treatment_templates_name_trgm" ON "treatment_templates" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_template_steps_seq_uq" ON "treatment_template_steps" USING btree ("template_id","seq");--> statement-breakpoint
ALTER TABLE "financial_ledgers" ADD CONSTRAINT "financial_ledgers_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledgers" ADD CONSTRAINT "financial_ledgers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledgers" ADD CONSTRAINT "financial_ledgers_payment_id_appointment_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."appointment_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_multiple_service_appt_service_uq" ON "appointment_multiple_service" USING btree ("appointment_id","service_id");