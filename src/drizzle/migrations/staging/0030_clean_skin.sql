CREATE TABLE "doctor_weekly_shift_capacity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"day_of_week" varchar NOT NULL,
	"session_index" integer NOT NULL,
	"no_of_patients" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "session_index" integer;--> statement-breakpoint
ALTER TABLE "clinic_date_availability_time_slots" ADD COLUMN "no_of_patients" integer;--> statement-breakpoint
ALTER TABLE "doctor_weekly_shift_capacity" ADD CONSTRAINT "doctor_weekly_shift_capacity_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_weekly_shift_capacity" ADD CONSTRAINT "doctor_weekly_shift_capacity_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_weekly_shift_capacity" ON "doctor_weekly_shift_capacity" USING btree ("clinic_id","doctor_id","day_of_week","session_index");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_appt_token_per_session" ON "appointments" USING btree ("clinic_id","doctor_id","appointment_date","session_index","token_no") WHERE "appointments"."token_no" IS NOT NULL AND "appointments"."appointment_status" NOT IN ('Cancelled', 'NoShow');