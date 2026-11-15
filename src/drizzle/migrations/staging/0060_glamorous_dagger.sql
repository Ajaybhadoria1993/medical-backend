ALTER TABLE "lab_updated_tests" ADD COLUMN "comments" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "interpretation" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "lab_updated_tests" DROP COLUMN "test_description";