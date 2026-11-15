ALTER TABLE "treatment_plans" ADD COLUMN "recall_after_days" integer;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "instalments_allowed" boolean DEFAULT true NOT NULL;