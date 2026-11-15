ALTER TABLE "application_cancellation_policies" ALTER COLUMN "default_refund_cooldown_hours" SET DEFAULT 6;--> statement-breakpoint
ALTER TABLE "application_cancellation_policies" ALTER COLUMN "partial_refund_cooldown_hours" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "application_cancellation_policies" ALTER COLUMN "partial_refund_percentage" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "clinic_payment_accounts" ADD COLUMN "route_reference_id" varchar(20);--> statement-breakpoint
ALTER TABLE "clinic_payment_accounts" ADD COLUMN "route_product_id" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_payment_account_route_reference_unique" ON "clinic_payment_accounts" USING btree ("route_reference_id");