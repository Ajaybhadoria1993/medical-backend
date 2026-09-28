CREATE SEQUENCE "public"."appointment_test_unique_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."lab_invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."lab_sample_barcode_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "is_external_lab_report" boolean DEFAULT false NOT NULL;