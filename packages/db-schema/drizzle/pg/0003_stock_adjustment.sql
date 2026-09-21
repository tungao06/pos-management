CREATE TABLE "stock_adjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"business_date" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"detail_json" jsonb,
	"device_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"server_received_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;