CREATE TABLE "doctor_gallery_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_image_id" uuid,
	"image_url" text NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"note" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctor_gallery_share" ADD CONSTRAINT "doctor_gallery_share_gallery_image_id_doctor_gallery_id_fk" FOREIGN KEY ("gallery_image_id") REFERENCES "public"."doctor_gallery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_gallery_share" ADD CONSTRAINT "doctor_gallery_share_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_gallery_share" ADD CONSTRAINT "doctor_gallery_share_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_gallery_share" ADD CONSTRAINT "doctor_gallery_share_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_gallery_share_appointment_image_uq" ON "doctor_gallery_share" USING btree ("appointment_id","image_url");--> statement-breakpoint
CREATE INDEX "doctor_gallery_share_patient_idx" ON "doctor_gallery_share" USING btree ("patient_id");