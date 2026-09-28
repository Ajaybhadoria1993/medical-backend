CREATE TABLE "clinic_onboarding_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"performed_by" uuid NOT NULL,
	"reason" varchar(500),
	"reset_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "delete_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "clinic_onboarding_resets" ADD CONSTRAINT "clinic_onboarding_resets_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_onboarding_resets" ADD CONSTRAINT "clinic_onboarding_resets_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clinic_onboarding_resets_clinic" ON "clinic_onboarding_resets" USING btree ("clinic_id","reset_at");--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;