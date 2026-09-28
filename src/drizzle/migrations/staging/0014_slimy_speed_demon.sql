CREATE TYPE "public"."permission_audit_action" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TABLE "permission_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"performed_by" uuid NOT NULL,
	"permission_key" varchar(120) NOT NULL,
	"action" "permission_audit_action" NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(120) NOT NULL,
	"resource" varchar(60) NOT NULL,
	"action" varchar(60) NOT NULL,
	"description" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permission_audit_log" ADD CONSTRAINT "permission_audit_log_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_audit_log" ADD CONSTRAINT "permission_audit_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_audit_log" ADD CONSTRAINT "permission_audit_log_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_permission_audit_log_target_user" ON "permission_audit_log" USING btree ("target_user_id","clinic_id");--> statement-breakpoint
CREATE INDEX "idx_permission_audit_log_clinic_key" ON "permission_audit_log" USING btree ("clinic_id","permission_key","performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_unique" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_permissions_resource" ON "permissions" USING btree ("resource");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permissions_user_clinic_permission_unique" ON "user_permissions" USING btree ("user_id","clinic_id","permission_id");--> statement-breakpoint
CREATE INDEX "idx_user_permissions_user_clinic" ON "user_permissions" USING btree ("user_id","clinic_id");