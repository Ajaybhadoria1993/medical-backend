CREATE TYPE "public"."visiting_request_status" AS ENUM('Pending', 'Scheduled', 'Cancelled');--> statement-breakpoint
CREATE TABLE "visiting_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_appointment_id" uuid NOT NULL,
	"report_card_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"requested_date" timestamp NOT NULL,
	"status" "visiting_request_status" DEFAULT 'Pending' NOT NULL,
	"generated_appointment_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "doctor_preferences" ALTER COLUMN "header_order" SET DEFAULT '["Pathology Test Name","Advice","Pre-Diagnosis","Dietary Suggestions","Habits","Vitals","Allergy","Diagnosis","Surgery Suggested","Visiting Days","Follow-Up (days)"]'::json;--> statement-breakpoint
ALTER TABLE "report_cards" ADD COLUMN "pre_diagnosis" text;--> statement-breakpoint
ALTER TABLE "visiting_requests" ADD CONSTRAINT "visiting_requests_source_appointment_id_appointments_id_fk" FOREIGN KEY ("source_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visiting_requests" ADD CONSTRAINT "visiting_requests_report_card_id_report_cards_id_fk" FOREIGN KEY ("report_card_id") REFERENCES "public"."report_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visiting_requests" ADD CONSTRAINT "visiting_requests_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visiting_requests" ADD CONSTRAINT "visiting_requests_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visiting_requests" ADD CONSTRAINT "visiting_requests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visiting_requests" ADD CONSTRAINT "visiting_requests_generated_appointment_id_appointments_id_fk" FOREIGN KEY ("generated_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visiting_requests_source_date_unique" ON "visiting_requests" USING btree ("source_appointment_id","requested_date");--> statement-breakpoint
CREATE INDEX "visiting_requests_clinic_status_idx" ON "visiting_requests" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "visiting_requests_doctor_date_idx" ON "visiting_requests" USING btree ("doctor_id","requested_date");--> statement-breakpoint
CREATE INDEX "visiting_requests_generated_appointment_idx" ON "visiting_requests" USING btree ("generated_appointment_id");