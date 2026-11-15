CREATE TYPE "public"."lab_home_collection_unit" AS ENUM('m', 'km');--> statement-breakpoint
CREATE TABLE "lab_updated_home_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"from_range" numeric(10, 2) NOT NULL,
	"to_range" numeric(10, 2) NOT NULL,
	"unit" "lab_home_collection_unit" DEFAULT 'km' NOT NULL,
	"price" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_order_home_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"home_collection_price" integer NOT NULL,
	"rate_id" uuid,
	"distance" numeric(10, 2),
	"unit" "lab_home_collection_unit",
	"lab_order_ids" uuid[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_updated_home_collections" ADD CONSTRAINT "lab_updated_home_collections_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_order_home_collections" ADD CONSTRAINT "lab_updated_order_home_collections_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_order_home_collections" ADD CONSTRAINT "lab_updated_order_home_collections_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_order_home_collections" ADD CONSTRAINT "lab_updated_order_home_collections_rate_id_lab_updated_home_collections_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."lab_updated_home_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lab_updated_home_collections_lab_id" ON "lab_updated_home_collections" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_home_collections_active" ON "lab_updated_home_collections" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_home_collections_range" ON "lab_updated_home_collections" USING btree ("lab_id","unit","from_range","to_range");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_order_home_collections_lab_id" ON "lab_updated_order_home_collections" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_order_home_collections_patient_id" ON "lab_updated_order_home_collections" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_order_home_collections_rate_id" ON "lab_updated_order_home_collections" USING btree ("rate_id");