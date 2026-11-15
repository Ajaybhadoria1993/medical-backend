CREATE TABLE "doctor_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organisation" varchar(150) NOT NULL,
	"role" varchar(100) NOT NULL,
	"city" varchar(100),
	"start_month" integer NOT NULL,
	"start_year" integer NOT NULL,
	"end_month" integer,
	"end_year" integer,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_professionals" ADD COLUMN "languages_spoken" text[];--> statement-breakpoint
ALTER TABLE "doctor_experiences" ADD CONSTRAINT "doctor_experiences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_experiences_user_id_idx" ON "doctor_experiences" USING btree ("user_id");