ALTER TABLE "clinic_assign" ADD COLUMN "online_booking_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "online_booking_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "pay_online_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "pay_at_clinic_enabled" boolean DEFAULT false NOT NULL;