CREATE SEQUENCE "public"."clinic_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "followup_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followup_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"priority" varchar(8) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"owner_admin_id" uuid,
	"reason" varchar(255) NOT NULL,
	"trigger_data" jsonb,
	"snoozed_until" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"outcome" varchar(32),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "clinic_code" varchar(16) DEFAULT 'MED-' || lpad(nextval('clinic_code_seq')::text, 6, '0') NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "acquisition_source" varchar(32) DEFAULT 'Unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "followup_notes" ADD CONSTRAINT "followup_notes_task_id_followup_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."followup_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followup_notes_task_created_idx" ON "followup_notes" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "followup_tasks_live_unique" ON "followup_tasks" USING btree ("clinic_id","type") WHERE status <> 'resolved';--> statement-breakpoint
CREATE INDEX "followup_tasks_status_opened_idx" ON "followup_tasks" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "followup_tasks_clinic_idx" ON "followup_tasks" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinics_clinic_code_unique" ON "clinics" USING btree ("clinic_code");--> statement-breakpoint
CREATE INDEX "ix_clinics_name_trgm" ON "clinics" USING gin ("clinic_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_clinics_code_trgm" ON "clinics" USING gin ("clinic_code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_clinics_phone_trgm" ON "clinics" USING gin ("clinic_phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_clinics_city_trgm" ON "clinics" USING gin ("city" gin_trgm_ops);