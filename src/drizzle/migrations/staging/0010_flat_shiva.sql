CREATE TABLE "clinic_bank_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"linked_account_id" uuid,
	"provider_linked_account_id" varchar(255) NOT NULL,
	"beneficiary_name" varchar(255),
	"bank_name" varchar(255),
	"masked_account_number" varchar(255),
	"ifsc_code" varchar(100),
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lab_report_layout_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"template_name" varchar(50) NOT NULL,
	"font_family" varchar(100) NOT NULL,
	"color1" varchar(20) NOT NULL,
	"color2" varchar(20) NOT NULL,
	"color3" varchar(20) NOT NULL,
	"color4" varchar(20) NOT NULL,
	"color5" varchar(20) NOT NULL,
	"color6" varchar(20) NOT NULL,
	"color7" varchar(20) NOT NULL,
	"color8" varchar(20) NOT NULL,
	"color9" varchar(20) NOT NULL,
	"color10" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "clinic_bank_history" ADD CONSTRAINT "clinic_bank_history_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_report_layout_templates" ADD CONSTRAINT "lab_report_layout_templates_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;