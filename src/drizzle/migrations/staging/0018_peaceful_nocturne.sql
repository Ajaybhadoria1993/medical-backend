CREATE TYPE "public"."session_override_type" AS ENUM('running_late');--> statement-breakpoint
CREATE TYPE "public"."late_patient_policy" AS ENUM('keep_position', 'move_back', 'move_to_end');--> statement-breakpoint
CREATE TABLE "doctor_session_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"for_date" date NOT NULL,
	"type" "session_override_type" NOT NULL,
	"value_minutes" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "arrived_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "late_queue_demotion" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_assign" ADD COLUMN "default_consultation_minutes" integer;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "default_consultation_minutes" integer;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "late_patient_policy" "late_patient_policy" DEFAULT 'move_back' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "late_patient_move_positions" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD CONSTRAINT "doctor_session_overrides_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD CONSTRAINT "doctor_session_overrides_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD CONSTRAINT "doctor_session_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_session_overrides_lookup_idx" ON "doctor_session_overrides" USING btree ("doctor_id","for_date","type","created_at");--> statement-breakpoint
CREATE INDEX "doctor_session_overrides_clinic_date_idx" ON "doctor_session_overrides" USING btree ("clinic_id","for_date");