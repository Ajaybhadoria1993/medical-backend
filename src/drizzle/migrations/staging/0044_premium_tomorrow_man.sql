CREATE TABLE "clinic_settlement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"payment_provider" varchar(50) NOT NULL,
	"appointment_payment_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"provider_transfer_id" varchar(255),
	"clinic_amount" numeric(12, 2) NOT NULL,
	"reversed_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" varchar(30) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"payment_provider" varchar(50) NOT NULL,
	"provider_settlement_id" varchar(255) NOT NULL,
	"gateway_account_id" varchar(255),
	"cycle_start" timestamp NOT NULL,
	"cycle_end" timestamp NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(30) NOT NULL,
	"failure_reason" varchar(500),
	"expected_settlement_at" timestamp,
	"settled_at" timestamp,
	"gateway_response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"storage_url" text NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"provider_evidence_id" varchar(255),
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"appointment_payment_id" uuid NOT NULL,
	"payment_provider" varchar(50) NOT NULL,
	"provider_dispute_id" varchar(255) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(40) NOT NULL,
	"resolution_party" varchar(20),
	"filed_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"provider_response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "refund_review_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_review_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"storage_url" text NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_refund_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"cancellation_request_id" uuid NOT NULL,
	"cancellation_refund_id" uuid,
	"reason_category" varchar(100) NOT NULL,
	"policy_reference" varchar(100),
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(30) DEFAULT 'PENDING' NOT NULL,
	"patient_note" text,
	"decision" varchar(20),
	"decision_note" text,
	"failure_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "clinic_settlement_items" ADD CONSTRAINT "clinic_settlement_items_settlement_id_clinic_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."clinic_settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlement_items" ADD CONSTRAINT "clinic_settlement_items_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlement_items" ADD CONSTRAINT "clinic_settlement_items_appointment_payment_id_appointment_payments_id_fk" FOREIGN KEY ("appointment_payment_id") REFERENCES "public"."appointment_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlement_items" ADD CONSTRAINT "clinic_settlement_items_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settlements" ADD CONSTRAINT "clinic_settlements_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_evidence" ADD CONSTRAINT "payment_dispute_evidence_dispute_id_payment_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."payment_disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_evidence" ADD CONSTRAINT "payment_dispute_evidence_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_evidence" ADD CONSTRAINT "payment_dispute_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_appointment_payment_id_appointment_payments_id_fk" FOREIGN KEY ("appointment_payment_id") REFERENCES "public"."appointment_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_review_documents" ADD CONSTRAINT "refund_review_documents_refund_review_id_cancellation_refund_reviews_id_fk" FOREIGN KEY ("refund_review_id") REFERENCES "public"."cancellation_refund_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_review_documents" ADD CONSTRAINT "refund_review_documents_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_review_documents" ADD CONSTRAINT "refund_review_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_cancellation_request_id_cancellation_requests_id_fk" FOREIGN KEY ("cancellation_request_id") REFERENCES "public"."cancellation_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_cancellation_refund_id_cancellation_refunds_id_fk" FOREIGN KEY ("cancellation_refund_id") REFERENCES "public"."cancellation_refunds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_refund_reviews" ADD CONSTRAINT "cancellation_refund_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_settlement_transfer_unique" ON "clinic_settlement_items" USING btree ("payment_provider","provider_transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_settlement_payment_unique" ON "clinic_settlement_items" USING btree ("settlement_id","appointment_payment_id");--> statement-breakpoint
CREATE INDEX "clinic_settlement_item_clinic_idx" ON "clinic_settlement_items" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_settlement_item_appointment_idx" ON "clinic_settlement_items" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_settlement_provider_unique" ON "clinic_settlements" USING btree ("payment_provider","provider_settlement_id");--> statement-breakpoint
CREATE INDEX "clinic_settlement_clinic_status_idx" ON "clinic_settlements" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "clinic_settlement_cycle_idx" ON "clinic_settlements" USING btree ("clinic_id","cycle_start","cycle_end");--> statement-breakpoint
CREATE INDEX "payment_dispute_evidence_dispute_idx" ON "payment_dispute_evidence" USING btree ("dispute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_dispute_provider_unique" ON "payment_disputes" USING btree ("payment_provider","provider_dispute_id");--> statement-breakpoint
CREATE INDEX "payment_dispute_clinic_status_idx" ON "payment_disputes" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "payment_dispute_appointment_idx" ON "payment_disputes" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "refund_review_document_review_idx" ON "refund_review_documents" USING btree ("refund_review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_review_appointment_unique" ON "cancellation_refund_reviews" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "refund_review_clinic_status_idx" ON "cancellation_refund_reviews" USING btree ("clinic_id","status");