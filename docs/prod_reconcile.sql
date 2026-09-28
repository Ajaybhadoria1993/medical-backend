-- ---------------------------------------------------------------------------
-- Prod reconcile: the REAL gap between prod (infinity_medisatu) and the models.
--
-- Derived from `drizzle-kit pull` of live prod, stripped of the ~226 DROP INDEX
-- / 18 DROP CONSTRAINT false-diffs that drizzle-kit introspection emits (it does
-- not round-trip partial indexes / truncated FK names). Only genuinely missing
-- objects are here. Every statement is guarded so it is safe to re-run.
--
-- Run as ONE transaction:
--   psql "<prod>" -v ON_ERROR_STOP=1 -1 -f docs/prod_reconcile.sql
--
-- Verified safe for prod state on 2026-08-27:
--   doctor_session_overrides = 0 rows, visiting_requests = 0 rows
--   doctor_session_overrides currently has only:
--     id, clinic_id, doctor_id, for_date, created_by, created_at, value_minutes
-- ---------------------------------------------------------------------------

-- 1. Enums --------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE "public"."doctor_arrival_source" AS ENUM('self', 'reception', 'auto_confirm'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."session_override_type" AS ENUM('running_late', 'schedule_shift', 'slot_config', 'extra_slots', 'missed_dismissed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."visiting_request_status" AS ENUM('Pending', 'Scheduled', 'Cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."staff_access_scope" AS ENUM('assigned_doctors', 'all_doctors'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. New tables -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "doctor_arrivals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"for_date" date NOT NULL,
	"session_start" varchar,
	"arrived_at" timestamp NOT NULL,
	"source" "doctor_arrival_source" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "staff_doctor_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "staff_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"access_scope" "staff_access_scope" DEFAULT 'assigned_doctors' NOT NULL,
	"location" varchar(120),
	"responsibility" varchar(255),
	"updated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- 3. doctor_session_overrides: bring the old 7-col table up to the model -----
ALTER TABLE "doctor_session_overrides" ALTER COLUMN "value_minutes" DROP NOT NULL;
ALTER TABLE "doctor_session_overrides" ADD COLUMN IF NOT EXISTS "type" "session_override_type";
ALTER TABLE "doctor_session_overrides" ADD COLUMN IF NOT EXISTS "session_start" varchar;
ALTER TABLE "doctor_session_overrides" ADD COLUMN IF NOT EXISTS "slot_minutes" integer;
ALTER TABLE "doctor_session_overrides" ADD COLUMN IF NOT EXISTS "step_minutes" integer;
ALTER TABLE "doctor_session_overrides" ADD COLUMN IF NOT EXISTS "number_of_slots" integer;
ALTER TABLE "doctor_session_overrides" ADD COLUMN IF NOT EXISTS "no_of_patients" integer;
-- table is empty, so it is safe to enforce NOT NULL on "type" now
ALTER TABLE "doctor_session_overrides" ALTER COLUMN "type" SET NOT NULL;

-- 4. Other missing columns -------------------------------------------------
ALTER TABLE "visiting_requests" ADD COLUMN IF NOT EXISTS "status" "visiting_request_status" DEFAULT 'Pending' NOT NULL;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "is_clinic_phone_verified" boolean DEFAULT false NOT NULL;
ALTER TABLE "doctor_preferences" ADD COLUMN IF NOT EXISTS "advice_suggestions_list" json DEFAULT '["Take medicines as prescribed.","Take adequate rest.","Maintain proper hydration.","Avoid self-medication.","Complete the full course of antibiotics.","Do light exercise daily.","Maintain personal hygiene.","Monitor temperature twice a day.","Avoid smoking and alcohol.","Follow up if symptoms persist."]'::json;

-- 5. Column default / nullability tweaks (idempotent by nature) -------------
ALTER TABLE "appointment_clinical_data" ALTER COLUMN "common_symptoms" SET DEFAULT '{}';
ALTER TABLE "appointment_clinical_data" ALTER COLUMN "clinic_symptom_ids" SET DEFAULT '{}';
ALTER TABLE "labs" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "independent_patients" ALTER COLUMN "doctor_name" DROP NOT NULL;
ALTER TABLE "quick_print_templates" ALTER COLUMN "element_config" SET DEFAULT '{"showClinicHeader":true,"showClinicLogo":true,"showPatientName":true,"showPatientUhid":true,"showPatientAge":true,"showPatientGender":true,"showPatientMobile":true,"showPatientAddress":false,"showVisitDate":true,"showDiagnosis":true,"showMedicineTable":true,"showMedicineComposition":true,"showMedicineQuantity":false,"showMedicineInstructions":true,"showAdvice":true,"showFollowUp":true,"showDoctorName":true,"showDoctorQualification":true,"showDoctorRegistration":false,"showDoctorSignature":true,"showQrCode":false,"showFooter":true,"sectionOrder":["clinicHeader","patientInfo","diagnosis","medicineTable","advice","followUp","doctorSignature","footer"]}'::jsonb;

-- 6. Foreign keys for the 3 new tables -----------------------------------
DO $$ BEGIN ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 7. Indexes for the new tables + the two newly-populated columns ----------
CREATE INDEX IF NOT EXISTS "doctor_arrivals_lookup_idx" ON "doctor_arrivals" USING btree ("doctor_id","for_date","session_start","created_at");
CREATE INDEX IF NOT EXISTS "doctor_arrivals_clinic_date_idx" ON "doctor_arrivals" USING btree ("clinic_id","for_date");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_doctor_assignment_unique" ON "staff_doctor_assignments" USING btree ("staff_user_id","clinic_id","doctor_user_id");
CREATE INDEX IF NOT EXISTS "idx_staff_doctor_by_doctor" ON "staff_doctor_assignments" USING btree ("clinic_id","doctor_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_scopes_user_clinic_unique" ON "staff_scopes" USING btree ("user_id","clinic_id");
CREATE INDEX IF NOT EXISTS "doctor_session_overrides_lookup_idx" ON "doctor_session_overrides" USING btree ("doctor_id","for_date","type","session_start","created_at");
CREATE INDEX IF NOT EXISTS "visiting_requests_clinic_status_idx" ON "visiting_requests" USING btree ("clinic_id","status");
