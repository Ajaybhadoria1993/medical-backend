CREATE TABLE "visit_examinations" (
	"appointment_id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"findings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_vaccines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"vaccine" varchar(100) NOT NULL,
	"dose_no" integer NOT NULL,
	"given_on" date NOT NULL,
	"given_by" uuid,
	"batch" varchar(50),
	"appointment_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_examinations" ADD CONSTRAINT "visit_examinations_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_examinations" ADD CONSTRAINT "visit_examinations_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_examinations" ADD CONSTRAINT "visit_examinations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_vaccines" ADD CONSTRAINT "patient_vaccines_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_vaccines" ADD CONSTRAINT "patient_vaccines_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_vaccines" ADD CONSTRAINT "patient_vaccines_given_by_users_id_fk" FOREIGN KEY ("given_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_vaccines" ADD CONSTRAINT "patient_vaccines_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_visit_examinations_patient_clinic" ON "visit_examinations" USING btree ("patient_id","clinic_id");--> statement-breakpoint
CREATE INDEX "idx_patient_vaccines_patient_clinic" ON "patient_vaccines" USING btree ("patient_id","clinic_id");--> statement-breakpoint
CREATE INDEX "idx_patient_vaccines_appointment" ON "patient_vaccines" USING btree ("appointment_id");