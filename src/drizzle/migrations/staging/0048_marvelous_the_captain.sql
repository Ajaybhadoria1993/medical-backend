CREATE TABLE "plan_add_on_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"add_on_id" uuid NOT NULL,
	"max_cap" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "plan_add_on_limits" ADD CONSTRAINT "plan_add_on_limits_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_add_on_limits" ADD CONSTRAINT "plan_add_on_limits_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_add_on_limits_plan_addon_unique" ON "plan_add_on_limits" USING btree ("plan_id","add_on_id");--> statement-breakpoint
CREATE INDEX "plan_add_on_limits_plan_idx" ON "plan_add_on_limits" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_add_on_limits_addon_idx" ON "plan_add_on_limits" USING btree ("add_on_id");--> statement-breakpoint
CREATE INDEX "appointments_patient_doctor_idx" ON "appointments" USING btree ("patient_id","doctor_id");--> statement-breakpoint
ALTER TABLE "add_ons" DROP COLUMN "max_cap";