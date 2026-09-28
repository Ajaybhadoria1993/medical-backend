CREATE TABLE "pharmacy_sales_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_return_id" uuid NOT NULL,
	"sales_item_id" uuid NOT NULL,
	"stock_medicine_id" uuid NOT NULL,
	"returned_quantity" integer DEFAULT 0 NOT NULL,
	"refund_amount" numeric(12, 2) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"gst_amount_return" numeric(12, 2) DEFAULT '0',
	"total_return_amount" numeric(12, 2) DEFAULT '0',
	"refund_method" varchar,
	"return_reason" varchar(255),
	"refund_notes" varchar(255),
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" ADD CONSTRAINT "pharmacy_sales_return_items_sales_return_id_pharmacy_sales_returns_id_fk" FOREIGN KEY ("sales_return_id") REFERENCES "public"."pharmacy_sales_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" ADD CONSTRAINT "pharmacy_sales_return_items_sales_item_id_pharmacy_sales_items_id_fk" FOREIGN KEY ("sales_item_id") REFERENCES "public"."pharmacy_sales_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_return_items" ADD CONSTRAINT "pharmacy_sales_return_items_stock_medicine_id_pharmacy_stock_medicine_id_fk" FOREIGN KEY ("stock_medicine_id") REFERENCES "public"."pharmacy_stock_medicine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_returns" ADD CONSTRAINT "pharmacy_sales_returns_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_returns" ADD CONSTRAINT "pharmacy_sales_returns_sale_id_pharmacy_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pharmacy_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales_returns" ADD CONSTRAINT "pharmacy_sales_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pharmacy_sales_return_items_return_id_idx" ON "pharmacy_sales_return_items" USING btree ("sales_return_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_return_items_sales_item_id_idx" ON "pharmacy_sales_return_items" USING btree ("sales_item_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_return_items_stock_medicine_id_idx" ON "pharmacy_sales_return_items" USING btree ("stock_medicine_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_pharmacy_id_idx" ON "pharmacy_sales_returns" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_sale_id_idx" ON "pharmacy_sales_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_created_by_idx" ON "pharmacy_sales_returns" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_created_at_idx" ON "pharmacy_sales_returns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_returns_pharmacy_created_idx" ON "pharmacy_sales_returns" USING btree ("pharmacy_id","created_at");