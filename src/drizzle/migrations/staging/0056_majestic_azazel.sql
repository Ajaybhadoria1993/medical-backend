ALTER TYPE "public"."money_entry_type" ADD VALUE 'advance';--> statement-breakpoint
ALTER TYPE "public"."money_entry_type" ADD VALUE 'paid_at_visit';--> statement-breakpoint
CREATE TABLE "lab_updated_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_order_id" uuid NOT NULL,
	"price" integer DEFAULT 0,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"payment_type" varchar(20) DEFAULT 'test' NOT NULL,
	"payment_mode" varchar(20),
	"payment_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treatment_ledger" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "treatment_ledger" CASCADE;--> statement-breakpoint
ALTER TABLE "money_entries" DROP CONSTRAINT "money_entries_reason_ck";--> statement-breakpoint
DROP INDEX "idx_lab_orders_payment_status";--> statement-breakpoint
ALTER TABLE "money_entries" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "lab_updated_payments" ADD CONSTRAINT "lab_updated_payments_lab_order_id_lab_orders_id_fk" FOREIGN KEY ("lab_order_id") REFERENCES "public"."lab_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_payments_lab_order_id" ON "lab_updated_payments" USING btree ("lab_order_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_payments_lab_order_id" ON "lab_updated_payments" USING btree ("lab_order_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_payments_payment_status" ON "lab_updated_payments" USING btree ("payment_status");--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "payment_status";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "price";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "payment_mode";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "payment_notes";--> statement-breakpoint
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_reason_ck" CHECK ("money_entries"."entry_type"::text IN ('charge', 'payment', 'advance', 'paid_at_visit') OR "money_entries"."reason" IS NOT NULL);--> statement-breakpoint
DROP TYPE "public"."tp_ledger_entry";