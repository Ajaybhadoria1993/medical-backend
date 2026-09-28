CREATE TYPE "public"."booking_source" AS ENUM('mobile_app', 'web_portal', 'phone_call', 'walk_in', 'system');--> statement-breakpoint
CREATE TYPE "public"."common_symptoms" AS ENUM('Fever', 'Headache', 'Body_Pain', 'Fatigue', 'Weakness', 'Loss_of_Appetite', 'Nausea', 'Dizziness', 'Cough', 'Sore_Throat', 'Chills', 'Sweating', 'Sleep_Disturbance');--> statement-breakpoint
CREATE TYPE "public"."no_show_marked_by" AS ENUM('doctor', 'receptionist', 'system', 'admin');--> statement-breakpoint
CREATE TYPE "public"."apointment_status" AS ENUM('Upcoming', 'Completed', 'Cancelled', 'Rescheduled', 'Pending', 'Missed', 'Confirmed', 'Patient Arrived', 'NoShow');--> statement-breakpoint
CREATE TYPE "public"."appointment_activity_action" AS ENUM('CREATED', 'UPDATED', 'CONFIRMED', 'COMPLETED', 'STATUS_CHANGED', 'PAYMENT_STATUS', 'VITALS_UPDATED', 'RESCHEDULED', 'PATIENT_ARRIVED', 'CANCELLED', 'NOTES_ADDED', 'REMINDER_SENT', 'TEST_PRESCRIBED', 'PRESCRIPTION_CREATED', 'PRESCRIPTION_UPDATED', 'TEST_REPORT_UPLOADED');--> statement-breakpoint
CREATE TYPE "public"."action_taken" AS ENUM('warning', 'penalty', 'advance_required', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."marked_by_role" AS ENUM('doctor', 'receptionist', 'system', 'admin');--> statement-breakpoint
CREATE TYPE "public"."penalty_type" AS ENUM('fixed', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."banner_placement" AS ENUM('DASHBOARD_TOP', 'DASHBOARD_SIDEBAR', 'INSIGHTS_WIDGET', 'APPOINTMENT_HEADER', 'LOGIN_PAGE', 'BILLING_PAGE');--> statement-breakpoint
CREATE TYPE "public"."banner_priority" AS ENUM('P0', 'P1', 'P2', 'P3');--> statement-breakpoint
CREATE TYPE "public"."banner_status" AS ENUM('Active', 'Paused', 'Scheduled', 'Expired', 'Draft');--> statement-breakpoint
CREATE TYPE "public"."banner_type" AS ENUM('Referral', 'MedicineSpotlight', 'OperationalAlert', 'FeatureAnnouncement', 'PromotionalOffer', 'SystemAlert');--> statement-breakpoint
CREATE TYPE "public"."clinic_symptom_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."appointment_plain_status" AS ENUM('active', 'inactive', 'paused', 'trial', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."clinic_onboarding_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."clinic_status" AS ENUM('Active', 'Inactive', 'Blocked');--> statement-breakpoint
CREATE TYPE "public"."payment_mode_enum" AS ENUM('cash', 'upi', 'card', 'insurance');--> statement-breakpoint
CREATE TYPE "public"."payment_status_enum" AS ENUM('paid', 'pending', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."reminder_time_unit" AS ENUM('Minutes', 'Hours', 'Days');--> statement-breakpoint
CREATE TYPE "public"."lab_catalog_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."lab_status" AS ENUM('Active', 'Inactive', 'Blocked', 'New');--> statement-breakpoint
CREATE TYPE "public"."lab_parameter_source_type" AS ENUM('DEFAULT', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."lab_result_flag" AS ENUM('Low', 'Normal', 'High', 'Abnormal', 'Not Applicable');--> statement-breakpoint
CREATE TYPE "public"."lab_result_status" AS ENUM('Draft', 'Completed', 'Verified');--> statement-breakpoint
CREATE TYPE "public"."lab_sample_status" AS ENUM('NOT_STARTED', 'SAMPLE_COLLECTION_PENDING', 'SAMPLE_COLLECTED', 'SAMPLE_RECEIVED_AT_LAB', 'SAMPLE_PROCESSING', 'TESTING_IN_PROGRESS', 'QUALITY_CHECK', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."medicine_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."pharmacy_subscription_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pharmacy_stock_payment_status" AS ENUM('paid', 'unpaid', 'partial');--> statement-breakpoint
CREATE TYPE "public"."supplier_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."pharmacy_no_loss" AS ENUM('true', 'false');--> statement-breakpoint
CREATE TYPE "public"."pharmacy_status" AS ENUM('active', 'deactive');--> statement-breakpoint
CREATE TYPE "public"."prescription_status" AS ENUM('PENDING', 'ON_HOLD', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('Uploaded', 'Pendig', 'Approved', 'Rejected', 'Reviewed', 'Completed', 'Shared');--> statement-breakpoint
CREATE TYPE "public"."applies_to" AS ENUM('all', 'plans', 'addons', 'specific_plans', 'specific_addons');--> statement-breakpoint
CREATE TYPE "public"."coupon_status" AS ENUM('active', 'inactive', 'expired');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('percentage', 'fixed', 'trial');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."test_report_status" AS ENUM('Initiated', 'InProgress', 'Completed');--> statement-breakpoint
CREATE TYPE "public"."lab_test_source" AS ENUM('master', 'custom');--> statement-breakpoint
CREATE TYPE "public"."lab_tests_status" AS ENUM('active', 'deactive', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."patients_test_status" AS ENUM('active', 'deactive');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."token_type" AS ENUM('email_verification', 'password_reset', 'registration_verification', 'registration_session', 'set_initial_password', 'patient_otp');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('Active', 'Inactive', 'Blocked', 'New', 'Pending', 'Reviewing', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('Admin', 'User', 'Super_Admin', 'Doctor', 'Receptionist', 'Nurse', 'Patient', 'Pharmacist', 'Lab_Assistant', 'Radiologist');--> statement-breakpoint
CREATE TABLE "appointment_clinical_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"common_symptoms" "common_symptoms"[] DEFAULT '{}',
	"clinic_symptom_ids" uuid[] DEFAULT '{}',
	"appointment_notes" text,
	"vitals_list" json,
	"referrals" json,
	"consent_notes" text,
	"consent_file" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "appointment_clinical_data_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE "appointment_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"payment_mode" varchar,
	"payment_status" varchar DEFAULT 'Paid',
	"price" numeric(12, 2),
	"primary_service_price" numeric(12, 2),
	"payment_notes" varchar,
	"transaction_id" varchar(255),
	"gateway_order_id" varchar(255),
	"gateway_response" jsonb,
	"refund_mode" varchar,
	"refunded_amount" varchar,
	"refund_notes" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "appointment_payments_appointment_id_unique" UNIQUE("appointment_id"),
	CONSTRAINT "appointment_payments_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_type" varchar NOT NULL,
	"appointment_date" timestamp NOT NULL,
	"appointment_time" varchar,
	"token_no" integer,
	"appointment_status" "apointment_status" DEFAULT 'Upcoming' NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid,
	"clinic_service_id" uuid,
	"clinic_cancellation_policy_id" uuid,
	"appointment_duration_minutes" varchar,
	"reason_for_cancellation" text,
	"reason_for_reschedule" text,
	"no_show_marked_by" "no_show_marked_by",
	"booking_source" "booking_source" DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "appointment_activity_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"action" "appointment_activity_action" NOT NULL,
	"performed_by" uuid,
	"previous_state" jsonb,
	"new_state" jsonb,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_multiple_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid,
	"price" varchar(10),
	"payment_mode" varchar(20) DEFAULT 'Cash',
	"payment_notes" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "appointment_no_show_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid,
	"clinic_id" uuid NOT NULL,
	"marked_by_role" "marked_by_role" NOT NULL,
	"marked_by_user_id" uuid,
	"reason" text,
	"policy_snapshot" json,
	"action_taken" "action_taken" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_gallery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "doctor_manual_prescription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"doctor_manual_prescription" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medical_certificate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"medical_condition" text,
	"rest_days" integer,
	"notes" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "no_show_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"grace_period_minutes" integer DEFAULT 15 NOT NULL,
	"rules" json DEFAULT '[]'::json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "no_show_policies_clinic_id_unique" UNIQUE("clinic_id")
);
--> statement-breakpoint
CREATE TABLE "patient_gallery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "app_update_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_name" varchar(50) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"force_update" boolean DEFAULT false NOT NULL,
	"store_url" varchar(2048) DEFAULT '' NOT NULL,
	"latest_version" varchar(50) NOT NULL,
	"minimum_version" varchar(50) DEFAULT '1.0.0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banner_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"banner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"clinic_id" uuid,
	"event_type" varchar(50) NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banner_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"banner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dismissed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"banner_type" "banner_type" NOT NULL,
	"priority" "banner_priority" NOT NULL,
	"placement" "banner_placement" NOT NULL,
	"cta_text" varchar(100),
	"cta_url" varchar(2048),
	"image_url" varchar(2048),
	"thumbnail_url" varchar(2048),
	"image_alt" varchar(255),
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"target_roles" text[],
	"target_clinics" uuid[],
	"target_specialties" text[],
	"is_sponsored" boolean DEFAULT false NOT NULL,
	"is_dismissible" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" "banner_status" DEFAULT 'Draft' NOT NULL,
	"display_order" integer DEFAULT 0,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "application_cancellation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cancellation_feature_enabled" boolean DEFAULT true NOT NULL,
	"refund_feature_enabled" boolean DEFAULT true NOT NULL,
	"reschedule_feature_enabled" boolean DEFAULT true NOT NULL,
	"policy_precedence" varchar(50) DEFAULT 'Application > Clinic' NOT NULL,
	"allow_clinic_configuration" boolean DEFAULT true NOT NULL,
	"default_refund_percentage" integer DEFAULT 100 NOT NULL,
	"default_refund_cooldown_hours" integer DEFAULT 24 NOT NULL,
	"partial_refund_cooldown_hours" integer DEFAULT 12 NOT NULL,
	"partial_refund_percentage" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cancellation_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"clinic_id" uuid,
	"user_id" uuid,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cancellation_request_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"refund_type" varchar(50) NOT NULL,
	"original_price" numeric(12, 2) NOT NULL,
	"refund_amount" numeric(12, 2) NOT NULL,
	"refund_status" varchar(50) DEFAULT 'Pending' NOT NULL,
	"gateway_refund_id" varchar(255),
	"gateway_response" jsonb,
	"failure_reason" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cancellation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"user_role" varchar(50) NOT NULL,
	"reason_code" varchar(50) NOT NULL,
	"comments" varchar(500),
	"is_reschedule_request" boolean DEFAULT false NOT NULL,
	"status" varchar(50) DEFAULT 'Approved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_cancellation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"allow_patient_cancel" boolean DEFAULT true NOT NULL,
	"allow_doctor_cancel" boolean DEFAULT true NOT NULL,
	"allow_receptionist_cancel" boolean DEFAULT true NOT NULL,
	"allow_clinic_admin_cancel" boolean DEFAULT true NOT NULL,
	"window_online_hours" integer DEFAULT 24 NOT NULL,
	"window_offline_hours" integer DEFAULT 12 NOT NULL,
	"daily_limit_per_patient" integer DEFAULT 3 NOT NULL,
	"weekly_limit_per_patient" integer DEFAULT 10 NOT NULL,
	"monthly_limit_per_patient" integer DEFAULT 30 NOT NULL,
	"cooldown_seconds_between_cancellations" integer DEFAULT 1800 NOT NULL,
	"reason_mandatory" boolean DEFAULT true NOT NULL,
	"allow_additional_comments" boolean DEFAULT true NOT NULL,
	"min_comment_length" integer DEFAULT 0 NOT NULL,
	"max_comment_length" integer DEFAULT 500 NOT NULL,
	"allow_reschedule" boolean DEFAULT true NOT NULL,
	"max_reschedules" integer DEFAULT 3 NOT NULL,
	"reschedule_window_hours" integer DEFAULT 24 NOT NULL,
	"preserve_payment_on_reschedule" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_symptom_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symptom_id" uuid NOT NULL,
	"date" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_symptoms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"status" "clinic_symptom_status" DEFAULT 'Active' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinc_id" uuid NOT NULL,
	"doctor_subscription_id" uuid NOT NULL,
	"expireAt" timestamp NOT NULL,
	"status" "appointment_plain_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"amount" numeric(10, 2) NOT NULL,
	"payment_status" "payment_status_enum",
	"payment_mode" "payment_mode_enum",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_assign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"day_of_week" varchar NOT NULL,
	"start_time" varchar,
	"end_time" varchar,
	"breaks_start" varchar,
	"breaks_end" varchar,
	"is_available" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"doctor_id" uuid,
	"slotMinutes" integer,
	"stepMinutes" integer,
	"no_of_patients" integer
);
--> statement-breakpoint
CREATE TABLE "clinic_availability_break" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"break_type" varchar NOT NULL,
	"start_time" varchar,
	"end_time" varchar,
	"notes" text,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_date_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"date" timestamp NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"notes" text,
	"slot_minutes" integer,
	"step_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_date_availability_time_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_date_availability_id" uuid NOT NULL,
	"start_time" varchar NOT NULL,
	"end_time" varchar NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"clinic_name" varchar(150) NOT NULL,
	"tagline" varchar,
	"clinic_address" text,
	"clinic_phone" varchar(20),
	"state" varchar,
	"city" varchar,
	"zip_code" integer,
	"clinic_logo" text,
	"latitude" double precision,
	"longitude" double precision,
	"status" "clinic_status" DEFAULT 'Active' NOT NULL,
	"razorpay_account_id" varchar(255),
	"route_status" varchar(50) DEFAULT 'INACTIVE',
	"route_onboarded_at" timestamp,
	"onboarding_status" "clinic_onboarding_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"approval_request_sent" boolean DEFAULT false NOT NULL,
	"current_step" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinics_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"service_name" varchar(250) NOT NULL,
	"price" integer,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"additional_services" text,
	"can_be_booked_by_patient" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"doctor_id" uuid,
	"duration" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "clinic_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"commission_type" varchar(50) DEFAULT 'percentage' NOT NULL,
	"commission_value" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "clinic_commissions_clinic_id_unique" UNIQUE("clinic_id")
);
--> statement-breakpoint
CREATE TABLE "clinic_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"time_value" integer NOT NULL,
	"time_unit" "reminder_time_unit" DEFAULT 'Hours' NOT NULL,
	"reminder_type" varchar(50) DEFAULT 'Appointment' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"voice_call_enabled" boolean DEFAULT false NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"login_alerts_enabled" boolean DEFAULT false NOT NULL,
	"auto_logout_minutes" integer,
	"running_late_threshold_minutes" integer DEFAULT 10,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "clinic_settings_clinic_id_unique" UNIQUE("clinic_id")
);
--> statement-breakpoint
CREATE TABLE "doctor_profile_update_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"requested_data" jsonb NOT NULL,
	"status" text DEFAULT 'pending',
	"reason" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "doctor_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"qualification_type" varchar(20) NOT NULL,
	"qualification_title" varchar(100) NOT NULL,
	"specialization" varchar(100),
	"board_or_university" varchar(150),
	"year_of_completion" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_prescription_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"prescription_type" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "doctor_manual_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"template_image" varchar(256),
	"template_html" text,
	"print_type" varchar(20) DEFAULT 'Without Background',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"header_order" json DEFAULT '["Pathology Test Name","Advice","Dietary Suggestions","Habits","Vitals","Allergy","Diagnosis","Surgery Suggested","Visiting Days","Follow-Up (days)"]'::json,
	"habit_list" json DEFAULT '["Alcohol","Smoking","Tobacco"]'::json,
	"allergy_list" json DEFAULT '["Codeine","Contrast dye","Dust","Eggs","Latex","NKDA","NSAIDs","Peanuts/Nuts","Penicillin","Pollen","Shellfish","Sulfa drugs"]'::json,
	"diagnosis_list" json DEFAULT '["Acidity","Allergy","Body pain","Cold/Cough","Dengue","Diarrhea","Fever","Flu","Headache","High BP","Low BP","Infection","Malaria","Migraine","Stomach pain","Diabetes","Typhoid","UTI","Viral fever"]'::json,
	"surgery_suggested_list" json DEFAULT '["Appendectomy","Hernia repair","Cataract surgery","Tonsillectomy","Cholecystectomy","Knee arthroscopy"]'::json,
	"dietary_suggestions_list" json DEFAULT '["Drink boiled water.","Eat small, frequent meals.","Avoid spicy and oily foods.","Include fruits and vegetables.","Stay hydrated throughout the day.","Limit caffeine and alcohol.","Reduce salt and sugar intake.","Include protein-rich foods.","Avoid processed and junk foods.","Maintain a balanced diet."]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_preferences_doctor_id_unique" UNIQUE("doctor_id")
);
--> statement-breakpoint
CREATE TABLE "doctor_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"review_text" varchar(1000),
	"status" varchar(32) DEFAULT 'approved' NOT NULL,
	"reply_text" text,
	"reply_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "doctor_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"template_html" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid,
	"doctor_id" uuid,
	"appointment_id" uuid,
	"rating" integer NOT NULL,
	"comments" text,
	"attachments" text[],
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"status" varchar(32) DEFAULT 'new' NOT NULL,
	"tags" jsonb[],
	"response" text,
	"response_by" uuid,
	"response_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lab_departments_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(80) NOT NULL,
	"status" "lab_catalog_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar NOT NULL,
	"address" text NOT NULL,
	"contact_no" varchar NOT NULL,
	"email" varchar NOT NULL,
	"logo" text,
	"gst_number" varchar(50),
	"report_footer" text,
	"deleted_at" timestamp,
	"lab_status" "lab_status" DEFAULT 'New' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_lab_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(40) NOT NULL,
	"appointment_test_id" uuid NOT NULL,
	"test_id" uuid,
	"clinic_id" uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"patient_id" uuid,
	"doctor_id" uuid,
	"created_by" uuid,
	"payment_method" varchar(30) NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_order_result_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"parameter_id" uuid NOT NULL,
	"parameter_name_snapshot" varchar(255) NOT NULL,
	"display_name_snapshot" varchar(255),
	"value" text NOT NULL,
	"section_name_snapshot" varchar(255),
	"unit_snapshot" varchar(80),
	"reference_range_snapshot" varchar(255),
	"input_type_snapshot" varchar(50),
	"sort_order_snapshot" integer,
	"is_required_snapshot" boolean,
	"source_type_snapshot" "lab_parameter_source_type" DEFAULT 'DEFAULT' NOT NULL,
	"is_custom_snapshot" boolean DEFAULT false NOT NULL,
	"flag" "lab_result_flag" DEFAULT 'Not Applicable' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_order_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_order_id" uuid NOT NULL,
	"appointment_test_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"status" "lab_result_status" DEFAULT 'Draft' NOT NULL,
	"entered_by" uuid,
	"verified_by" uuid,
	"verified_at" timestamp,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_report_template_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"base_parameter_id" uuid,
	"lab_id" uuid,
	"section_name" varchar(255),
	"parameter_name" varchar(255) NOT NULL,
	"unit" varchar(80),
	"reference_range" varchar(255),
	"input_type" varchar(50) DEFAULT 'text' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"source_type" "lab_parameter_source_type" DEFAULT 'DEFAULT' NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"sample_type" varchar(100) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"lab_order_id" uuid NOT NULL,
	"appointment_test_id" uuid NOT NULL,
	"patient_id" uuid,
	"test_id" uuid,
	"sample_type" varchar(100),
	"barcode_value" varchar(40) NOT NULL,
	"barcode_type" varchar(20) DEFAULT 'CODE128' NOT NULL,
	"status" "lab_sample_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"collected_by" uuid,
	"collected_at" timestamp,
	"received_at_lab_by" uuid,
	"received_at_lab_at" timestamp,
	"processing_started_at" timestamp,
	"testing_started_at" timestamp,
	"result_verified_at" timestamp,
	"report_ready_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid,
	"name" varchar(255) NOT NULL,
	"sku" varchar(50),
	"generic_name" varchar(255),
	"manufacturer" varchar(255),
	"composition" text,
	"form" varchar(50),
	"strength" varchar(50),
	"category" varchar(100),
	"requires_prescription" boolean DEFAULT false,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_mfa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"encrypted_secret" varchar(512) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_pending" boolean DEFAULT true NOT NULL,
	"enabled_at" timestamp,
	"last_modified_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(255) NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(120) NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "patient_family_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_patient_id" uuid NOT NULL,
	"linked_patient_id" uuid NOT NULL,
	"relationship" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "uq_family_link_pair" UNIQUE("primary_patient_id","linked_patient_id")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"medicine_name" varchar(200) NOT NULL,
	"brand_name" varchar(50),
	"composition" varchar(200),
	"category" varchar(100),
	"hsn_id" uuid NOT NULL,
	"form" varchar(50),
	"shelf" varchar(100),
	"reorder" integer,
	"pack_of" integer,
	"sku" varchar(50),
	"status" "medicine_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_medicine_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid,
	"tag" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_tags_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medicine_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacy_patient_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_name" varchar(50),
	"customer_mobile" varchar(15),
	"customer_address" varchar(100),
	"frequency_days" integer NOT NULL,
	"next_delivery_date" timestamp NOT NULL,
	"status" "pharmacy_subscription_status" DEFAULT 'active' NOT NULL,
	"remarks" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_subscription_medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_patient_subscription_id" uuid NOT NULL,
	"pharmacy_medicine_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_subscription_sales_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_patient_subscription_id" uuid NOT NULL,
	"pharmacy_sales_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"prescription_id" uuid,
	"patient_name" varchar(50),
	"patient_mobile" varchar(15),
	"payment_method" varchar,
	"payment_notes" varchar(100),
	"total_items" integer DEFAULT 0,
	"subtotal" numeric(12, 2) DEFAULT '0',
	"gst_amount" numeric(12, 2) DEFAULT '0',
	"discount_amount" numeric(12, 2) DEFAULT '0',
	"total_amount" numeric(12, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sales_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_sales_id" uuid NOT NULL,
	"pharmacy_stock_medicine_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0,
	"discount_percent" numeric(12, 2) DEFAULT '0',
	"total" numeric(12, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"pharmacy_supplier_id" uuid,
	"purchase_date" timestamp NOT NULL,
	"invoice" varchar,
	"pharmacy_stock_payment_status" "pharmacy_stock_payment_status" NOT NULL,
	"payment_notes" varchar(100),
	"unit" integer DEFAULT 0,
	"total_amount" numeric(12, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_stock_medicine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_stock_id" uuid NOT NULL,
	"pharmacy_medicine_id" uuid NOT NULL,
	"batch" varchar(50),
	"expiry" timestamp,
	"quantity" integer,
	"mrp" numeric(12, 2),
	"cost" numeric(12, 2),
	"total_cost" numeric(12, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"supplier_name" varchar(100) NOT NULL,
	"contact_person" varchar(50) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"email" varchar(60),
	"address" text,
	"gst_number" varchar(30),
	"pan_number" varchar(20),
	"credit_days" integer DEFAULT 0,
	"status" "supplier_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pharmacy_suppliers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "hsn_tax_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hsn_code" varchar(8) NOT NULL,
	"gst_percentage" numeric(5, 2) NOT NULL,
	"description" varchar(255),
	"effective_from" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacy_assign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"user_role" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"address" text NOT NULL,
	"contact_number" varchar(20) NOT NULL,
	"status" "pharmacy_status" DEFAULT 'active' NOT NULL,
	"no_loss" "pharmacy_no_loss" DEFAULT 'true' NOT NULL,
	"subscription_notification_read_date" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prescription_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"pharmacy_user_id" uuid,
	"status" "prescription_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "quick_print_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"selected_template" varchar(50) DEFAULT 'compact-medicine-slip' NOT NULL,
	"font_family" varchar(100) DEFAULT 'Inter, sans-serif',
	"accent_color" varchar(20) DEFAULT '#0A6C74',
	"element_config" jsonb DEFAULT '{"showClinicHeader":true,"showClinicLogo":true,"showPatientName":true,"showPatientUhid":true,"showPatientAge":true,"showPatientGender":true,"showPatientMobile":true,"showPatientAddress":false,"showVisitDate":true,"showDiagnosis":true,"showMedicineTable":true,"showMedicineComposition":true,"showMedicineQuantity":false,"showMedicineInstructions":true,"showAdvice":true,"showFollowUp":true,"showDoctorName":true,"showDoctorQualification":true,"showDoctorRegistration":false,"showDoctorSignature":true,"showQrCode":false,"showFooter":true,"sectionOrder":["clinicHeader","patientInfo","diagnosis","medicineTable","advice","followUp","doctorSignature","footer"]}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quick_print_templates_doctor_id_unique" UNIQUE("doctor_id")
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_card_id" uuid NOT NULL,
	"petient_id" uuid NOT NULL,
	"medicine_id" uuid,
	"prescribed_by" uuid,
	"medicine_name" varchar NOT NULL,
	"composition" varchar,
	"strength" varchar,
	"dosage" varchar NOT NULL,
	"frequency" varchar NOT NULL,
	"duration" varchar NOT NULL,
	"manufacturer" varchar,
	"medicine_count" varchar,
	"marketer" varchar,
	"image_url" text,
	"notes" text,
	"uses" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prescription_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"template_name" varchar(50) NOT NULL,
	"font_family" varchar(100) NOT NULL,
	"color1" varchar(20) NOT NULL,
	"color2" varchar(20) NOT NULL,
	"color3" varchar(20) NOT NULL,
	"color4" varchar(20) NOT NULL,
	"color5" varchar(20) NOT NULL,
	"color6" varchar(20) NOT NULL,
	"color7" varchar(20) NOT NULL,
	"color8" varchar(20) NOT NULL,
	"color9" varchar(20) NOT NULL,
	"color10" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "report_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"petient_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"report_id" uuid,
	"comorbidities" text[],
	"habits" text[],
	"general_examination" text[],
	"system_examination" text,
	"provisional_diagnosis" text,
	"differential_diagnosis" text,
	"final_diagnosis" text,
	"investigations" text,
	"advice" text,
	"clinical_notes" text,
	"allergies" text[],
	"surgerySuggested" text[],
	"visitingDays" text[],
	"visiting_notes" varchar,
	"prescription_pdf" text,
	"follow_up_in_days" varchar,
	"follow_up_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_type" varchar(150) NOT NULL,
	"description" text,
	"petient_id" uuid NOT NULL,
	"report_docs" text NOT NULL,
	"report_status" "report_status" DEFAULT 'Pendig' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "favourite_prescription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"favourite_prescription_name" varchar,
	"medicine" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_notification" boolean DEFAULT false NOT NULL,
	"sms_notification" boolean DEFAULT false NOT NULL,
	"whatsapp_notification" boolean DEFAULT false NOT NULL,
	"appointment_reminder" integer DEFAULT 1 NOT NULL,
	"notification_preferences" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "add_ons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"feature_key" varchar(100) NOT NULL,
	"unit_value" integer DEFAULT 1 NOT NULL,
	"monthly_price" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"yearly_price" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "add_ons_feature_key_unique" UNIQUE("feature_key")
);
--> statement-breakpoint
CREATE TABLE "clinic_add_ons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"add_on_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"billing_cycle" varchar(20) NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"provider" varchar(80),
	"provider_subscription_id" varchar(200),
	"payment_status" varchar(20) DEFAULT 'pending',
	"payment_mode" varchar(20),
	"transaction_id" varchar(100),
	"price" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp,
	"cancellation_reason" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"feature_key" varchar(100) NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"discount_type" "discount_type" NOT NULL,
	"discount_value" numeric(10, 2) NOT NULL,
	"max_discount_amount" numeric(10, 2),
	"trial_days" integer,
	"applies_to" "applies_to" DEFAULT 'all' NOT NULL,
	"applicable_plan_ids" jsonb,
	"applicable_addon_ids" jsonb,
	"max_uses" integer,
	"max_uses_per_clinic" integer DEFAULT 1,
	"min_order_value" numeric(10, 2),
	"first_time_only" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "coupon_status" DEFAULT 'active' NOT NULL,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "coupon_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"coupon_id" integer NOT NULL,
	"clinic_id" uuid NOT NULL,
	"plan_id" uuid,
	"addon_id" uuid,
	"order_value" numeric(10, 2) NOT NULL,
	"discount_amount" numeric(10, 2) NOT NULL,
	"final_amount" numeric(10, 2) NOT NULL,
	"razorpay_order_id" varchar(255),
	"razorpay_payment_id" varchar(255),
	"billing_cycle" varchar(20),
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"feature_key" varchar(100) NOT NULL,
	"display_name" varchar(150),
	"description" varchar(255),
	"type" varchar(20) DEFAULT 'numeric' NOT NULL,
	"limit_value" integer,
	"is_unlimited" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0,
	"is_marketing_feature" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"provider" varchar(80),
	"provider_subscription_id" varchar(200),
	"payment_status" varchar(20) DEFAULT 'pending',
	"payment_mode" varchar(20),
	"transaction_id" varchar(50),
	"price" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp,
	"cancellation_reason" varchar(255),
	"auto_renew" boolean DEFAULT false NOT NULL,
	"razorpay_subscription_id" varchar(200),
	"scheduled_plan_id" uuid,
	"scheduled_plan_change_at" timestamp,
	"scheduled_provider_subscription_id" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" varchar(255),
	"price" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "subscription_plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "independent_patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"mobile" varchar(20) NOT NULL,
	"age" integer NOT NULL,
	"gender" varchar(50) NOT NULL,
	"doctor_name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lab_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unique_test_id" varchar(20),
	"appointment_id" uuid,
	"test_id" uuid NOT NULL,
	"is_independent" boolean DEFAULT false NOT NULL,
	"independent_patient_id" uuid,
	"patient_id" uuid,
	"doctor_id" uuid,
	"clinic_id" uuid,
	"lab_assistant_id" uuid,
	"test_report_status" "test_report_status" DEFAULT 'Initiated' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"price" integer DEFAULT 0,
	"report_pdf" text,
	"workflow_status" varchar(50) DEFAULT 'INITIATED' NOT NULL,
	"sample_status" varchar(50) DEFAULT 'NOT_STARTED',
	"on_hold_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"payment_collected_at" timestamp,
	"payment_collected_by" uuid,
	"sample_collected_at" timestamp,
	"sample_received_at" timestamp,
	"processing_started_at" timestamp,
	"testing_started_at" timestamp,
	"quality_checked_at" timestamp,
	"expected_report_ready_at" timestamp,
	"ready_for_report_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lab_order_tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"appointment_test_id" uuid NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"actor_user_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_test_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"test_code" varchar(100),
	"category" varchar(100),
	"price" integer,
	"clinic_id" uuid,
	"lab_id" uuid,
	"department_id" uuid,
	"sample_type" varchar(100),
	"created_by" uuid,
	"updated_by" uuid,
	"source" "lab_test_source" DEFAULT 'custom' NOT NULL,
	"status" "lab_tests_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "test_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(100),
	"clinic_id" uuid,
	"doctor_id" uuid,
	"lab_test_id" uuid,
	"price" integer,
	"status" "patients_test_status" DEFAULT 'active' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referred_to" uuid,
	"referred_by" uuid,
	"referral_code" varchar NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"comments" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "referrals_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" varchar(255),
	"token_hash" varchar(200) NOT NULL,
	"type" "token_type" NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150),
	"email" varchar,
	"mobile" varchar,
	"password" varchar,
	"social_provider" varchar(40),
	"social_provider_id" varchar(255),
	"user_type" "user_type" NOT NULL,
	"user_status" "user_status" DEFAULT 'Active' NOT NULL,
	"email_verified_at" timestamp,
	"is_user_blocked" boolean DEFAULT false,
	"is_admin_doctor_access" boolean DEFAULT false NOT NULL,
	"is_archive" boolean DEFAULT false NOT NULL,
	"payment_visible" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_token" varchar(255) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"sns_endpoint_arn" varchar(500) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_devices_device_token_unique" UNIQUE("device_token")
);
--> statement-breakpoint
CREATE TABLE "user_professionals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"qualification" text,
	"years_of_experience" integer,
	"license_number" text,
	"speciality" text,
	"registration_number" varchar(100),
	"about" varchar(1000),
	"average_rating" numeric(3, 2) DEFAULT '0.00' NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_professionals_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"alternate_mobile" varchar,
	"gender" varchar,
	"address" text,
	"city" varchar,
	"state" varchar,
	"zip_code" varchar(10),
	"profile_image" text,
	"age" integer,
	"dob" varchar(20),
	"upi_ids" jsonb,
	"blood_group" varchar(5),
	"height" varchar(10),
	"weight" varchar(10),
	"allergies" jsonb,
	"chronic_conditions" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "appointment_clinical_data" ADD CONSTRAINT "appointment_clinical_data_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD CONSTRAINT "appointment_payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_service_id_clinics_service_id_fk" FOREIGN KEY ("clinic_service_id") REFERENCES "public"."clinics_service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_cancellation_policy_id_clinic_cancellation_policies_id_fk" FOREIGN KEY ("clinic_cancellation_policy_id") REFERENCES "public"."clinic_cancellation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_activity_history" ADD CONSTRAINT "appointment_activity_history_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_activity_history" ADD CONSTRAINT "appointment_activity_history_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_multiple_service" ADD CONSTRAINT "appointment_multiple_service_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_multiple_service" ADD CONSTRAINT "appointment_multiple_service_service_id_clinics_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."clinics_service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_no_show_actions" ADD CONSTRAINT "appointment_no_show_actions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_no_show_actions" ADD CONSTRAINT "appointment_no_show_actions_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_no_show_actions" ADD CONSTRAINT "appointment_no_show_actions_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_no_show_actions" ADD CONSTRAINT "appointment_no_show_actions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_no_show_actions" ADD CONSTRAINT "appointment_no_show_actions_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_gallery" ADD CONSTRAINT "doctor_gallery_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_manual_prescription" ADD CONSTRAINT "doctor_manual_prescription_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_certificate" ADD CONSTRAINT "medical_certificate_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "no_show_policies" ADD CONSTRAINT "no_show_policies_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_gallery" ADD CONSTRAINT "patient_gallery_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_gallery" ADD CONSTRAINT "patient_gallery_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_gallery" ADD CONSTRAINT "patient_gallery_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_analytics" ADD CONSTRAINT "banner_analytics_banner_id_banners_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."banners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_analytics" ADD CONSTRAINT "banner_analytics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_analytics" ADD CONSTRAINT "banner_analytics_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_dismissals" ADD CONSTRAINT "banner_dismissals_banner_id_banners_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."banners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_dismissals" ADD CONSTRAINT "banner_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_audits" ADD CONSTRAINT "cancellation_audits_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_audits" ADD CONSTRAINT "cancellation_audits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refunds" ADD CONSTRAINT "cancellation_refunds_cancellation_request_id_cancellation_requests_id_fk" FOREIGN KEY ("cancellation_request_id") REFERENCES "public"."cancellation_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refunds" ADD CONSTRAINT "cancellation_refunds_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refunds" ADD CONSTRAINT "cancellation_refunds_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refunds" ADD CONSTRAINT "cancellation_refunds_payment_id_appointment_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."appointment_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_cancellation_policies" ADD CONSTRAINT "clinic_cancellation_policies_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_symptom_counts" ADD CONSTRAINT "clinic_symptom_counts_symptom_id_clinic_symptoms_id_fk" FOREIGN KEY ("symptom_id") REFERENCES "public"."clinic_symptoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_symptoms" ADD CONSTRAINT "clinic_symptoms_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_clinc_id_clinics_id_fk" FOREIGN KEY ("clinc_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_doctor_subscription_id_clinics_service_id_fk" FOREIGN KEY ("doctor_subscription_id") REFERENCES "public"."clinics_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_assign" ADD CONSTRAINT "clinic_assign_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_assign" ADD CONSTRAINT "clinic_assign_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_availability" ADD CONSTRAINT "clinic_availability_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_availability" ADD CONSTRAINT "clinic_availability_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_availability_break" ADD CONSTRAINT "clinic_availability_break_clinic_id_clinic_availability_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinic_availability"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_date_availability" ADD CONSTRAINT "clinic_date_availability_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_date_availability" ADD CONSTRAINT "clinic_date_availability_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_date_availability_time_slots" ADD CONSTRAINT "clinic_date_availability_time_slots_clinic_date_availability_id_clinic_date_availability_id_fk" FOREIGN KEY ("clinic_date_availability_id") REFERENCES "public"."clinic_date_availability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinics_service" ADD CONSTRAINT "clinics_service_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinics_service" ADD CONSTRAINT "clinics_service_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD CONSTRAINT "clinic_commissions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_reminders" ADD CONSTRAINT "clinic_reminders_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profile_update_requests" ADD CONSTRAINT "doctor_profile_update_requests_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profile_update_requests" ADD CONSTRAINT "doctor_profile_update_requests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_favorites" ADD CONSTRAINT "doctor_favorites_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_favorites" ADD CONSTRAINT "doctor_favorites_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_qualifications" ADD CONSTRAINT "doctor_qualifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_prescription_type" ADD CONSTRAINT "doctor_prescription_type_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_manual_template" ADD CONSTRAINT "doctor_manual_template_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_preferences" ADD CONSTRAINT "doctor_preferences_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_template" ADD CONSTRAINT "doctor_template_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_response_by_users_id_fk" FOREIGN KEY ("response_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_departments" ADD CONSTRAINT "lab_departments_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_departments" ADD CONSTRAINT "lab_departments_department_id_lab_departments_master_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."lab_departments_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lab_assignments" ADD CONSTRAINT "user_lab_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lab_assignments" ADD CONSTRAINT "user_lab_assignments_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lab_assignments" ADD CONSTRAINT "user_lab_assignments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_invoices" ADD CONSTRAINT "lab_invoices_appointment_test_id_lab_orders_id_fk" FOREIGN KEY ("appointment_test_id") REFERENCES "public"."lab_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_invoices" ADD CONSTRAINT "lab_invoices_test_id_test_catalog_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."test_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_invoices" ADD CONSTRAINT "lab_invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_invoices" ADD CONSTRAINT "lab_invoices_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_invoices" ADD CONSTRAINT "lab_invoices_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_invoices" ADD CONSTRAINT "lab_invoices_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_invoices" ADD CONSTRAINT "lab_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_result_values" ADD CONSTRAINT "lab_order_result_values_result_id_lab_order_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."lab_order_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_result_values" ADD CONSTRAINT "lab_order_result_values_parameter_id_lab_report_template_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_report_template_parameters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_results" ADD CONSTRAINT "lab_order_results_lab_order_id_lab_orders_id_fk" FOREIGN KEY ("lab_order_id") REFERENCES "public"."lab_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_results" ADD CONSTRAINT "lab_order_results_appointment_test_id_lab_orders_id_fk" FOREIGN KEY ("appointment_test_id") REFERENCES "public"."lab_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_results" ADD CONSTRAINT "lab_order_results_template_id_lab_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lab_report_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_results" ADD CONSTRAINT "lab_order_results_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_results" ADD CONSTRAINT "lab_order_results_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD CONSTRAINT "lab_report_template_parameters_template_id_lab_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lab_report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD CONSTRAINT "lab_report_template_parameters_base_parameter_id_lab_report_template_parameters_id_fk" FOREIGN KEY ("base_parameter_id") REFERENCES "public"."lab_report_template_parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD CONSTRAINT "lab_report_template_parameters_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD CONSTRAINT "lab_report_template_parameters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD CONSTRAINT "lab_report_template_parameters_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_templates" ADD CONSTRAINT "lab_report_templates_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_lab_order_id_lab_orders_id_fk" FOREIGN KEY ("lab_order_id") REFERENCES "public"."lab_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_appointment_test_id_lab_orders_id_fk" FOREIGN KEY ("appointment_test_id") REFERENCES "public"."lab_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_test_id_test_catalog_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."test_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_received_at_lab_by_users_id_fk" FOREIGN KEY ("received_at_lab_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_recovery_codes" ADD CONSTRAINT "user_mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_family_links" ADD CONSTRAINT "patient_family_links_primary_patient_id_users_id_fk" FOREIGN KEY ("primary_patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_family_links" ADD CONSTRAINT "patient_family_links_linked_patient_id_users_id_fk" FOREIGN KEY ("linked_patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_medicines" ADD CONSTRAINT "pharmacy_medicines_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_medicines" ADD CONSTRAINT "pharmacy_medicines_hsn_id_hsn_tax_master_id_fk" FOREIGN KEY ("hsn_id") REFERENCES "public"."hsn_tax_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_medicine_tags" ADD CONSTRAINT "pharmacy_medicine_tags_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_tags_map" ADD CONSTRAINT "pharmacy_tags_map_medicine_id_pharmacy_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_tags_map" ADD CONSTRAINT "pharmacy_tags_map_tag_id_pharmacy_medicine_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."pharmacy_medicine_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_patient_subscription" ADD CONSTRAINT "pharmacy_patient_subscription_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_patient_subscription" ADD CONSTRAINT "pharmacy_patient_subscription_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_medicines" ADD CONSTRAINT "pharmacy_subscription_medicines_pharmacy_patient_subscription_id_pharmacy_patient_subscription_id_fk" FOREIGN KEY ("pharmacy_patient_subscription_id") REFERENCES "public"."pharmacy_patient_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_medicines" ADD CONSTRAINT "pharmacy_subscription_medicines_pharmacy_medicine_id_pharmacy_medicines_id_fk" FOREIGN KEY ("pharmacy_medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_sales_map" ADD CONSTRAINT "pharmacy_subscription_sales_map_pharmacy_patient_subscription_id_pharmacy_patient_subscription_id_fk" FOREIGN KEY ("pharmacy_patient_subscription_id") REFERENCES "public"."pharmacy_patient_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_sales_map" ADD CONSTRAINT "pharmacy_subscription_sales_map_pharmacy_sales_id_pharmacy_sales_id_fk" FOREIGN KEY ("pharmacy_sales_id") REFERENCES "public"."pharmacy_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_prescription_id_prescription_queue_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescription_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_items" ADD CONSTRAINT "pharmacy_sales_items_pharmacy_sales_id_pharmacy_sales_id_fk" FOREIGN KEY ("pharmacy_sales_id") REFERENCES "public"."pharmacy_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_items" ADD CONSTRAINT "pharmacy_sales_items_pharmacy_stock_medicine_id_pharmacy_stock_medicine_id_fk" FOREIGN KEY ("pharmacy_stock_medicine_id") REFERENCES "public"."pharmacy_stock_medicine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock" ADD CONSTRAINT "pharmacy_stock_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock" ADD CONSTRAINT "pharmacy_stock_pharmacy_supplier_id_pharmacy_suppliers_id_fk" FOREIGN KEY ("pharmacy_supplier_id") REFERENCES "public"."pharmacy_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock_medicine" ADD CONSTRAINT "pharmacy_stock_medicine_pharmacy_stock_id_pharmacy_stock_id_fk" FOREIGN KEY ("pharmacy_stock_id") REFERENCES "public"."pharmacy_stock"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock_medicine" ADD CONSTRAINT "pharmacy_stock_medicine_pharmacy_medicine_id_pharmacy_medicines_id_fk" FOREIGN KEY ("pharmacy_medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_suppliers" ADD CONSTRAINT "pharmacy_suppliers_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_assign" ADD CONSTRAINT "pharmacy_assign_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_assign" ADD CONSTRAINT "pharmacy_assign_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_assign" ADD CONSTRAINT "pharmacy_assign_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_queue" ADD CONSTRAINT "prescription_queue_report_id_report_cards_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_queue" ADD CONSTRAINT "prescription_queue_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_queue" ADD CONSTRAINT "prescription_queue_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_queue" ADD CONSTRAINT "prescription_queue_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_queue" ADD CONSTRAINT "prescription_queue_pharmacy_user_id_users_id_fk" FOREIGN KEY ("pharmacy_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_print_templates" ADD CONSTRAINT "quick_print_templates_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_report_card_id_report_cards_id_fk" FOREIGN KEY ("report_card_id") REFERENCES "public"."report_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_petient_id_users_id_fk" FOREIGN KEY ("petient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescribed_by_users_id_fk" FOREIGN KEY ("prescribed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_templates" ADD CONSTRAINT "prescription_templates_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_petient_id_users_id_fk" FOREIGN KEY ("petient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_petient_id_users_id_fk" FOREIGN KEY ("petient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourite_prescription" ADD CONSTRAINT "favourite_prescription_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_add_ons" ADD CONSTRAINT "clinic_add_ons_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_subscriptions" ADD CONSTRAINT "clinic_subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_subscriptions" ADD CONSTRAINT "clinic_subscriptions_scheduled_plan_id_subscription_plans_id_fk" FOREIGN KEY ("scheduled_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_test_id_test_catalog_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."test_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_independent_patient_id_independent_patients_id_fk" FOREIGN KEY ("independent_patient_id") REFERENCES "public"."independent_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_lab_assistant_id_users_id_fk" FOREIGN KEY ("lab_assistant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_payment_collected_by_users_id_fk" FOREIGN KEY ("payment_collected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_tracking_events" ADD CONSTRAINT "lab_order_tracking_events_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_tracking_events" ADD CONSTRAINT "lab_order_tracking_events_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_tracking_events" ADD CONSTRAINT "lab_order_tracking_events_appointment_test_id_lab_orders_id_fk" FOREIGN KEY ("appointment_test_id") REFERENCES "public"."lab_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_tracking_events" ADD CONSTRAINT "lab_order_tracking_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_catalog" ADD CONSTRAINT "lab_test_catalog_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_catalog" ADD CONSTRAINT "lab_test_catalog_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_catalog" ADD CONSTRAINT "lab_test_catalog_department_id_lab_departments_master_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."lab_departments_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_catalog" ADD CONSTRAINT "lab_test_catalog_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_catalog" ADD CONSTRAINT "lab_test_catalog_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_catalog" ADD CONSTRAINT "test_catalog_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_catalog" ADD CONSTRAINT "test_catalog_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_catalog" ADD CONSTRAINT "test_catalog_lab_test_id_lab_test_catalog_id_fk" FOREIGN KEY ("lab_test_id") REFERENCES "public"."lab_test_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_to_users_id_fk" FOREIGN KEY ("referred_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_professionals" ADD CONSTRAINT "user_professionals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_idx" ON "appointment_payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_unique" ON "appointments" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "appointments_appointment_date_idx" ON "appointments" USING btree ("appointment_date");--> statement-breakpoint
CREATE INDEX "appointments_clinic_status_date_idx" ON "appointments" USING btree ("clinic_id","appointment_status","appointment_date");--> statement-breakpoint
CREATE INDEX "appointments_doctor_date_idx" ON "appointments" USING btree ("doctor_id","appointment_date");--> statement-breakpoint
CREATE INDEX "no_show_patient_idx" ON "appointment_no_show_actions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "no_show_appointment_idx" ON "appointment_no_show_actions" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_app_update_app_platform" ON "app_update_config" USING btree ("app_name","platform");--> statement-breakpoint
CREATE INDEX "banner_analytics_banner_idx" ON "banner_analytics" USING btree ("banner_id");--> statement-breakpoint
CREATE INDEX "banner_analytics_user_idx" ON "banner_analytics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "banner_analytics_event_idx" ON "banner_analytics" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "banner_analytics_occurred_idx" ON "banner_analytics" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "banner_dismissal_user_idx" ON "banner_dismissals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "banner_dismissal_banner_idx" ON "banner_dismissals" USING btree ("banner_id");--> statement-breakpoint
CREATE INDEX "banner_status_idx" ON "banners" USING btree ("status");--> statement-breakpoint
CREATE INDEX "banner_type_idx" ON "banners" USING btree ("banner_type");--> statement-breakpoint
CREATE INDEX "banner_placement_idx" ON "banners" USING btree ("placement");--> statement-breakpoint
CREATE INDEX "banner_start_end_idx" ON "banners" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_active_policy" ON "clinic_cancellation_policies" USING btree ("clinic_id") WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "symptom_date_idx" ON "clinic_symptom_counts" USING btree ("symptom_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "user_clinic_unique" ON "clinic_assign" USING btree ("user_id","clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_day" ON "clinic_availability" USING btree ("clinic_id","day_of_week","doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_break" ON "clinic_availability_break" USING btree ("clinic_id","break_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_doctor_date" ON "clinic_date_availability" USING btree ("clinic_id","doctor_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_date_time_slot" ON "clinic_date_availability_time_slots" USING btree ("clinic_date_availability_id","start_time","end_time");--> statement-breakpoint
CREATE UNIQUE INDEX "user_unique" ON "clinics" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_service_unique" ON "clinics_service" USING btree ("clinic_id","service_name","doctor_id");--> statement-breakpoint
CREATE INDEX "idx_doctor_update_requests_doctor_id" ON "doctor_profile_update_requests" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_doctor_update_requests_status" ON "doctor_profile_update_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_doctor_update_requests_clinic_status" ON "doctor_profile_update_requests" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_doctor_favorite_patient_doctor" ON "doctor_favorites" USING btree ("patient_id","doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_doctor_qualification_user" ON "doctor_qualifications" USING btree ("user_id","qualification_title","specialization");--> statement-breakpoint
CREATE INDEX "doctor_reviews_doctor_id_idx" ON "doctor_reviews" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_reviews_patient_id_idx" ON "doctor_reviews" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_doctor_reviews_appointment" ON "doctor_reviews" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_departments_master_code_unique" ON "lab_departments_master" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_lab_departments_master_status" ON "lab_departments_master" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lab_departments_master_name" ON "lab_departments_master" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_dept_unique" ON "lab_departments" USING btree ("lab_id","department_id");--> statement-breakpoint
CREATE INDEX "idx_lab_departments_department_id" ON "lab_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_labs_clinic_id" ON "labs" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_lab_assignments_user_lab_clinic_unique" ON "user_lab_assignments" USING btree ("user_id","lab_id","clinic_id");--> statement-breakpoint
CREATE INDEX "idx_user_lab_assignments_lab_id" ON "user_lab_assignments" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_user_lab_assignments_user_id" ON "user_lab_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_invoices_invoice_number_unique" ON "lab_invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_invoices_appointment_test_unique" ON "lab_invoices" USING btree ("appointment_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_lab_id" ON "lab_invoices" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_clinic_id" ON "lab_invoices" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_test_id" ON "lab_invoices" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_created_at" ON "lab_invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_patient_id" ON "lab_invoices" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_doctor_id" ON "lab_invoices" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_result_values_result_id" ON "lab_order_result_values" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_result_values_parameter_id" ON "lab_order_result_values" USING btree ("parameter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_order_result_values_result_parameter" ON "lab_order_result_values" USING btree ("result_id","parameter_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_results_lab_order_id" ON "lab_order_results" USING btree ("lab_order_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_results_appointment_test_id" ON "lab_order_results" USING btree ("appointment_test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_order_results_order_test_template" ON "lab_order_results" USING btree ("lab_order_id","appointment_test_id","template_id");--> statement-breakpoint
CREATE INDEX "idx_lab_report_template_parameters_template_id" ON "lab_report_template_parameters" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_lab_report_template_parameters_lab_id" ON "lab_report_template_parameters" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_report_template_parameters_base_parameter_id" ON "lab_report_template_parameters" USING btree ("base_parameter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_report_template_parameters_default_override" ON "lab_report_template_parameters" USING btree ("template_id","lab_id","created_by","base_parameter_id") WHERE "lab_report_template_parameters"."lab_id" IS NOT NULL AND "lab_report_template_parameters"."source_type" = 'DEFAULT' AND "lab_report_template_parameters"."is_custom" = false AND "lab_report_template_parameters"."base_parameter_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_report_template_parameters_global_default" ON "lab_report_template_parameters" USING btree ("template_id","parameter_name") WHERE "lab_report_template_parameters"."lab_id" IS NULL AND "lab_report_template_parameters"."source_type" = 'DEFAULT';--> statement-breakpoint
CREATE INDEX "idx_lab_report_templates_lab_id" ON "lab_report_templates" USING btree ("lab_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_report_templates_code_global" ON "lab_report_templates" USING btree ("code") WHERE "lab_report_templates"."lab_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_report_templates_lab_code" ON "lab_report_templates" USING btree ("lab_id","code") WHERE "lab_report_templates"."lab_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_samples_barcode_value_unique" ON "lab_samples" USING btree ("barcode_value");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_samples_appointment_test_unique" ON "lab_samples" USING btree ("appointment_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_lab_id" ON "lab_samples" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_lab_order_id" ON "lab_samples" USING btree ("lab_order_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_patient_id" ON "lab_samples" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_clinic_id" ON "lab_samples" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_status" ON "lab_samples" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_lab_id_status" ON "lab_samples" USING btree ("lab_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_medicine_name_global" ON "medicines" USING btree ("name","form") WHERE "medicines"."created_by_user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_medicine_name_user" ON "medicines" USING btree ("name","form","created_by_user_id") WHERE "medicines"."created_by_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_mfa_user_id_idx" ON "user_mfa" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_mfa_recovery_user_id_idx" ON "user_mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "notifications"."read" = false;--> statement-breakpoint
CREATE INDEX "family_links_primary_idx" ON "patient_family_links" USING btree ("primary_patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_medicine_name" ON "pharmacy_medicines" USING btree ("medicine_name","pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_medicines_pharmacy_id_idx" ON "pharmacy_medicines" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_medicines_hsn_id_idx" ON "pharmacy_medicines" USING btree ("hsn_id");--> statement-breakpoint
CREATE INDEX "pharmacy_medicines_status_idx" ON "pharmacy_medicines" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_pharmacy_tag" ON "pharmacy_medicine_tags" USING btree ("pharmacy_id","tag");--> statement-breakpoint
CREATE INDEX "idx_pharmacy_tags_pharmacy_id" ON "pharmacy_medicine_tags" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_pharmacy_tags_tag" ON "pharmacy_medicine_tags" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "idx_pharmacy_tags_created_at" ON "pharmacy_medicine_tags" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_medicine_tag" ON "pharmacy_tags_map" USING btree ("medicine_id","tag_id");--> statement-breakpoint
CREATE INDEX "idx_tags_map_medicine_id" ON "pharmacy_tags_map" USING btree ("medicine_id");--> statement-breakpoint
CREATE INDEX "idx_tags_map_tag_id" ON "pharmacy_tags_map" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "pharmacy_subscription_pharmacy_id_idx" ON "pharmacy_patient_subscription" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_subscription_mobile_idx" ON "pharmacy_patient_subscription" USING btree ("customer_mobile");--> statement-breakpoint
CREATE INDEX "pharmacy_subscription_delivery_idx" ON "pharmacy_patient_subscription" USING btree ("next_delivery_date");--> statement-breakpoint
CREATE INDEX "subscription_medicine_subscription_idx" ON "pharmacy_subscription_medicines" USING btree ("pharmacy_patient_subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_medicine_medicine_idx" ON "pharmacy_subscription_medicines" USING btree ("pharmacy_medicine_id");--> statement-breakpoint
CREATE INDEX "subscription_sales_subscription_idx" ON "pharmacy_subscription_sales_map" USING btree ("pharmacy_patient_subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_sales_sales_idx" ON "pharmacy_subscription_sales_map" USING btree ("pharmacy_sales_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_pharmacy_id_idx" ON "pharmacy_sales" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_created_by_idx" ON "pharmacy_sales" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_created_at_idx" ON "pharmacy_sales" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_prescription_id_idx" ON "pharmacy_sales" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_pharmacy_created_idx" ON "pharmacy_sales" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sales_item" ON "pharmacy_sales_items" USING btree ("pharmacy_sales_id","pharmacy_stock_medicine_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_items_sales_id_idx" ON "pharmacy_sales_items" USING btree ("pharmacy_sales_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_items_stock_medicine_idx" ON "pharmacy_sales_items" USING btree ("pharmacy_stock_medicine_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_items_created_at_idx" ON "pharmacy_sales_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_pharmacy_id_idx" ON "pharmacy_stock" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_purchase_date_idx" ON "pharmacy_stock" USING btree ("purchase_date");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_pharmacy_payment_idx" ON "pharmacy_stock" USING btree ("pharmacy_id","pharmacy_stock_payment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pharmacy_medicine_batch" ON "pharmacy_stock_medicine" USING btree ("pharmacy_stock_id","pharmacy_medicine_id","batch");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_stock_id_idx" ON "pharmacy_stock_medicine" USING btree ("pharmacy_stock_id");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_medicine_id_idx" ON "pharmacy_stock_medicine" USING btree ("pharmacy_medicine_id");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_expiry_idx" ON "pharmacy_stock_medicine" USING btree ("expiry");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_quantity_idx" ON "pharmacy_stock_medicine" USING btree ("quantity");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_created_at_idx" ON "pharmacy_stock_medicine" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_name_pharmacy" ON "pharmacy_suppliers" USING btree ("pharmacy_id","supplier_name");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_pharmacy_id_idx" ON "pharmacy_suppliers" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_status_idx" ON "pharmacy_suppliers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_phone_idx" ON "pharmacy_suppliers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_gst_number_idx" ON "pharmacy_suppliers" USING btree ("gst_number");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_created_at_idx" ON "pharmacy_suppliers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_pharmacy_status_idx" ON "pharmacy_suppliers" USING btree ("pharmacy_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hsn_effective" ON "hsn_tax_master" USING btree ("hsn_code","effective_from");--> statement-breakpoint
CREATE INDEX "idx_hsn_code" ON "hsn_tax_master" USING btree ("hsn_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pharmacy_user" ON "pharmacy_assign" USING btree ("user_id","pharmacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pharmacy_name_clinic" ON "pharmacies" USING btree ("clinic_id","name","is_deleted");--> statement-breakpoint
CREATE INDEX "prescription_queue_clinic_status_idx" ON "prescription_queue" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "prescription_queue_appointment_id_idx" ON "prescription_queue" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "prescription_queue_doctor_id_idx" ON "prescription_queue" USING btree ("doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_report" ON "reports" USING btree ("report_type","petient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_unique" ON "settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "add_on_feature_key_unique" ON "add_ons" USING btree ("feature_key");--> statement-breakpoint
CREATE INDEX "clinic_add_ons_clinic_idx" ON "clinic_add_ons" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_add_ons_add_on_idx" ON "clinic_add_ons" USING btree ("add_on_id");--> statement-breakpoint
CREATE INDEX "clinic_add_ons_active_idx" ON "clinic_add_ons" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_usage_unique" ON "clinic_usage" USING btree ("clinic_id","feature_key","period_start");--> statement-breakpoint
CREATE INDEX "clinic_usage_clinic_idx" ON "clinic_usage" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_usage_period_idx" ON "clinic_usage" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "coupons_code_idx" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "coupons_status_idx" ON "coupons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "coupon_usage_coupon_id_idx" ON "coupon_usage" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "coupon_usage_clinic_used_idx" ON "coupon_usage" USING btree ("clinic_id","used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_features_plan_key_unique" ON "plan_features" USING btree ("plan_id","feature_key");--> statement-breakpoint
CREATE INDEX "clinic_subscriptions_clinic_idx" ON "clinic_subscriptions" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_subscriptions_active_idx" ON "clinic_subscriptions" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_active_subscription" ON "clinic_subscriptions" USING btree ("clinic_id") WHERE "clinic_subscriptions"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plan_unique" ON "subscription_plans" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_orders_unique_test_id_unique" ON "lab_orders" USING btree ("unique_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_appointment_id" ON "lab_orders" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_test_id" ON "lab_orders" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_patient_id" ON "lab_orders" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_doctor_id" ON "lab_orders" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_clinic_id" ON "lab_orders" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_lab_assistant_id" ON "lab_orders" USING btree ("lab_assistant_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_report_status" ON "lab_orders" USING btree ("test_report_status");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_payment_status" ON "lab_orders" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_workflow_status" ON "lab_orders" USING btree ("workflow_status");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_sample_status" ON "lab_orders" USING btree ("sample_status");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_lab_assistant_created_at" ON "lab_orders" USING btree ("lab_assistant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_clinic_report_status" ON "lab_orders" USING btree ("clinic_id","test_report_status");--> statement-breakpoint
CREATE INDEX "idx_lab_order_tracking_events_appointment_test_id" ON "lab_order_tracking_events" USING btree ("appointment_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_tracking_events_clinic_id" ON "lab_order_tracking_events" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_tracking_events_lab_id" ON "lab_order_tracking_events" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_tracking_events_created_at" ON "lab_order_tracking_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_test_catalog_lab_department_custom_name_unique" ON "lab_test_catalog" USING btree ("lab_id","department_id","name") WHERE source = 'custom' AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_lab_test_catalog_lab_id" ON "lab_test_catalog" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_test_catalog_department_id" ON "lab_test_catalog" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_lab_test_catalog_test_code" ON "lab_test_catalog" USING btree ("test_code");--> statement-breakpoint
CREATE INDEX "idx_lab_test_catalog_status" ON "lab_test_catalog" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "test_catalog_clinic_name_unique" ON "test_catalog" USING btree ("clinic_id","name") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "test_catalog_global_name_unique" ON "test_catalog" USING btree ("name") WHERE clinic_id IS NULL AND is_deleted = false;--> statement-breakpoint
CREATE INDEX "idx_test_catalog_doctor_id" ON "test_catalog" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_test_catalog_status" ON "test_catalog" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_test_catalog_lab_test_id" ON "test_catalog" USING btree ("lab_test_id");--> statement-breakpoint
CREATE INDEX "referral_referred_by_idx" ON "referrals" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "referral_referred_to_idx" ON "referrals" USING btree ("referred_to");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_code_unique" ON "referrals" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "referral_created_at_idx" ON "referrals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "referral_status_idx" ON "referrals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_token_hash" ON "tokens" USING btree ("user_id","token_hash","type");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_registration_token" ON "tokens" USING btree ("email","token_hash","type");--> statement-breakpoint
CREATE INDEX "tokens_patient_otp_mobile_idx" ON "tokens" USING btree ("email","type");--> statement-breakpoint
CREATE INDEX "email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "mobile_idx" ON "users" USING btree ("mobile");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_social_provider_id" ON "users" USING btree ("social_provider","social_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_staff_email" ON "users" USING btree ("email") WHERE user_type != 'Patient' AND email IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_patient_mobile" ON "users" USING btree ("mobile") WHERE user_type = 'Patient' AND mobile IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_professional_user_id_idx" ON "user_professionals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_professional_license_idx" ON "user_professionals" USING btree ("license_number");--> statement-breakpoint
CREATE INDEX "user_profile_user_id_idx" ON "user_profiles" USING btree ("user_id");