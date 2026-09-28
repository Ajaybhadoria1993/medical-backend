CREATE TABLE "clinic_razorpay_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"razorpay_account_id" varchar(255),
	"razorpay_stakeholder_id" varchar(255),
	"route_status" varchar(50) DEFAULT 'INACTIVE' NOT NULL,
	"route_onboarded_at" timestamp,
	"route_onboarding_rejection_reason" text,
	"onboarding_draft_data" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_purchase_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_return_id" uuid NOT NULL,
	"stock_medicine_id" uuid NOT NULL,
	"returned_quantity" integer DEFAULT 0 NOT NULL,
	"refund_amount" numeric(12, 2) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "pharmacy_purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"total_return_amount" numeric(12, 2) DEFAULT '0',
	"refund_method" varchar,
	"return_reason" varchar(255) NOT NULL,
	"refund_notes" varchar(500),
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "prescription_queue" ALTER COLUMN "report_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_razorpay_accounts" ADD CONSTRAINT "clinic_razorpay_accounts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_return_items" ADD CONSTRAINT "pharmacy_purchase_return_items_purchase_return_id_pharmacy_purchase_returns_id_fk" FOREIGN KEY ("purchase_return_id") REFERENCES "public"."pharmacy_purchase_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_return_items" ADD CONSTRAINT "pharmacy_purchase_return_items_stock_medicine_id_pharmacy_stock_medicine_id_fk" FOREIGN KEY ("stock_medicine_id") REFERENCES "public"."pharmacy_stock_medicine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_returns" ADD CONSTRAINT "pharmacy_purchase_returns_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_returns" ADD CONSTRAINT "pharmacy_purchase_returns_stock_id_pharmacy_stock_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."pharmacy_stock"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_returns" ADD CONSTRAINT "pharmacy_purchase_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_razorpay_clinic_unique" ON "clinic_razorpay_accounts" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_return_items_return_id_idx" ON "pharmacy_purchase_return_items" USING btree ("purchase_return_id");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_return_items_stock_medicine_id_idx" ON "pharmacy_purchase_return_items" USING btree ("stock_medicine_id");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_pharmacy_id_idx" ON "pharmacy_purchase_returns" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_stock_id_idx" ON "pharmacy_purchase_returns" USING btree ("stock_id");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_created_by_idx" ON "pharmacy_purchase_returns" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_created_at_idx" ON "pharmacy_purchase_returns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_returns_pharmacy_created_idx" ON "pharmacy_purchase_returns" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
ALTER TABLE "clinics" DROP COLUMN "razorpay_account_id";--> statement-breakpoint
ALTER TABLE "clinics" DROP COLUMN "route_status";--> statement-breakpoint
ALTER TABLE "clinics" DROP COLUMN "route_onboarded_at";