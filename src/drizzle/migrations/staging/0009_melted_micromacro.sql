CREATE TABLE "financial_ledgers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"entry_type" varchar(50) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" varchar(255),
	"gateway_reference_id" varchar(255),
	"meta_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_commissions" DROP CONSTRAINT "clinic_commissions_clinic_id_unique";--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD COLUMN "platform_commission" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD COLUMN "pg_fee" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD COLUMN "gst_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD COLUMN "convenience_fee" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD COLUMN "transferred_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD COLUMN "transfers_data" jsonb;--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD COLUMN "financial_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD COLUMN "pg_fee_bearer" varchar(50) DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD COLUMN "pg_fee_percentage" numeric(5, 2) DEFAULT '2.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD COLUMN "gst_on_commission_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD COLUMN "gst_percentage" numeric(5, 2) DEFAULT '18.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD COLUMN "effective_from" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_commissions" ADD COLUMN "effective_to" timestamp;--> statement-breakpoint
ALTER TABLE "financial_ledgers" ADD CONSTRAINT "financial_ledgers_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledgers" ADD CONSTRAINT "financial_ledgers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledgers" ADD CONSTRAINT "financial_ledgers_payment_id_appointment_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."appointment_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_clinic_idx" ON "financial_ledgers" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "ledger_appointment_idx" ON "financial_ledgers" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "ledger_gateway_ref_idx" ON "financial_ledgers" USING btree ("gateway_reference_id");--> statement-breakpoint
CREATE INDEX "clinic_commission_active_idx" ON "clinic_commissions" USING btree ("clinic_id","is_active");