CREATE TABLE "appointment_registration_counters" (
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"last_no" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_registration_counters_clinic_id_doctor_id_pk" PRIMARY KEY("clinic_id","doctor_id")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "registration_no" integer;--> statement-breakpoint
ALTER TABLE "doctor_preferences" ADD COLUMN "instruction_suggestions" json;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "registration_number" varchar(30);--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "gst_number" varchar(20);--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "pan_number" varchar(10);--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "license_number" varchar(30);--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "fssai_number" varchar(20);--> statement-breakpoint
ALTER TABLE "appointment_registration_counters" ADD CONSTRAINT "appointment_registration_counters_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_registration_counters" ADD CONSTRAINT "appointment_registration_counters_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_appt_registration_no_per_doctor" ON "appointments" USING btree ("clinic_id","doctor_id","registration_no") WHERE "appointments"."registration_no" IS NOT NULL;