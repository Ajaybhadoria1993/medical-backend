CREATE TABLE "lab_updated_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"lab_order_id" uuid NOT NULL,
	"activity" text NOT NULL,
	"performed_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_parameter_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parameter_id" uuid NOT NULL,
	"option_value" varchar(100) NOT NULL,
	"is_normal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_parameter_reference_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parameter_id" uuid NOT NULL,
	"gender" varchar(20) DEFAULT 'All' NOT NULL,
	"age_from_years" numeric(6, 3),
	"age_to_years" numeric(6, 3),
	"condition" varchar(100),
	"type" varchar(20) DEFAULT 'range' NOT NULL,
	"low_range" numeric(12, 4),
	"high_range" numeric(12, 4),
	"label" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_test_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"alias" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_updated_test_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "ux_lab_updated_payments_lab_order_id";--> statement-breakpoint
ALTER TABLE "lab_updated_test_result_parameters" ADD COLUMN "code" varchar(50);--> statement-breakpoint
ALTER TABLE "lab_updated_test_result_parameters" ADD COLUMN "unitless" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_updated_test_result_parameters" ADD COLUMN "decimals" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_updated_test_result_parameters" ADD COLUMN "section" varchar(150);--> statement-breakpoint
ALTER TABLE "lab_updated_test_result_parameters" ADD COLUMN "formula" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "short_name" varchar(100);--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "loinc_code" varchar(30);--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "container" varchar(100);--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "sample_volume" varchar(100);--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "stability" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "storage" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "technology" varchar(150);--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "test_type" varchar(50);--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "turnaround_time_hours" integer;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "clinical_significance" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "limitations" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "advice" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "test_disclaimer" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "when_result_high" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "when_result_low" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "when_result_critical" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_updated_activity" ADD CONSTRAINT "lab_updated_activity_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_activity" ADD CONSTRAINT "lab_updated_activity_lab_order_id_lab_orders_id_fk" FOREIGN KEY ("lab_order_id") REFERENCES "public"."lab_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_activity" ADD CONSTRAINT "lab_updated_activity_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_parameter_options" ADD CONSTRAINT "lab_updated_parameter_options_parameter_id_lab_updated_test_result_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_updated_test_result_parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_parameter_reference_ranges" ADD CONSTRAINT "lab_updated_parameter_reference_ranges_parameter_id_lab_updated_test_result_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_updated_test_result_parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_test_aliases" ADD CONSTRAINT "lab_updated_test_aliases_test_id_lab_updated_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."lab_updated_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_updated_test_groups" ADD CONSTRAINT "lab_updated_test_groups_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lab_updated_activity_lab_id" ON "lab_updated_activity" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_activity_lab_order_id" ON "lab_updated_activity" USING btree ("lab_order_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_activity_performed_by" ON "lab_updated_activity" USING btree ("performed_by");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_activity_created_at" ON "lab_updated_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_parameter_options_parameter_id" ON "lab_updated_parameter_options" USING btree ("parameter_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_parameter_reference_ranges_parameter_id" ON "lab_updated_parameter_reference_ranges" USING btree ("parameter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_test_aliases_test_alias" ON "lab_updated_test_aliases" USING btree ("test_id","alias");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_aliases_test_id" ON "lab_updated_test_aliases" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lab_updated_test_groups_lab_name" ON "lab_updated_test_groups" USING btree ("lab_id","name");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_groups_lab_id" ON "lab_updated_test_groups" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "idx_lab_updated_test_groups_status" ON "lab_updated_test_groups" USING btree ("status");--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD CONSTRAINT "lab_updated_tests_group_id_lab_updated_test_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."lab_updated_test_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lab_updated_tests_group_id" ON "lab_updated_tests" USING btree ("group_id");