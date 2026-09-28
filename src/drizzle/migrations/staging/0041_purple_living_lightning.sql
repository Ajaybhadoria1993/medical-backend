ALTER TABLE "add_ons" ADD COLUMN "max_cap" integer;--> statement-breakpoint
ALTER TABLE "clinic_add_ons" ADD COLUMN "scheduled_deactivate_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "is_trial_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "trial_days" integer;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "is_default_fallback" boolean DEFAULT false NOT NULL;