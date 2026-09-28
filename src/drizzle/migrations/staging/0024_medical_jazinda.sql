CREATE TYPE "public"."doctor_arrival_source" AS ENUM('self', 'reception', 'auto_confirm');--> statement-breakpoint
ALTER TYPE "public"."session_override_type" ADD VALUE 'slot_config';--> statement-breakpoint
ALTER TYPE "public"."session_override_type" ADD VALUE 'extra_slots';--> statement-breakpoint
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
DROP INDEX "doctor_session_overrides_lookup_idx";--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ALTER COLUMN "value_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "session_start" varchar;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "slot_minutes" integer;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "step_minutes" integer;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "number_of_slots" integer;--> statement-breakpoint
ALTER TABLE "doctor_session_overrides" ADD COLUMN "no_of_patients" integer;--> statement-breakpoint
ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_arrivals" ADD CONSTRAINT "doctor_arrivals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_arrivals_lookup_idx" ON "doctor_arrivals" USING btree ("doctor_id","for_date","session_start","created_at");--> statement-breakpoint
CREATE INDEX "doctor_arrivals_clinic_date_idx" ON "doctor_arrivals" USING btree ("clinic_id","for_date");--> statement-breakpoint
CREATE INDEX "doctor_session_overrides_lookup_idx" ON "doctor_session_overrides" USING btree ("doctor_id","for_date","type","session_start","created_at");