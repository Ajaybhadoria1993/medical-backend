CREATE TABLE "prescription_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"lang" varchar(8) NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"source_text" text NOT NULL,
	"translated_text" text,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctor_preferences" ADD COLUMN "prescription_language" varchar(8);--> statement-breakpoint
ALTER TABLE "doctor_preferences" ADD COLUMN "prescription_print_style" varchar(16);--> statement-breakpoint
ALTER TABLE "report_cards" ADD COLUMN "print_language" varchar(8);--> statement-breakpoint
ALTER TABLE "prescription_translations" ADD CONSTRAINT "prescription_translations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_translations" ADD CONSTRAINT "prescription_translations_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_prescription_translation" ON "prescription_translations" USING btree ("clinic_id","doctor_id","lang","source_hash");