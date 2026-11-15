ALTER TYPE "public"."appointment_activity_action" ADD VALUE 'FOLLOW_UP_CALL';--> statement-breakpoint
ALTER TYPE "public"."appointment_activity_action" ADD VALUE 'FOLLOW_UP_DISMISSED';--> statement-breakpoint
ALTER TYPE "public"."test_report_status" ADD VALUE 'Collected' BEFORE 'Completed';--> statement-breakpoint
ALTER TABLE "treatment_step_appointments" ADD COLUMN "covered_type" varchar(50);--> statement-breakpoint
ALTER TABLE "treatment_step_appointments" ADD COLUMN "covered_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "treatment_step_appointments" ADD COLUMN "covered_primary_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "treatment_step_appointments" ADD COLUMN "covered_payment_mode" varchar(50);--> statement-breakpoint
CREATE INDEX "appointment_activity_history_action_appt_idx" ON "appointment_activity_history" USING btree ("action","appointment_id");--> statement-breakpoint
CREATE INDEX "report_cards_appointment_idx" ON "report_cards" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "report_cards_follow_up_date_idx" ON "report_cards" USING btree ("follow_up_date") WHERE "report_cards"."follow_up_date" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_templates" DROP COLUMN "category";