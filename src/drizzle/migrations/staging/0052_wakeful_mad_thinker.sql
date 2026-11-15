CREATE TYPE "public"."lab_test_package_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TABLE "lab_test_package_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"lab_test_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lab_test_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"package_name" varchar(50) NOT NULL,
	"package_code" varchar(30) NOT NULL,
	"package_description" varchar(200) NOT NULL,
	"package_price" integer NOT NULL,
	"status" "lab_test_package_status" DEFAULT 'Active' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lab_updated_test_result_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"parameter_name" varchar(255) NOT NULL,
	"input_type" varchar(30) DEFAULT 'text' NOT NULL,
	"unit" varchar(80),
	"reference_range" varchar(255),
	"is_required" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(80) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"template_name" varchar(100) DEFAULT 'labReportTemplate1' NOT NULL,
	"color1" varchar(20) NOT NULL,
	"color2" varchar(20) NOT NULL,
	"color3" varchar(20) NOT NULL,
	"color4" varchar(20) NOT NULL,
	"color5" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_order_id" uuid NOT NULL,
	"parameter_id" uuid NOT NULL,
	"result_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"test_name" varchar(255) NOT NULL,
	"test_description" text,
	"test_code" varchar(100) NOT NULL,
	"sample_type" varchar(100) NOT NULL,
	"price" integer NOT NULL,
	"department_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_test_package_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"lab_test_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_test_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"package_name" varchar(100) NOT NULL,
	"package_code" varchar(50) NOT NULL,
	"package_price" integer NOT NULL,
	"status" varchar(20) DEFAULT 'Active' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_orders" DROP CONSTRAINT "lab_orders_lab_assistant_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "lab_orders" DROP CONSTRAINT "lab_orders_payment_collected_by_users_id_fk";
--> statement-breakpoint
DROP INDEX "lab_orders_unique_test_id_unique";--> statement-breakpoint
DROP INDEX "idx_lab_orders_lab_assistant_id";--> statement-breakpoint
DROP INDEX "idx_lab_orders_lab_assistant_created_at";--> statement-breakpoint
ALTER TABLE "lab_orders" ALTER COLUMN "test_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD COLUMN "lab_test_catalog_id" uuid;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "lab_updated_test_id" uuid;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "lab_updated_test_package_id" uuid;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "referring_doctor_name" varchar(255);--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "payment_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "payment_notes" text;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "sample_code" varchar(30);--> statement-breakpoint
ALTER TABLE "lab_test_package_items" ADD CONSTRAINT "lab_test_package_items_package_id_lab_test_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."lab_test_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_package_items" ADD CONSTRAINT "lab_test_package_items_lab_test_id_lab_test_catalog_id_fk" FOREIGN KEY ("lab_test_id") REFERENCES "public"."lab_test_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_packages" ADD CONSTRAINT "lab_test_packages_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_test_result_parameters" ADD CONSTRAINT "lab_updated_test_result_parameters_test_id_lab_updated_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."lab_updated_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_department" ADD CONSTRAINT "lab_updated_department_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_report" ADD CONSTRAINT "lab_updated_report_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_result" ADD CONSTRAINT "lab_updated_result_lab_order_id_lab_orders_id_fk" FOREIGN KEY ("lab_order_id") REFERENCES "public"."lab_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_result" ADD CONSTRAINT "lab_updated_result_parameter_id_lab_updated_test_result_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_updated_test_result_parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD CONSTRAINT "lab_updated_tests_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD CONSTRAINT "lab_updated_tests_department_id_lab_updated_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."lab_updated_department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_test_package_items" ADD CONSTRAINT "lab_updated_test_package_items_package_id_lab_updated_test_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."lab_updated_test_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_test_package_items" ADD CONSTRAINT "lab_updated_test_package_items_lab_test_id_lab_updated_tests_id_fk" FOREIGN KEY ("lab_test_id") REFERENCES "public"."lab_updated_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_test_packages" ADD CONSTRAINT "lab_updated_test_packages_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_test_package_items_package_lab_test_unique" ON "lab_test_package_items" USING btree ("package_id","lab_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_test_package_items_package_id" ON "lab_test_package_items" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "idx_lab_test_package_items_lab_test_id" ON "lab_test_package_items" USING btree ("lab_test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_test_packages_lab_code_unique" ON "lab_test_packages" USING btree ("lab_id","package_code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_lab_test_packages_lab_id" ON "lab_test_packages" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_test_packages_status" ON "lab_test_packages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_test_result_parameters_test_name" ON "lab_updated_test_result_parameters" USING btree ("test_id","parameter_name") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_result_parameters_test_id" ON "lab_updated_test_result_parameters" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_result_parameters_active" ON "lab_updated_test_result_parameters" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_department_lab_code" ON "lab_updated_department" USING btree ("lab_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_department_lab_name" ON "lab_updated_department" USING btree ("lab_id","name");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_department_lab_id" ON "lab_updated_department" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_department_status" ON "lab_updated_department" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_report_lab_id" ON "lab_updated_report" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_report_lab_id" ON "lab_updated_report" USING btree ("lab_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_result_order_parameter" ON "lab_updated_result" USING btree ("lab_order_id","parameter_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_result_lab_order_id" ON "lab_updated_result" USING btree ("lab_order_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_result_parameter_id" ON "lab_updated_result" USING btree ("parameter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_tests_lab_code" ON "lab_updated_tests" USING btree ("lab_id","test_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_tests_lab_department_name" ON "lab_updated_tests" USING btree ("lab_id","department_id","test_name");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_tests_lab_id" ON "lab_updated_tests" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_tests_department_id" ON "lab_updated_tests" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_tests_status" ON "lab_updated_tests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_tests_test_code" ON "lab_updated_tests" USING btree ("test_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_test_package_items_package_test" ON "lab_updated_test_package_items" USING btree ("package_id","lab_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_package_items_package_id" ON "lab_updated_test_package_items" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_package_items_lab_test_id" ON "lab_updated_test_package_items" USING btree ("lab_test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_test_packages_lab_code" ON "lab_updated_test_packages" USING btree ("lab_id","package_code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_test_packages_lab_name" ON "lab_updated_test_packages" USING btree ("lab_id","package_name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_packages_lab_id" ON "lab_updated_test_packages" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_packages_status" ON "lab_updated_test_packages" USING btree ("status");--> statement-breakpoint
ALTER TABLE "lab_report_template_parameters" ADD CONSTRAINT "lab_report_template_parameters_lab_test_catalog_id_lab_test_catalog_id_fk" FOREIGN KEY ("lab_test_catalog_id") REFERENCES "public"."lab_test_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_lab_updated_test_id_lab_updated_tests_id_fk" FOREIGN KEY ("lab_updated_test_id") REFERENCES "public"."lab_updated_tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_lab_updated_test_package_id_lab_updated_test_packages_id_fk" FOREIGN KEY ("lab_updated_test_package_id") REFERENCES "public"."lab_updated_test_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lab_report_template_parameters_lab_test_catalog_id" ON "lab_report_template_parameters" USING btree ("lab_test_catalog_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_lab_updated_test_id" ON "lab_orders" USING btree ("lab_updated_test_id");--> statement-breakpoint
CREATE INDEX "idx_lab_orders_lab_updated_test_package_id" ON "lab_orders" USING btree ("lab_updated_test_package_id");--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "unique_test_id";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "is_external_lab_report";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "lab_assistant_id";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "rejected_at";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "rejection_reason";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "payment_collected_at";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "payment_collected_by";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "sample_collected_at";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "sample_received_at";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "processing_started_at";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "testing_started_at";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "quality_checked_at";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "expected_report_ready_at";--> statement-breakpoint
ALTER TABLE "lab_orders" DROP COLUMN "ready_for_report_at";