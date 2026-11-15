ALTER TABLE "clinic_subscriptions" ADD COLUMN "provider_mandate_id" varchar(200);--> statement-breakpoint
ALTER TABLE "clinic_subscriptions" ADD COLUMN "pending_provider_subscription_id" varchar(200);--> statement-breakpoint
ALTER TABLE "clinic_subscriptions" ADD COLUMN "auto_renew_payment_method" varchar(32);--> statement-breakpoint
ALTER TABLE "clinic_subscriptions" ADD COLUMN "auto_renew_failure_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "clinic_subscriptions" DROP COLUMN "razorpay_subscription_id";