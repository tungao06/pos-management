CREATE TABLE `bom` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`version` integer NOT NULL,
	`yield_milli` integer NOT NULL,
	`is_current` integer NOT NULL,
	`instructions` text,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bom_line` (
	`id` text PRIMARY KEY NOT NULL,
	`bom_id` text NOT NULL,
	`component_item_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	FOREIGN KEY (`bom_id`) REFERENCES `bom`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`component_item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer NOT NULL,
	`is_active` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_code_unique` ON `category` (`code`);--> statement-breakpoint
CREATE TABLE `channel` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`commission_bp` integer NOT NULL,
	`is_active` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_code_unique` ON `channel` (`code`);--> statement-breakpoint
CREATE TABLE `customer` (
	`id` text PRIMARY KEY NOT NULL,
	`line_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`picture_url` text,
	`first_seen_at` text NOT NULL,
	`last_order_at` text,
	`is_blocked` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_line_user_id_unique` ON `customer` (`line_user_id`);--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`receipt_prefix` text NOT NULL,
	`is_selling_device` integer NOT NULL,
	`registered_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_receipt_prefix_unique` ON `device` (`receipt_prefix`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`purchased_at` text,
	`price_satang` integer NOT NULL,
	`qty` integer NOT NULL,
	`supplier` text,
	`life_months` integer,
	`condition` text,
	`owner` text,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_code_unique` ON `equipment` (`code`);--> statement-breakpoint
CREATE TABLE `item` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`use_unit` text NOT NULL,
	`is_tracked` integer NOT NULL,
	`reorder_point_milli` integer NOT NULL,
	`standard_cost_usat` integer NOT NULL,
	`shelf_life_hours` integer,
	`is_active` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_code_unique` ON `item` (`code`);--> statement-breakpoint
CREATE TABLE `price` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`price_satang` integer NOT NULL,
	`effective_from` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name_th` text NOT NULL,
	`name_en` text NOT NULL,
	`category_id` text NOT NULL,
	`sort` integer NOT NULL,
	`is_active` integer NOT NULL,
	`prep_group` text,
	`sold_out_until` text,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_code_unique` ON `product` (`code`);--> statement-breakpoint
CREATE TABLE `product_variant` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`size_id` text NOT NULL,
	`sku` text NOT NULL,
	`is_active` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`size_id`) REFERENCES `size`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variant_sku_unique` ON `product_variant` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_variant_product_id_size_id_unique` ON `product_variant` (`product_id`,`size_id`);--> statement-breakpoint
CREATE TABLE `purchase_unit` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`qty_per_unit_milli` integer NOT NULL,
	`is_default` integer NOT NULL,
	`barcode` text,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`sweetness_id` text NOT NULL,
	`version` integer NOT NULL,
	`effective_from` text NOT NULL,
	`is_current` integer NOT NULL,
	`created_by` text,
	`note` text,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sweetness_id`) REFERENCES `sweetness_level`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_variant_id_sweetness_id_version_unique` ON `recipe` (`variant_id`,`sweetness_id`,`version`);--> statement-breakpoint
CREATE TABLE `recipe_line` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`effective_from` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `size` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer NOT NULL,
	`packaging_item_id` text NOT NULL,
	FOREIGN KEY (`packaging_item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `size_code_unique` ON `size` (`code`);--> statement-breakpoint
CREATE TABLE `sweetness_level` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer NOT NULL,
	`is_default` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sweetness_level_code_unique` ON `sweetness_level` (`code`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`pin_hash` text NOT NULL,
	`is_active` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_cost_state` (
	`item_id` text PRIMARY KEY NOT NULL,
	`on_hand_milli` integer NOT NULL,
	`avg_cost_usat` integer NOT NULL,
	`as_of_movement_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `production_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`bom_id` text NOT NULL,
	`item_id` text NOT NULL,
	`business_date` text NOT NULL,
	`scale_bp` integer NOT NULL,
	`yield_actual_milli` integer NOT NULL,
	`unit_cost_usat` integer NOT NULL,
	`batch_cost_satang` integer NOT NULL,
	`expires_at` text,
	`device_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`bom_id`) REFERENCES `bom`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase` (
	`id` text PRIMARY KEY NOT NULL,
	`business_date` text NOT NULL,
	`supplier` text,
	`total_satang` integer NOT NULL,
	`receipt_image_ref` text,
	`note` text,
	`device_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_line` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`item_id` text NOT NULL,
	`purchase_unit_id` text,
	`qty_units_milli` integer NOT NULL,
	`qty_use_milli` integer NOT NULL,
	`line_total_satang` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchase`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_unit_id`) REFERENCES `purchase_unit`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_count` (
	`id` text PRIMARY KEY NOT NULL,
	`business_date` text NOT NULL,
	`status` text NOT NULL,
	`device_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_by` text,
	`closed_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_count_line` (
	`id` text PRIMARY KEY NOT NULL,
	`count_id` text NOT NULL,
	`item_id` text NOT NULL,
	`purchase_unit_id` text,
	`counted_units_milli` integer NOT NULL,
	`counted_use_milli` integer NOT NULL,
	`expected_use_milli` integer NOT NULL,
	`variance_use_milli` integer NOT NULL,
	`variance_satang` integer NOT NULL,
	FOREIGN KEY (`count_id`) REFERENCES `stock_count`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_unit_id`) REFERENCES `purchase_unit`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`unit_cost_usat` integer NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`business_date` text NOT NULL,
	`device_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movement_item_created_idx` ON `stock_movement` (`item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movement_ref_idx` ON `stock_movement` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `cash_count` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`counted_satang` integer NOT NULL,
	`expected_satang` integer NOT NULL,
	`variance_satang` integer NOT NULL,
	`reason` text,
	`lines_json` text NOT NULL,
	`counted_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cash_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_satang` integer NOT NULL,
	`order_id` text,
	`reason` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `discount` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`amount_satang` integer NOT NULL,
	`reason` text NOT NULL,
	`approved_by` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`device_id` text,
	`receipt_no` text,
	`queue_no` integer,
	`business_date` text NOT NULL,
	`shift_id` text,
	`channel_id` text NOT NULL,
	`customer_id` text,
	`status` text NOT NULL,
	`subtotal_satang` integer NOT NULL,
	`discount_satang` integer NOT NULL,
	`total_satang` integer NOT NULL,
	`vat_satang` integer NOT NULL,
	`cost_satang` integer NOT NULL,
	`note` text,
	`created_by_type` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text NOT NULL,
	`paid_at` text,
	`ready_at` text,
	`voided_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_business_date_idx` ON `order` (`business_date`);--> statement-breakpoint
CREATE INDEX `order_status_idx` ON `order` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_device_id_receipt_no_unique` ON `order` (`device_id`,`receipt_no`);--> statement-breakpoint
CREATE TABLE `order_event` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`seq` integer NOT NULL,
	`device_id` text,
	`chain_id` text NOT NULL,
	`chain_seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`at` text NOT NULL,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_event_order_id_seq_unique` ON `order_event` (`order_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_event_chain_id_chain_seq_unique` ON `order_event` (`chain_id`,`chain_seq`);--> statement-breakpoint
CREATE TABLE `order_line` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`variant_id` text NOT NULL,
	`sweetness_id` text NOT NULL,
	`recipe_id` text,
	`product_name` text NOT NULL,
	`size_name` text NOT NULL,
	`sweetness_name` text NOT NULL,
	`unit_price_satang` integer NOT NULL,
	`qty` integer NOT NULL,
	`line_total_satang` integer NOT NULL,
	`unit_cost_satang` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sweetness_id`) REFERENCES `sweetness_level`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_line_order_id_line_no_unique` ON `order_line` (`order_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `order_payment_intent` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`promptpay_payload` text NOT NULL,
	`amount_satang` integer NOT NULL,
	`expires_at` text NOT NULL,
	`slip_image_ref` text,
	`customer_claimed_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_satang` integer NOT NULL,
	`tendered_satang` integer,
	`change_satang` integer,
	`reference` text,
	`verify_status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shift` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`business_date` text NOT NULL,
	`status` text NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`opening_float_satang` integer NOT NULL,
	`closed_by` text,
	`closed_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `z_report` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `z_report_shift_id_unique` ON `z_report` (`shift_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`actor_user_id` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`table_name` text NOT NULL,
	`row_json` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`attempts` integer NOT NULL,
	`last_error` text,
	`sent_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_idempotency_key_unique` ON `outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `outbox_pending_idx` ON `outbox` (`sent_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
