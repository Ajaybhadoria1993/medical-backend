ALTER TABLE "clinic_add_ons" ADD COLUMN "scheduled_reduction_by" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_add_ons" ADD COLUMN "reduction_effective_at" timestamp;