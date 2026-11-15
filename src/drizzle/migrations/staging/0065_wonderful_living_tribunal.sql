CREATE TYPE "public"."referral_signup_status" AS ENUM('signed_up', 'joined', 'paid');--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"clinic_id" uuid,
	"lab_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "referral_codes_owner_user_id_unique" UNIQUE("owner_user_id")
);
--> statement-breakpoint
CREATE TABLE "referral_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"referred_clinic_id" uuid,
	"status" "referral_signup_status" DEFAULT 'signed_up' NOT NULL,
	"signed_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	CONSTRAINT "referral_signups_referred_user_id_unique" UNIQUE("referred_user_id")
);
--> statement-breakpoint
DROP TABLE "referrals" CASCADE;--> statement-breakpoint
ALTER TABLE "referral_signups" ADD CONSTRAINT "referral_signups_code_id_referral_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."referral_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_signups_referrer_idx" ON "referral_signups" USING btree ("referrer_user_id","signed_up_at");--> statement-breakpoint
CREATE INDEX "referral_signups_signed_up_at_idx" ON "referral_signups" USING btree ("signed_up_at");--> statement-breakpoint
DROP TYPE "public"."referral_status";