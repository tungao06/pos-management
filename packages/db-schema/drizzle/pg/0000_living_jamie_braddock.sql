CREATE TABLE "bom" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"version" integer NOT NULL,
	"yield_milli" integer NOT NULL,
	"is_current" boolean NOT NULL,
	"instructions" text,
	"server_seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_line" (
	"id" text PRIMARY KEY NOT NULL,
	"bom_id" text NOT NULL,
	"component_item_id" text NOT NULL,
	"qty_milli" integer NOT NULL,
	"server_seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "category_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"commission_bp" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "channel_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"line_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"picture_url" text,
	"first_seen_at" text NOT NULL,
	"last_order_at" text,
	"is_blocked" boolean NOT NULL,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "customer_line_user_id_unique" UNIQUE("line_user_id")
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"receipt_prefix" text NOT NULL,
	"is_selling_device" boolean NOT NULL,
	"registered_at" text NOT NULL,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "device_receipt_prefix_unique" UNIQUE("receipt_prefix")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"purchased_at" text,
	"price_satang" integer NOT NULL,
	"qty" integer NOT NULL,
	"supplier" text,
	"life_months" integer,
	"condition" text,
	"owner" text,
	"note" text,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "equipment_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"use_unit" text NOT NULL,
	"is_tracked" boolean NOT NULL,
	"reorder_point_milli" integer NOT NULL,
	"standard_cost_usat" bigint NOT NULL,
	"shelf_life_hours" integer,
	"is_active" boolean NOT NULL,
	"note" text,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "item_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "price" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"price_satang" integer NOT NULL,
	"effective_from" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"server_seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_th" text NOT NULL,
	"name_en" text NOT NULL,
	"category_id" text NOT NULL,
	"sort" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"prep_group" text,
	"sold_out_until" text,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "product_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"size_id" text NOT NULL,
	"sku" text NOT NULL,
	"is_active" boolean NOT NULL,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "product_variant_sku_unique" UNIQUE("sku"),
	CONSTRAINT "product_variant_product_id_size_id_unique" UNIQUE("product_id","size_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_unit" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"qty_per_unit_milli" integer NOT NULL,
	"is_default" boolean NOT NULL,
	"barcode" text,
	"server_seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"sweetness_id" text NOT NULL,
	"version" integer NOT NULL,
	"effective_from" text NOT NULL,
	"is_current" boolean NOT NULL,
	"created_by" text,
	"note" text,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "recipe_variant_id_sweetness_id_version_unique" UNIQUE("variant_id","sweetness_id","version")
);
--> statement-breakpoint
CREATE TABLE "recipe_line" (
	"id" text PRIMARY KEY NOT NULL,
	"recipe_id" text NOT NULL,
	"item_id" text NOT NULL,
	"qty_milli" integer NOT NULL,
	"server_seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"effective_from" text NOT NULL,
	"updated_at" text NOT NULL,
	"server_seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "size" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer NOT NULL,
	"packaging_item_id" text NOT NULL,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "size_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sweetness_level" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer NOT NULL,
	"is_default" boolean NOT NULL,
	"server_seq" bigserial NOT NULL,
	CONSTRAINT "sweetness_level_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"pin_hash" text NOT NULL,
	"is_active" boolean NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"version" integer NOT NULL,
	"server_seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_cost_state" (
	"item_id" text PRIMARY KEY NOT NULL,
	"on_hand_milli" integer NOT NULL,
	"avg_cost_usat" bigint NOT NULL,
	"as_of_movement_id" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"bom_id" text NOT NULL,
	"item_id" text NOT NULL,
	"business_date" text NOT NULL,
	"scale_bp" integer NOT NULL,
	"yield_actual_milli" integer NOT NULL,
	"unit_cost_usat" bigint NOT NULL,
	"batch_cost_satang" integer NOT NULL,
	"expires_at" text,
	"device_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"business_date" text NOT NULL,
	"supplier" text,
	"total_satang" integer NOT NULL,
	"receipt_image_ref" text,
	"note" text,
	"device_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "purchase_line" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_id" text NOT NULL,
	"item_id" text NOT NULL,
	"purchase_unit_id" text,
	"qty_units_milli" integer NOT NULL,
	"qty_use_milli" integer NOT NULL,
	"line_total_satang" integer NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "stock_count" (
	"id" text PRIMARY KEY NOT NULL,
	"business_date" text NOT NULL,
	"status" text NOT NULL,
	"device_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"closed_by" text,
	"closed_at" text,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "stock_count_line" (
	"id" text PRIMARY KEY NOT NULL,
	"count_id" text NOT NULL,
	"item_id" text NOT NULL,
	"purchase_unit_id" text,
	"counted_units_milli" integer NOT NULL,
	"counted_use_milli" integer NOT NULL,
	"expected_use_milli" integer NOT NULL,
	"variance_use_milli" integer NOT NULL,
	"variance_satang" integer NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"qty_milli" integer NOT NULL,
	"unit_cost_usat" bigint NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"business_date" text NOT NULL,
	"device_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "cash_count" (
	"id" text PRIMARY KEY NOT NULL,
	"shift_id" text NOT NULL,
	"counted_satang" integer NOT NULL,
	"expected_satang" integer NOT NULL,
	"variance_satang" integer NOT NULL,
	"reason" text,
	"lines_json" jsonb NOT NULL,
	"counted_by" text NOT NULL,
	"created_at" text NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "cash_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"shift_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_satang" integer NOT NULL,
	"order_id" text,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "discount" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"amount_satang" integer NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "order" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"device_id" text,
	"receipt_no" text,
	"queue_no" integer,
	"business_date" text NOT NULL,
	"shift_id" text,
	"channel_id" text NOT NULL,
	"customer_id" text,
	"status" text NOT NULL,
	"subtotal_satang" integer NOT NULL,
	"discount_satang" integer NOT NULL,
	"total_satang" integer NOT NULL,
	"vat_satang" integer NOT NULL,
	"cost_satang" integer NOT NULL,
	"note" text,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" text NOT NULL,
	"paid_at" text,
	"ready_at" text,
	"voided_at" text,
	"server_received_at" text,
	CONSTRAINT "order_device_id_receipt_no_unique" UNIQUE("device_id","receipt_no")
);
--> statement-breakpoint
CREATE TABLE "order_event" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"seq" integer NOT NULL,
	"device_id" text,
	"chain_id" text NOT NULL,
	"chain_seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"server_received_at" text,
	CONSTRAINT "order_event_order_id_seq_unique" UNIQUE("order_id","seq"),
	CONSTRAINT "order_event_chain_id_chain_seq_unique" UNIQUE("chain_id","chain_seq")
);
--> statement-breakpoint
CREATE TABLE "order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" text NOT NULL,
	"sweetness_id" text NOT NULL,
	"recipe_id" text,
	"product_name" text NOT NULL,
	"size_name" text NOT NULL,
	"sweetness_name" text NOT NULL,
	"unit_price_satang" integer NOT NULL,
	"qty" integer NOT NULL,
	"line_total_satang" integer NOT NULL,
	"unit_cost_satang" integer NOT NULL,
	"server_received_at" text,
	CONSTRAINT "order_line_order_id_line_no_unique" UNIQUE("order_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "order_payment_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"promptpay_payload" text NOT NULL,
	"amount_satang" integer NOT NULL,
	"expires_at" text NOT NULL,
	"slip_image_ref" text,
	"customer_claimed_at" text,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"method" text NOT NULL,
	"amount_satang" integer NOT NULL,
	"tendered_satang" integer,
	"change_satang" integer,
	"reference" text,
	"verify_status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "shift" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"business_date" text NOT NULL,
	"status" text NOT NULL,
	"opened_by" text NOT NULL,
	"opened_at" text NOT NULL,
	"opening_float_satang" integer NOT NULL,
	"closed_by" text,
	"closed_at" text,
	"server_received_at" text
);
--> statement-breakpoint
CREATE TABLE "z_report" (
	"id" text PRIMARY KEY NOT NULL,
	"shift_id" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"hash" text NOT NULL,
	"created_at" text NOT NULL,
	"server_received_at" text,
	CONSTRAINT "z_report_shift_id_unique" UNIQUE("shift_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"actor_user_id" text,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_record" (
	"key" text PRIMARY KEY NOT NULL,
	"first_seen_at" text NOT NULL,
	"result_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invariant_run" (
	"id" text PRIMARY KEY NOT NULL,
	"ran_at" text NOT NULL,
	"results_json" jsonb NOT NULL,
	"has_failure" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bom" ADD CONSTRAINT "bom_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_bom_id_bom_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_component_item_id_item_id_fk" FOREIGN KEY ("component_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price" ADD CONSTRAINT "price_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price" ADD CONSTRAINT "price_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_size_id_size_id_fk" FOREIGN KEY ("size_id") REFERENCES "public"."size"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_unit" ADD CONSTRAINT "purchase_unit_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_sweetness_id_sweetness_level_id_fk" FOREIGN KEY ("sweetness_id") REFERENCES "public"."sweetness_level"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "size" ADD CONSTRAINT "size_packaging_item_id_item_id_fk" FOREIGN KEY ("packaging_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_cost_state" ADD CONSTRAINT "item_cost_state_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_bom_id_bom_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_purchase_unit_id_purchase_unit_id_fk" FOREIGN KEY ("purchase_unit_id") REFERENCES "public"."purchase_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_count_id_stock_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_count"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_purchase_unit_id_purchase_unit_id_fk" FOREIGN KEY ("purchase_unit_id") REFERENCES "public"."purchase_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_counted_by_user_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_sweetness_id_sweetness_level_id_fk" FOREIGN KEY ("sweetness_id") REFERENCES "public"."sweetness_level"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payment_intent" ADD CONSTRAINT "order_payment_intent_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "z_report" ADD CONSTRAINT "z_report_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movement_item_created_idx" ON "stock_movement" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movement_ref_idx" ON "stock_movement" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "order_business_date_idx" ON "order" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "order_status_idx" ON "order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");