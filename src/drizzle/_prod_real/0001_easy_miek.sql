CREATE TYPE "public"."doctor_arrival_source" AS ENUM('self', 'reception', 'auto_confirm');--> statement-breakpoint
CREATE TYPE "public"."session_override_type" AS ENUM('running_late', 'schedule_shift', 'slot_config', 'extra_slots', 'missed_dismissed');--> statement-breakpoint
CREATE TYPE "public"."visiting_request_status" AS ENUM('Pending', 'Scheduled', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."staff_access_scope" AS ENUM('assigned_doctors', 'all_doctors');--> statement-breakpoint
CREATE TABLE "doctor_arrivals" (
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
--> statement-breakpoint
CREATE TABLE "staff_doctor_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_scopes" (
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
--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" DROP CONSTRAINT "pharmacy_sales_return_items_sales_return_id_pharmacy_sales_retu";
--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" DROP CONSTRAINT "pharmacy_sales_return_items_sales_item_id_pharmacy_sales_items_";
--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" DROP CONSTRAINT "pharmacy_sales_return_items_stock_medicine_id_pharmacy_stock_me";
--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_return_items" DROP CONSTRAINT "pharmacy_purchase_return_items_purchase_return_id_pharmacy_purc";
--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_return_items" DROP CONSTRAINT "pharmacy_purchase_return_items_stock_medicine_id_pharmacy_stock";
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_clinic_cancellation_policy_id_clinic_cancellation_";
--> statement-breakpoint
ALTER TABLE "cancellation_refunds" DROP CONSTRAINT "cancellation_refunds_cancellation_request_id_cancellation_reque";
--> statement-breakpoint
ALTER TABLE "clinic_appointments" DROP CONSTRAINT "clinic_appointments_doctor_subscription_id_clinics_service_id_f";
--> statement-breakpoint
ALTER TABLE "clinic_date_availability_time_slots" DROP CONSTRAINT "clinic_date_availability_time_slots_clinic_date_availability_id";
--> statement-breakpoint
ALTER TABLE "lab_order_result_values" DROP CONSTRAINT "lab_order_result_values_parameter_id_lab_report_template_parame";
--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" DROP CONSTRAINT "lab_report_template_parameters_template_id_lab_report_templates";
--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" DROP CONSTRAINT "lab_report_template_parameters_base_parameter_id_lab_report_tem";
--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_medicines" DROP CONSTRAINT "pharmacy_subscription_medicines_pharmacy_patient_subscription_i";
--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_medicines" DROP CONSTRAINT "pharmacy_subscription_medicines_pharmacy_medicine_id_pharmacy_m";
--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_sales_map" DROP CONSTRAINT "pharmacy_subscription_sales_map_pharmacy_patient_subscription_i";
--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_sales_map" DROP CONSTRAINT "pharmacy_subscription_sales_map_pharmacy_sales_id_pharmacy_sale";
--> statement-breakpoint
ALTER TABLE "pharmacy_sales_items" DROP CONSTRAINT "pharmacy_sales_items_pharmacy_stock_medicine_id_pharmacy_stock_";
--> statement-breakpoint
ALTER TABLE "pharmacy_stock_medicine" DROP CONSTRAINT "pharmacy_stock_medicine_pharmacy_medicine_id_pharmacy_medicines";
--> statement-breakpoint
DROP INDEX "ux_app_update_app_platform";--> statement-breakpoint
DROP INDEX "user_clinic_unique";--> statement-breakpoint
DROP INDEX "clinic_commission_active_idx";--> statement-breakpoint
DROP INDEX "clinic_subscriptions_active_idx";--> statement-breakpoint
DROP INDEX "clinic_subscriptions_clinic_idx";--> statement-breakpoint
DROP INDEX "ux_clinic_active_subscription";--> statement-breakpoint
DROP INDEX "idx_lab_orders_appointment_id";--> statement-breakpoint
DROP INDEX "idx_lab_orders_clinic_id";--> statement-breakpoint
DROP INDEX "idx_lab_orders_clinic_report_status";--> statement-breakpoint
DROP INDEX "idx_lab_orders_doctor_id";--> statement-breakpoint
DROP INDEX "idx_lab_orders_lab_assistant_created_at";--> statement-breakpoint
DROP INDEX "idx_lab_orders_lab_assistant_id";--> statement-breakpoint
DROP INDEX "idx_lab_orders_patient_id";--> statement-breakpoint
DROP INDEX "idx_lab_orders_payment_status";--> statement-breakpoint
DROP INDEX "idx_lab_orders_report_status";--> statement-breakpoint
DROP INDEX "idx_lab_orders_sample_status";--> statement-breakpoint
DROP INDEX "idx_lab_orders_test_id";--> statement-breakpoint
DROP INDEX "idx_lab_orders_workflow_status";--> statement-breakpoint
DROP INDEX "lab_orders_unique_test_id_unique";--> statement-breakpoint
DROP INDEX "ledger_appointment_idx";--> statement-breakpoint
DROP INDEX "ledger_clinic_idx";--> statement-breakpoint
DROP INDEX "ledger_gateway_ref_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_returns_created_at_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_returns_created_by_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_returns_pharmacy_created_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_returns_pharmacy_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_returns_sale_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_return_items_return_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_return_items_sales_item_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_return_items_stock_medicine_id_idx";--> statement-breakpoint
DROP INDEX "unique_refresh_token_hash";--> statement-breakpoint
DROP INDEX "unique_refresh_token_user_platform";--> statement-breakpoint
DROP INDEX "subscription_activity_clinic_created_idx";--> statement-breakpoint
DROP INDEX "clinic_razorpay_clinic_unique";--> statement-breakpoint
DROP INDEX "idx_permission_audit_log_clinic_key";--> statement-breakpoint
DROP INDEX "idx_permission_audit_log_target_user";--> statement-breakpoint
DROP INDEX "idx_user_permissions_user_clinic";--> statement-breakpoint
DROP INDEX "user_permissions_user_clinic_permission_unique";--> statement-breakpoint
DROP INDEX "idx_permissions_resource";--> statement-breakpoint
DROP INDEX "permissions_key_unique";--> statement-breakpoint
DROP INDEX "pharmacy_purchase_returns_created_at_idx";--> statement-breakpoint
DROP INDEX "pharmacy_purchase_returns_created_by_idx";--> statement-breakpoint
DROP INDEX "pharmacy_purchase_returns_pharmacy_created_idx";--> statement-breakpoint
DROP INDEX "pharmacy_purchase_returns_pharmacy_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_purchase_returns_stock_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_purchase_return_items_return_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_purchase_return_items_stock_medicine_id_idx";--> statement-breakpoint
DROP INDEX "clinic_usage_clinic_idx";--> statement-breakpoint
DROP INDEX "clinic_usage_period_idx";--> statement-breakpoint
DROP INDEX "clinic_usage_unique";--> statement-breakpoint
DROP INDEX "appointment_unique";--> statement-breakpoint
DROP INDEX "appointments_appointment_date_idx";--> statement-breakpoint
DROP INDEX "appointments_clinic_status_date_idx";--> statement-breakpoint
DROP INDEX "appointments_doctor_date_idx";--> statement-breakpoint
DROP INDEX "transaction_idx";--> statement-breakpoint
DROP INDEX "email_idx";--> statement-breakpoint
DROP INDEX "mobile_idx";--> statement-breakpoint
DROP INDEX "user_name_idx";--> statement-breakpoint
DROP INDEX "ux_patient_mobile";--> statement-breakpoint
DROP INDEX "ux_staff_email";--> statement-breakpoint
DROP INDEX "ux_users_social_provider_id";--> statement-breakpoint
DROP INDEX "user_unique";--> statement-breakpoint
DROP INDEX "doctor_session_overrides_clinic_date_idx";--> statement-breakpoint
DROP INDEX "visiting_requests_doctor_date_idx";--> statement-breakpoint
DROP INDEX "visiting_requests_generated_appointment_idx";--> statement-breakpoint
DROP INDEX "visiting_requests_source_date_unique";--> statement-breakpoint
DROP INDEX "clinic_service_unique";--> statement-breakpoint
DROP INDEX "ux_clinic_active_policy";--> statement-breakpoint
DROP INDEX "no_show_appointment_idx";--> statement-breakpoint
DROP INDEX "no_show_patient_idx";--> statement-breakpoint
DROP INDEX "banner_placement_idx";--> statement-breakpoint
DROP INDEX "banner_start_end_idx";--> statement-breakpoint
DROP INDEX "banner_status_idx";--> statement-breakpoint
DROP INDEX "banner_type_idx";--> statement-breakpoint
DROP INDEX "banner_analytics_banner_idx";--> statement-breakpoint
DROP INDEX "banner_analytics_event_idx";--> statement-breakpoint
DROP INDEX "banner_analytics_occurred_idx";--> statement-breakpoint
DROP INDEX "banner_analytics_user_idx";--> statement-breakpoint
DROP INDEX "banner_dismissal_banner_idx";--> statement-breakpoint
DROP INDEX "banner_dismissal_user_idx";--> statement-breakpoint
DROP INDEX "symptom_date_idx";--> statement-breakpoint
DROP INDEX "ux_clinic_day";--> statement-breakpoint
DROP INDEX "ux_clinic_break";--> statement-breakpoint
DROP INDEX "ux_clinic_doctor_date";--> statement-breakpoint
DROP INDEX "ux_clinic_date_time_slot";--> statement-breakpoint
DROP INDEX "idx_doctor_update_requests_clinic_status";--> statement-breakpoint
DROP INDEX "idx_doctor_update_requests_doctor_id";--> statement-breakpoint
DROP INDEX "idx_doctor_update_requests_status";--> statement-breakpoint
DROP INDEX "ux_doctor_favorite_patient_doctor";--> statement-breakpoint
DROP INDEX "ux_doctor_qualification_user";--> statement-breakpoint
DROP INDEX "doctor_reviews_doctor_id_idx";--> statement-breakpoint
DROP INDEX "doctor_reviews_patient_id_idx";--> statement-breakpoint
DROP INDEX "ux_doctor_reviews_appointment";--> statement-breakpoint
DROP INDEX "idx_labs_clinic_id";--> statement-breakpoint
DROP INDEX "idx_lab_departments_department_id";--> statement-breakpoint
DROP INDEX "lab_dept_unique";--> statement-breakpoint
DROP INDEX "idx_lab_departments_master_name";--> statement-breakpoint
DROP INDEX "idx_lab_departments_master_status";--> statement-breakpoint
DROP INDEX "lab_departments_master_code_unique";--> statement-breakpoint
DROP INDEX "idx_user_lab_assignments_lab_id";--> statement-breakpoint
DROP INDEX "idx_user_lab_assignments_user_id";--> statement-breakpoint
DROP INDEX "user_lab_assignments_user_lab_clinic_unique";--> statement-breakpoint
DROP INDEX "idx_lab_invoices_clinic_id";--> statement-breakpoint
DROP INDEX "idx_lab_invoices_created_at";--> statement-breakpoint
DROP INDEX "idx_lab_invoices_doctor_id";--> statement-breakpoint
DROP INDEX "idx_lab_invoices_lab_id";--> statement-breakpoint
DROP INDEX "idx_lab_invoices_patient_id";--> statement-breakpoint
DROP INDEX "idx_lab_invoices_test_id";--> statement-breakpoint
DROP INDEX "lab_invoices_appointment_test_unique";--> statement-breakpoint
DROP INDEX "lab_invoices_invoice_number_unique";--> statement-breakpoint
DROP INDEX "idx_test_catalog_doctor_id";--> statement-breakpoint
DROP INDEX "idx_test_catalog_lab_test_id";--> statement-breakpoint
DROP INDEX "idx_test_catalog_status";--> statement-breakpoint
DROP INDEX "test_catalog_clinic_name_unique";--> statement-breakpoint
DROP INDEX "test_catalog_global_name_unique";--> statement-breakpoint
DROP INDEX "idx_lab_order_results_appointment_test_id";--> statement-breakpoint
DROP INDEX "idx_lab_order_results_lab_order_id";--> statement-breakpoint
DROP INDEX "ux_lab_order_results_order_test_template";--> statement-breakpoint
DROP INDEX "idx_lab_order_result_values_parameter_id";--> statement-breakpoint
DROP INDEX "idx_lab_order_result_values_result_id";--> statement-breakpoint
DROP INDEX "ux_lab_order_result_values_result_parameter";--> statement-breakpoint
DROP INDEX "idx_lab_report_template_parameters_base_parameter_id";--> statement-breakpoint
DROP INDEX "idx_lab_report_template_parameters_lab_id";--> statement-breakpoint
DROP INDEX "idx_lab_report_template_parameters_template_id";--> statement-breakpoint
DROP INDEX "ux_lab_report_template_parameters_default_override";--> statement-breakpoint
DROP INDEX "ux_lab_report_template_parameters_global_default";--> statement-breakpoint
DROP INDEX "idx_lab_report_templates_lab_id";--> statement-breakpoint
DROP INDEX "ux_lab_report_templates_code_global";--> statement-breakpoint
DROP INDEX "ux_lab_report_templates_lab_code";--> statement-breakpoint
DROP INDEX "idx_lab_samples_clinic_id";--> statement-breakpoint
DROP INDEX "idx_lab_samples_lab_id";--> statement-breakpoint
DROP INDEX "idx_lab_samples_lab_id_status";--> statement-breakpoint
DROP INDEX "idx_lab_samples_lab_order_id";--> statement-breakpoint
DROP INDEX "idx_lab_samples_patient_id";--> statement-breakpoint
DROP INDEX "idx_lab_samples_status";--> statement-breakpoint
DROP INDEX "lab_samples_appointment_test_unique";--> statement-breakpoint
DROP INDEX "lab_samples_barcode_value_unique";--> statement-breakpoint
DROP INDEX "ux_medicine_name_global";--> statement-breakpoint
DROP INDEX "ux_medicine_name_user";--> statement-breakpoint
DROP INDEX "user_mfa_user_id_idx";--> statement-breakpoint
DROP INDEX "user_mfa_recovery_user_id_idx";--> statement-breakpoint
DROP INDEX "notifications_user_created_idx";--> statement-breakpoint
DROP INDEX "notifications_user_unread_idx";--> statement-breakpoint
DROP INDEX "family_links_primary_idx";--> statement-breakpoint
DROP INDEX "ux_pharmacy_name_clinic";--> statement-breakpoint
DROP INDEX "pharmacy_medicines_hsn_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_medicines_pharmacy_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_medicines_status_idx";--> statement-breakpoint
DROP INDEX "ux_medicine_name";--> statement-breakpoint
DROP INDEX "idx_hsn_code";--> statement-breakpoint
DROP INDEX "uq_hsn_effective";--> statement-breakpoint
DROP INDEX "idx_pharmacy_tags_created_at";--> statement-breakpoint
DROP INDEX "idx_pharmacy_tags_pharmacy_id";--> statement-breakpoint
DROP INDEX "idx_pharmacy_tags_tag";--> statement-breakpoint
DROP INDEX "uk_pharmacy_tag";--> statement-breakpoint
DROP INDEX "idx_tags_map_medicine_id";--> statement-breakpoint
DROP INDEX "idx_tags_map_tag_id";--> statement-breakpoint
DROP INDEX "uk_medicine_tag";--> statement-breakpoint
DROP INDEX "pharmacy_subscription_delivery_idx";--> statement-breakpoint
DROP INDEX "pharmacy_subscription_mobile_idx";--> statement-breakpoint
DROP INDEX "pharmacy_subscription_pharmacy_id_idx";--> statement-breakpoint
DROP INDEX "subscription_medicine_medicine_idx";--> statement-breakpoint
DROP INDEX "subscription_medicine_subscription_idx";--> statement-breakpoint
DROP INDEX "subscription_sales_sales_idx";--> statement-breakpoint
DROP INDEX "subscription_sales_subscription_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_created_at_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_created_by_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_pharmacy_created_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_pharmacy_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_prescription_id_idx";--> statement-breakpoint
DROP INDEX "prescription_queue_appointment_id_idx";--> statement-breakpoint
DROP INDEX "prescription_queue_clinic_status_idx";--> statement-breakpoint
DROP INDEX "prescription_queue_doctor_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_items_created_at_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_items_sales_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_sales_items_stock_medicine_idx";--> statement-breakpoint
DROP INDEX "ux_sales_item";--> statement-breakpoint
DROP INDEX "pharmacy_stock_medicine_created_at_idx";--> statement-breakpoint
DROP INDEX "pharmacy_stock_medicine_expiry_idx";--> statement-breakpoint
DROP INDEX "pharmacy_stock_medicine_medicine_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_stock_medicine_quantity_idx";--> statement-breakpoint
DROP INDEX "pharmacy_stock_medicine_stock_id_idx";--> statement-breakpoint
DROP INDEX "ux_pharmacy_medicine_batch";--> statement-breakpoint
DROP INDEX "pharmacy_stock_pharmacy_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_stock_pharmacy_payment_idx";--> statement-breakpoint
DROP INDEX "pharmacy_stock_purchase_date_idx";--> statement-breakpoint
DROP INDEX "pharmacy_suppliers_created_at_idx";--> statement-breakpoint
DROP INDEX "pharmacy_suppliers_gst_number_idx";--> statement-breakpoint
DROP INDEX "pharmacy_suppliers_pharmacy_id_idx";--> statement-breakpoint
DROP INDEX "pharmacy_suppliers_pharmacy_status_idx";--> statement-breakpoint
DROP INDEX "pharmacy_suppliers_phone_idx";--> statement-breakpoint
DROP INDEX "pharmacy_suppliers_status_idx";--> statement-breakpoint
DROP INDEX "ux_supplier_name_pharmacy";--> statement-breakpoint
DROP INDEX "ux_pharmacy_user";--> statement-breakpoint
DROP INDEX "ux_report";--> statement-breakpoint
DROP INDEX "setting_unique";--> statement-breakpoint
DROP INDEX "add_on_feature_key_unique";--> statement-breakpoint
DROP INDEX "clinic_add_ons_active_idx";--> statement-breakpoint
DROP INDEX "clinic_add_ons_add_on_idx";--> statement-breakpoint
DROP INDEX "clinic_add_ons_clinic_idx";--> statement-breakpoint
DROP INDEX "coupons_code_idx";--> statement-breakpoint
DROP INDEX "coupons_status_idx";--> statement-breakpoint
DROP INDEX "coupon_usage_clinic_used_idx";--> statement-breakpoint
DROP INDEX "coupon_usage_coupon_id_idx";--> statement-breakpoint
DROP INDEX "subscription_plan_unique";--> statement-breakpoint
DROP INDEX "plan_features_plan_key_unique";--> statement-breakpoint
DROP INDEX "idx_lab_order_tracking_events_appointment_test_id";--> statement-breakpoint
DROP INDEX "idx_lab_order_tracking_events_clinic_id";--> statement-breakpoint
DROP INDEX "idx_lab_order_tracking_events_created_at";--> statement-breakpoint
DROP INDEX "idx_lab_order_tracking_events_lab_id";--> statement-breakpoint
DROP INDEX "idx_lab_test_catalog_department_id";--> statement-breakpoint
DROP INDEX "idx_lab_test_catalog_lab_id";--> statement-breakpoint
DROP INDEX "idx_lab_test_catalog_status";--> statement-breakpoint
DROP INDEX "idx_lab_test_catalog_test_code";--> statement-breakpoint
DROP INDEX "lab_test_catalog_lab_department_custom_name_unique";--> statement-breakpoint
DROP INDEX "referral_code_unique";--> statement-breakpoint
DROP INDEX "referral_created_at_idx";--> statement-breakpoint
DROP INDEX "referral_referred_by_idx";--> statement-breakpoint
DROP INDEX "referral_referred_to_idx";--> statement-breakpoint
DROP INDEX "referral_status_idx";--> statement-breakpoint
DROP INDEX "tokens_patient_otp_mobile_idx";--> statement-breakpoint
DROP INDEX "unique_registration_token";--> statement-breakpoint
DROP INDEX "unique_token_hash";--> statement-breakpoint
DROP INDEX "user_professional_license_idx";--> statement-breakpoint
DROP INDEX "user_professional_user_id_idx";--> statement-breakpoint
DROP INDEX "user_profile_user_id_idx";--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ALTER COLUMN "value_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_clinical_data" ALTER COLUMN "common_symptoms" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "appointment_clinical_data" ALTER COLUMN "clinic_symptom_ids" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "labs" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quick_print_templates" ALTER COLUMN "element_config" SET DEFAULT '{"showClinicHeader":true,"showClinicLogo":true,"showPatientName":true,"showPatientUhid":true,"showPatientAge":true,"showPatientGender":true,"showPatientMobile":true,"showPatientAddress":false,"showVisitDate":true,"showDiagnosis":true,"showMedicineTable":true,"showMedicineComposition":true,"showMedicineQuantity":false,"showMedicineInstructions":true,"showAdvice":true,"showFollowUp":true,"showDoctorName":true,"showDoctorQualification":true,"showDoctorRegistration":false,"showDoctorSignature":true,"showQrCode":false,"showFooter":true,"sectionOrder":["clinicHeader","patientInfo","diagnosis","medicineTable","advice","followUp","doctorSignature","footer"]}'::jsonb;--> statement-breakpoint
ALTER TABLE "independent_patients" ALTER COLUMN "doctor_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "is_clinic_phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "type" "session_override_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "session_start" varchar;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "slot_minutes" integer;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "step_minutes" integer;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "number_of_slots" integer;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "no_of_patients" integer;--> statement-breakpoint
ALTER TABLE "visiting_requests" ADD COLUMN "status" "visiting_request_status" DEFAULT 'Pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_preferences" ADD COLUMN "advice_suggestions_list" json DEFAULT '["Take medicines as prescribed.","Take adequate rest.","Maintain proper hydration.","Avoid self-medication.","Complete the full course of antibiotics.","Do light exercise daily.","Maintain personal hygiene.","Monitor temperature twice a day.","Avoid smoking and alcohol.","Follow up if symptoms persist."]'::json;--> statement-breakpoint
ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_arrivals_lookup_idx" ON "doctor_arrivals" USING btree ("doctor_id","for_date","session_start","created_at");--> statement-breakpoint
CREATE INDEX "doctor_arrivals_clinic_date_idx" ON "doctor_arrivals" USING btree ("clinic_id","for_date");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_doctor_assignment_unique" ON "staff_doctor_assignments" USING btree ("staff_user_id","clinic_id","doctor_user_id");--> statement-breakpoint
CREATE INDEX "idx_staff_doctor_by_doctor" ON "staff_doctor_assignments" USING btree ("clinic_id","doctor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_scopes_user_clinic_unique" ON "staff_scopes" USING btree ("user_id","clinic_id");--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" ADD CONSTRAINT "pharmacy_sales_return_items_sales_return_id_pharmacy_sales_returns_id_fk" FOREIGN KEY ("sales_return_id") REFERENCES "public"."pharmacy_sales_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" ADD CONSTRAINT "pharmacy_sales_return_items_sales_item_id_pharmacy_sales_items_id_fk" FOREIGN KEY ("sales_item_id") REFERENCES "public"."pharmacy_sales_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" ADD CONSTRAINT "pharmacy_sales_return_items_stock_medicine_id_pharmacy_stock_medicine_id_fk" FOREIGN KEY ("stock_medicine_id") REFERENCES "public"."pharmacy_stock_medicine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_return_items" ADD CONSTRAINT "pharmacy_purchase_return_items_purchase_return_id_pharmacy_purchase_returns_id_fk" FOREIGN KEY ("purchase_return_id") REFERENCES "public"."pharmacy_purchase_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_return_items" ADD CONSTRAINT "pharmacy_purchase_return_items_stock_medicine_id_pharmacy_stock_medicine_id_fk" FOREIGN KEY ("stock_medicine_id") REFERENCES "public"."pharmacy_stock_medicine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_cancellation_policy_id_clinic_cancellation_policies_id_fk" FOREIGN KEY ("clinic_cancellation_policy_id") REFERENCES "public"."clinic_cancellation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refunds" ADD CONSTRAINT "cancellation_refunds_cancellation_request_id_cancellation_requests_id_fk" FOREIGN KEY ("cancellation_request_id") REFERENCES "public"."cancellation_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_doctor_subscription_id_clinics_service_id_fk" FOREIGN KEY ("doctor_subscription_id") REFERENCES "public"."clinics_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_date_availability_time_slots" ADD CONSTRAINT "clinic_date_availability_time_slots_clinic_date_availability_id_clinic_date_availability_id_fk" FOREIGN KEY ("clinic_date_availability_id") REFERENCES "public"."clinic_date_availability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_result_values" ADD CONSTRAINT "lab_order_result_values_parameter_id_lab_report_template_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_report_template_parameters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD CONSTRAINT "lab_report_template_parameters_template_id_lab_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lab_report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD CONSTRAINT "lab_report_template_parameters_base_parameter_id_lab_report_template_parameters_id_fk" FOREIGN KEY ("base_parameter_id") REFERENCES "public"."lab_report_template_parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_medicines" ADD CONSTRAINT "pharmacy_subscription_medicines_pharmacy_patient_subscription_id_pharmacy_patient_subscription_id_fk" FOREIGN KEY ("pharmacy_patient_subscription_id") REFERENCES "public"."pharmacy_patient_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_medicines" ADD CONSTRAINT "pharmacy_subscription_medicines_pharmacy_medicine_id_pharmacy_medicines_id_fk" FOREIGN KEY ("pharmacy_medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_sales_map" ADD CONSTRAINT "pharmacy_subscription_sales_map_pharmacy_patient_subscription_id_pharmacy_patient_subscription_id_fk" FOREIGN KEY ("pharmacy_patient_subscription_id") REFERENCES "public"."pharmacy_patient_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_subscription_sales_map" ADD CONSTRAINT "pharmacy_subscription_sales_map_pharmacy_sales_id_pharmacy_sales_id_fk" FOREIGN KEY ("pharmacy_sales_id") REFERENCES "public"."pharmacy_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_items" ADD CONSTRAINT "pharmacy_sales_items_pharmacy_stock_medicine_id_pharmacy_stock_medicine_id_fk" FOREIGN KEY ("pharmacy_stock_medicine_id") REFERENCES "public"."pharmacy_stock_medicine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock_medicine" ADD CONSTRAINT "pharmacy_stock_medicine_pharmacy_medicine_id_pharmacy_medicines_id_fk" FOREIGN KEY ("pharmacy_medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_session_overrides_lookup_idx" ON "doctor_session_overrides" USING btree ("doctor_id","for_date","type","session_start","created_at");--> statement-breakpoint
CREATE INDEX "visiting_requests_clinic_status_idx" ON "visiting_requests" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_app_update_app_platform" ON "app_update_config" USING btree ("app_name","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "user_clinic_unique" ON "clinic_assign" USING btree ("user_id","clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_commission_active_idx" ON "clinic_commissions" USING btree ("clinic_id","is_active");--> statement-breakpoint
CREATE INDEX "clinic_subscriptions_active_idx" ON "clinic_subscriptions" USING btree ("active");--> statement-breakpoint
CREATE INDEX "clinic_subscriptions_clinic_idx" ON "clinic_subscriptions" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_active_subscription" ON "clinic_subscriptions" USING btree ("clinic_id") WHERE "clinic_subscriptions"."active" = true;--> statement-breakpoint
CREATE INDEX "idx_lab_orders_appointment_id" ON "lab_orders" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_clinic_id" ON "lab_orders" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_clinic_report_status" ON "lab_orders" USING btree ("clinic_id","test_report_status");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_doctor_id" ON "lab_orders" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_lab_assistant_created_at" ON "lab_orders" USING btree ("lab_assistant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_lab_assistant_id" ON "lab_orders" USING btree ("lab_assistant_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_patient_id" ON "lab_orders" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_payment_status" ON "lab_orders" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_report_status" ON "lab_orders" USING btree ("test_report_status");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_sample_status" ON "lab_orders" USING btree ("sample_status");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_test_id" ON "lab_orders" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_workflow_status" ON "lab_orders" USING btree ("workflow_status");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_orders_unique_test_id_unique" ON "lab_orders" USING btree ("unique_test_id");--> statement-breakpoint
CREATE INDEX "ledger_appointment_idx" ON "financial_ledgers" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "ledger_clinic_idx" ON "financial_ledgers" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "ledger_gateway_ref_idx" ON "financial_ledgers" USING btree ("gateway_reference_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_created_at_idx" ON "pharmacy_sales_returns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_created_by_idx" ON "pharmacy_sales_returns" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_pharmacy_created_idx" ON "pharmacy_sales_returns" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_pharmacy_id_idx" ON "pharmacy_sales_returns" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_sale_id_idx" ON "pharmacy_sales_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_return_items_return_id_idx" ON "pharmacy_sales_return_items" USING btree ("sales_return_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_return_items_sales_item_id_idx" ON "pharmacy_sales_return_items" USING btree ("sales_item_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_return_items_stock_medicine_id_idx" ON "pharmacy_sales_return_items" USING btree ("stock_medicine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_refresh_token_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_refresh_token_user_platform" ON "refresh_tokens" USING btree ("user_id","platform");--> statement-breakpoint
CREATE INDEX "subscription_activity_clinic_created_idx" ON "subscription_activity" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_razorpay_clinic_unique" ON "clinic_razorpay_accounts" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_permission_audit_log_clinic_key" ON "permission_audit_log" USING btree ("clinic_id","permission_key","performed_at");--> statement-breakpoint
CREATE INDEX "idx_permission_audit_log_target_user" ON "permission_audit_log" USING btree ("target_user_id","clinic_id");--> statement-breakpoint
CREATE INDEX "idx_user_permissions_user_clinic" ON "user_permissions" USING btree ("user_id","clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permissions_user_clinic_permission_unique" ON "user_permissions" USING btree ("user_id","clinic_id","permission_id");--> statement-breakpoint
CREATE INDEX "idx_permissions_resource" ON "permissions" USING btree ("resource");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_unique" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_created_at_idx" ON "pharmacy_purchase_returns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_created_by_idx" ON "pharmacy_purchase_returns" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_pharmacy_created_idx" ON "pharmacy_purchase_returns" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_pharmacy_id_idx" ON "pharmacy_purchase_returns" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_stock_id_idx" ON "pharmacy_purchase_returns" USING btree ("stock_id");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_return_items_return_id_idx" ON "pharmacy_purchase_return_items" USING btree ("purchase_return_id");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_return_items_stock_medicine_id_idx" ON "pharmacy_purchase_return_items" USING btree ("stock_medicine_id");--> statement-breakpoint
CREATE INDEX "clinic_usage_clinic_idx" ON "clinic_usage" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_usage_period_idx" ON "clinic_usage" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_usage_unique" ON "clinic_usage" USING btree ("clinic_id","feature_key","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_unique" ON "appointments" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "appointments_appointment_date_idx" ON "appointments" USING btree ("appointment_date");--> statement-breakpoint
CREATE INDEX "appointments_clinic_status_date_idx" ON "appointments" USING btree ("clinic_id","appointment_status","appointment_date");--> statement-breakpoint
CREATE INDEX "appointments_doctor_date_idx" ON "appointments" USING btree ("doctor_id","appointment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_idx" ON "appointment_payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "mobile_idx" ON "users" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "user_name_idx" ON "users" USING btree ("user_name");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_patient_mobile" ON "users" USING btree ("mobile") WHERE user_type = 'Patient' AND mobile IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_staff_email" ON "users" USING btree ("email") WHERE user_type != 'Patient' AND email IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_social_provider_id" ON "users" USING btree ("social_provider","social_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_unique" ON "clinics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "doctor_session_overrides_clinic_date_idx" ON "doctor_session_overrides" USING btree ("clinic_id","for_date");--> statement-breakpoint
CREATE INDEX "visiting_requests_doctor_date_idx" ON "visiting_requests" USING btree ("doctor_id","requested_date");--> statement-breakpoint
CREATE INDEX "visiting_requests_generated_appointment_idx" ON "visiting_requests" USING btree ("generated_appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visiting_requests_source_date_unique" ON "visiting_requests" USING btree ("source_appointment_id","requested_date");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_service_unique" ON "clinics_service" USING btree ("clinic_id","service_name","doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_active_policy" ON "clinic_cancellation_policies" USING btree ("clinic_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "no_show_appointment_idx" ON "appointment_no_show_actions" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "no_show_patient_idx" ON "appointment_no_show_actions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "banner_placement_idx" ON "banners" USING btree ("placement");--> statement-breakpoint
CREATE INDEX "banner_start_end_idx" ON "banners" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "banner_status_idx" ON "banners" USING btree ("status");--> statement-breakpoint
CREATE INDEX "banner_type_idx" ON "banners" USING btree ("banner_type");--> statement-breakpoint
CREATE INDEX "banner_analytics_banner_idx" ON "banner_analytics" USING btree ("banner_id");--> statement-breakpoint
CREATE INDEX "banner_analytics_event_idx" ON "banner_analytics" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "banner_analytics_occurred_idx" ON "banner_analytics" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "banner_analytics_user_idx" ON "banner_analytics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "banner_dismissal_banner_idx" ON "banner_dismissals" USING btree ("banner_id");--> statement-breakpoint
CREATE INDEX "banner_dismissal_user_idx" ON "banner_dismissals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "symptom_date_idx" ON "clinic_symptom_counts" USING btree ("symptom_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_day" ON "clinic_availability" USING btree ("clinic_id","day_of_week","doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_break" ON "clinic_availability_break" USING btree ("clinic_id","break_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_doctor_date" ON "clinic_date_availability" USING btree ("clinic_id","doctor_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clinic_date_time_slot" ON "clinic_date_availability_time_slots" USING btree ("clinic_date_availability_id","start_time","end_time");--> statement-breakpoint
CREATE INDEX "idx_doctor_update_requests_clinic_status" ON "doctor_profile_update_requests" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "idx_doctor_update_requests_doctor_id" ON "doctor_profile_update_requests" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_doctor_update_requests_status" ON "doctor_profile_update_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_doctor_favorite_patient_doctor" ON "doctor_favorites" USING btree ("patient_id","doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_doctor_qualification_user" ON "doctor_qualifications" USING btree ("user_id","qualification_title","specialization");--> statement-breakpoint
CREATE INDEX "doctor_reviews_doctor_id_idx" ON "doctor_reviews" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_reviews_patient_id_idx" ON "doctor_reviews" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_doctor_reviews_appointment" ON "doctor_reviews" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_labs_clinic_id" ON "labs" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_departments_department_id" ON "lab_departments" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_dept_unique" ON "lab_departments" USING btree ("lab_id","department_id");--> statement-breakpoint
CREATE INDEX "idx_lab_departments_master_name" ON "lab_departments_master" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_lab_departments_master_status" ON "lab_departments_master" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_departments_master_code_unique" ON "lab_departments_master" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_user_lab_assignments_lab_id" ON "user_lab_assignments" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_user_lab_assignments_user_id" ON "user_lab_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_lab_assignments_user_lab_clinic_unique" ON "user_lab_assignments" USING btree ("user_id","lab_id","clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_clinic_id" ON "lab_invoices" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_created_at" ON "lab_invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_doctor_id" ON "lab_invoices" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_lab_id" ON "lab_invoices" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_patient_id" ON "lab_invoices" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_lab_invoices_test_id" ON "lab_invoices" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_invoices_appointment_test_unique" ON "lab_invoices" USING btree ("appointment_test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_invoices_invoice_number_unique" ON "lab_invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "idx_test_catalog_doctor_id" ON "test_catalog" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_test_catalog_lab_test_id" ON "test_catalog" USING btree ("lab_test_id");--> statement-breakpoint
CREATE INDEX "idx_test_catalog_status" ON "test_catalog" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "test_catalog_clinic_name_unique" ON "test_catalog" USING btree ("clinic_id","name") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "test_catalog_global_name_unique" ON "test_catalog" USING btree ("name") WHERE clinic_id IS NULL AND is_deleted = false;--> statement-breakpoint
CREATE INDEX "idx_lab_order_results_appointment_test_id" ON "lab_order_results" USING btree ("appointment_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_results_lab_order_id" ON "lab_order_results" USING btree ("lab_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_order_results_order_test_template" ON "lab_order_results" USING btree ("lab_order_id","appointment_test_id","template_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_result_values_parameter_id" ON "lab_order_result_values" USING btree ("parameter_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_result_values_result_id" ON "lab_order_result_values" USING btree ("result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_order_result_values_result_parameter" ON "lab_order_result_values" USING btree ("result_id","parameter_id");--> statement-breakpoint
CREATE INDEX "idx_lab_report_template_parameters_base_parameter_id" ON "lab_report_template_parameters" USING btree ("base_parameter_id");--> statement-breakpoint
CREATE INDEX "idx_lab_report_template_parameters_lab_id" ON "lab_report_template_parameters" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_report_template_parameters_template_id" ON "lab_report_template_parameters" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_report_template_parameters_default_override" ON "lab_report_template_parameters" USING btree ("template_id","lab_id","created_by","base_parameter_id") WHERE "lab_report_template_parameters"."lab_id" IS NOT NULL AND "lab_report_template_parameters"."source_type" = 'DEFAULT' AND "lab_report_template_parameters"."is_custom" = false AND "lab_report_template_parameters"."base_parameter_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_report_template_parameters_global_default" ON "lab_report_template_parameters" USING btree ("template_id","parameter_name") WHERE "lab_report_template_parameters"."lab_id" IS NULL AND "lab_report_template_parameters"."source_type" = 'DEFAULT';--> statement-breakpoint
CREATE INDEX "idx_lab_report_templates_lab_id" ON "lab_report_templates" USING btree ("lab_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_report_templates_code_global" ON "lab_report_templates" USING btree ("code") WHERE "lab_report_templates"."lab_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_report_templates_lab_code" ON "lab_report_templates" USING btree ("lab_id","code") WHERE "lab_report_templates"."lab_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_lab_samples_clinic_id" ON "lab_samples" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_lab_id" ON "lab_samples" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_lab_id_status" ON "lab_samples" USING btree ("lab_id","status");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_lab_order_id" ON "lab_samples" USING btree ("lab_order_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_patient_id" ON "lab_samples" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_lab_samples_status" ON "lab_samples" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_samples_appointment_test_unique" ON "lab_samples" USING btree ("appointment_test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_samples_barcode_value_unique" ON "lab_samples" USING btree ("barcode_value");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_medicine_name_global" ON "medicines" USING btree ("name","form") WHERE "medicines"."created_by_user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_medicine_name_user" ON "medicines" USING btree ("name","form","created_by_user_id") WHERE "medicines"."created_by_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_mfa_user_id_idx" ON "user_mfa" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_mfa_recovery_user_id_idx" ON "user_mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "notifications"."read" = false;--> statement-breakpoint
CREATE INDEX "family_links_primary_idx" ON "patient_family_links" USING btree ("primary_patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pharmacy_name_clinic" ON "pharmacies" USING btree ("clinic_id","name","is_deleted");--> statement-breakpoint
CREATE INDEX "pharmacy_medicines_hsn_id_idx" ON "pharmacy_medicines" USING btree ("hsn_id");--> statement-breakpoint
CREATE INDEX "pharmacy_medicines_pharmacy_id_idx" ON "pharmacy_medicines" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_medicines_status_idx" ON "pharmacy_medicines" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_medicine_name" ON "pharmacy_medicines" USING btree ("medicine_name","pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_hsn_code" ON "hsn_tax_master" USING btree ("hsn_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hsn_effective" ON "hsn_tax_master" USING btree ("hsn_code","effective_from");--> statement-breakpoint
CREATE INDEX "idx_pharmacy_tags_created_at" ON "pharmacy_medicine_tags" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_pharmacy_tags_pharmacy_id" ON "pharmacy_medicine_tags" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_pharmacy_tags_tag" ON "pharmacy_medicine_tags" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_pharmacy_tag" ON "pharmacy_medicine_tags" USING btree ("pharmacy_id","tag");--> statement-breakpoint
CREATE INDEX "idx_tags_map_medicine_id" ON "pharmacy_tags_map" USING btree ("medicine_id");--> statement-breakpoint
CREATE INDEX "idx_tags_map_tag_id" ON "pharmacy_tags_map" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_medicine_tag" ON "pharmacy_tags_map" USING btree ("medicine_id","tag_id");--> statement-breakpoint
CREATE INDEX "pharmacy_subscription_delivery_idx" ON "pharmacy_patient_subscription" USING btree ("next_delivery_date");--> statement-breakpoint
CREATE INDEX "pharmacy_subscription_mobile_idx" ON "pharmacy_patient_subscription" USING btree ("customer_mobile");--> statement-breakpoint
CREATE INDEX "pharmacy_subscription_pharmacy_id_idx" ON "pharmacy_patient_subscription" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "subscription_medicine_medicine_idx" ON "pharmacy_subscription_medicines" USING btree ("pharmacy_medicine_id");--> statement-breakpoint
CREATE INDEX "subscription_medicine_subscription_idx" ON "pharmacy_subscription_medicines" USING btree ("pharmacy_patient_subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_sales_sales_idx" ON "pharmacy_subscription_sales_map" USING btree ("pharmacy_sales_id");--> statement-breakpoint
CREATE INDEX "subscription_sales_subscription_idx" ON "pharmacy_subscription_sales_map" USING btree ("pharmacy_patient_subscription_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_created_at_idx" ON "pharmacy_sales" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_created_by_idx" ON "pharmacy_sales" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_pharmacy_created_idx" ON "pharmacy_sales" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_pharmacy_id_idx" ON "pharmacy_sales" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_prescription_id_idx" ON "pharmacy_sales" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "prescription_queue_appointment_id_idx" ON "prescription_queue" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "prescription_queue_clinic_status_idx" ON "prescription_queue" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "prescription_queue_doctor_id_idx" ON "prescription_queue" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_items_created_at_idx" ON "pharmacy_sales_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_items_sales_id_idx" ON "pharmacy_sales_items" USING btree ("pharmacy_sales_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_items_stock_medicine_idx" ON "pharmacy_sales_items" USING btree ("pharmacy_stock_medicine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sales_item" ON "pharmacy_sales_items" USING btree ("pharmacy_sales_id","pharmacy_stock_medicine_id");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_created_at_idx" ON "pharmacy_stock_medicine" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_expiry_idx" ON "pharmacy_stock_medicine" USING btree ("expiry");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_medicine_id_idx" ON "pharmacy_stock_medicine" USING btree ("pharmacy_medicine_id");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_quantity_idx" ON "pharmacy_stock_medicine" USING btree ("quantity");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_medicine_stock_id_idx" ON "pharmacy_stock_medicine" USING btree ("pharmacy_stock_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pharmacy_medicine_batch" ON "pharmacy_stock_medicine" USING btree ("pharmacy_stock_id","pharmacy_medicine_id","batch");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_pharmacy_id_idx" ON "pharmacy_stock" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_pharmacy_payment_idx" ON "pharmacy_stock" USING btree ("pharmacy_id","pharmacy_stock_payment_status");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_purchase_date_idx" ON "pharmacy_stock" USING btree ("purchase_date");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_created_at_idx" ON "pharmacy_suppliers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_gst_number_idx" ON "pharmacy_suppliers" USING btree ("gst_number");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_pharmacy_id_idx" ON "pharmacy_suppliers" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_pharmacy_status_idx" ON "pharmacy_suppliers" USING btree ("pharmacy_id","status");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_phone_idx" ON "pharmacy_suppliers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "pharmacy_suppliers_status_idx" ON "pharmacy_suppliers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_name_pharmacy" ON "pharmacy_suppliers" USING btree ("pharmacy_id","supplier_name");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pharmacy_user" ON "pharmacy_assign" USING btree ("user_id","pharmacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_report" ON "reports" USING btree ("report_type","petient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_unique" ON "settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "add_on_feature_key_unique" ON "add_ons" USING btree ("feature_key");--> statement-breakpoint
CREATE INDEX "clinic_add_ons_active_idx" ON "clinic_add_ons" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "clinic_add_ons_add_on_idx" ON "clinic_add_ons" USING btree ("add_on_id");--> statement-breakpoint
CREATE INDEX "clinic_add_ons_clinic_idx" ON "clinic_add_ons" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "coupons_code_idx" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "coupons_status_idx" ON "coupons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "coupon_usage_clinic_used_idx" ON "coupon_usage" USING btree ("clinic_id","used_at");--> statement-breakpoint
CREATE INDEX "coupon_usage_coupon_id_idx" ON "coupon_usage" USING btree ("coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plan_unique" ON "subscription_plans" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_features_plan_key_unique" ON "plan_features" USING btree ("plan_id","feature_key");--> statement-breakpoint
CREATE INDEX "idx_lab_order_tracking_events_appointment_test_id" ON "lab_order_tracking_events" USING btree ("appointment_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_tracking_events_clinic_id" ON "lab_order_tracking_events" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "idx_lab_order_tracking_events_created_at" ON "lab_order_tracking_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_lab_order_tracking_events_lab_id" ON "lab_order_tracking_events" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_test_catalog_department_id" ON "lab_test_catalog" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_lab_test_catalog_lab_id" ON "lab_test_catalog" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_test_catalog_status" ON "lab_test_catalog" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lab_test_catalog_test_code" ON "lab_test_catalog" USING btree ("test_code");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_test_catalog_lab_department_custom_name_unique" ON "lab_test_catalog" USING btree ("lab_id","department_id","name") WHERE source = 'custom' AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_code_unique" ON "referrals" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "referral_created_at_idx" ON "referrals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "referral_referred_by_idx" ON "referrals" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "referral_referred_to_idx" ON "referrals" USING btree ("referred_to");--> statement-breakpoint
CREATE INDEX "referral_status_idx" ON "referrals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tokens_patient_otp_mobile_idx" ON "tokens" USING btree ("email","type");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_registration_token" ON "tokens" USING btree ("email","token_hash","type");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_token_hash" ON "tokens" USING btree ("user_id","token_hash","type");--> statement-breakpoint
CREATE INDEX "user_professional_license_idx" ON "user_professionals" USING btree ("license_number");--> statement-breakpoint
CREATE INDEX "user_professional_user_id_idx" ON "user_professionals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_profile_user_id_idx" ON "user_profiles" USING btree ("user_id");