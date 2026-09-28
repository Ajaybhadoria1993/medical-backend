CREATE TABLE "subscription_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"amount" numeric(12, 2),
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "subscription_activity_clinic_created_idx" ON "subscription_activity" USING btree ("clinic_id","created_at");