CREATE TYPE "public"."staff_access_scope" AS ENUM('assigned_doctors', 'all_doctors');--> statement-breakpoint
ALTER TYPE "public"."session_override_type" ADD VALUE 'schedule_shift';--> statement-breakpoint
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
ALTER TABLE "labs" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_doctor_assignments" ADD CONSTRAINT "staff_doctor_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_scopes" ADD CONSTRAINT "staff_scopes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_doctor_assignment_unique" ON "staff_doctor_assignments" USING btree ("staff_user_id","clinic_id","doctor_user_id");--> statement-breakpoint
CREATE INDEX "idx_staff_doctor_by_doctor" ON "staff_doctor_assignments" USING btree ("clinic_id","doctor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_scopes_user_clinic_unique" ON "staff_scopes" USING btree ("user_id","clinic_id");