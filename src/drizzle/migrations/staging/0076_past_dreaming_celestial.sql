CREATE TABLE "specialty_display_order" (
	"main_specialty" varchar(100) PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
