ALTER TABLE "clinics" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."clinic_status" RENAME TO "clinic_status_old";--> statement-breakpoint
CREATE TYPE "public"."clinic_status" AS ENUM('Active', 'Inactive', 'Blocked', 'Pending', 'Rejected');--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "status" SET DATA TYPE "public"."clinic_status" USING "status"::text::"public"."clinic_status";--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "status" SET DEFAULT 'Pending';--> statement-breakpoint
DROP TYPE "public"."clinic_status_old";
