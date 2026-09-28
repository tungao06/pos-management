CREATE TABLE `order_item` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`menu_code` text NOT NULL,
	`menu_name_th` text NOT NULL,
	`size` text NOT NULL,
	`sweetness` text NOT NULL,
	`milk` text NOT NULL,
	`grade` text,
	`qty` integer NOT NULL,
	`unit_price_satang` integer NOT NULL,
	`discount_per_cup_satang` integer NOT NULL,
	`discount_reason` text,
	`promotion_id` text,
	`line_total_satang` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_item_qty_positive_ck" CHECK("order_item"."qty" > 0),
	CONSTRAINT "order_item_money_nonneg_ck" CHECK("order_item"."unit_price_satang" >= 0 and "order_item"."discount_per_cup_satang" >= 0 and "order_item"."line_total_satang" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_item_order_id_line_no_unique` ON `order_item` (`order_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `dayo_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_version` integer NOT NULL,
	`catalog_json` text NOT NULL,
	`staff_json` text NOT NULL,
	`client_json` text,
	`fetched_at` text NOT NULL,
	CONSTRAINT "dayo_catalog_single_row_ck" CHECK("dayo_catalog"."id" = 'current')
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_order` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`device_id` text,
	`receipt_no` text,
	`queue_no` integer,
	`business_date` text NOT NULL,
	`shift_id` text,
	`channel_id` text,
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
	`sold_at` text,
	`catalog_version` integer,
	`channel_code` text,
	`payment_code` text,
	`pricing_json` text,
	`excluded_at` text,
	`central_order_no` text,
	`central_computed_total_satang` integer,
	`central_amount_mismatch` integer,
	`central_duplicate_of_json` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_subtotal_nonneg_ck" CHECK("__new_order"."subtotal_satang" >= 0),
	CONSTRAINT "order_discount_nonneg_ck" CHECK("__new_order"."discount_satang" >= 0),
	CONSTRAINT "order_total_nonneg_ck" CHECK("__new_order"."total_satang" >= 0),
	CONSTRAINT "order_discount_le_subtotal_ck" CHECK("__new_order"."discount_satang" <= "__new_order"."subtotal_satang"),
	CONSTRAINT "order_channel_ck" CHECK("__new_order"."channel_id" is not null or "__new_order"."channel_code" is not null)
);
--> statement-breakpoint
-- drizzle-kit listed the 10 block-2 columns in the SELECT too, but the old `order` does not have them: copy the 22
-- existing columns only; the new ones start NULL.
INSERT INTO `__new_order`("id", "origin", "device_id", "receipt_no", "queue_no", "business_date", "shift_id", "channel_id", "customer_id", "status", "subtotal_satang", "discount_satang", "total_satang", "vat_satang", "cost_satang", "note", "created_by_type", "created_by_id", "created_at", "paid_at", "ready_at", "voided_at") SELECT "id", "origin", "device_id", "receipt_no", "queue_no", "business_date", "shift_id", "channel_id", "customer_id", "status", "subtotal_satang", "discount_satang", "total_satang", "vat_satang", "cost_satang", "note", "created_by_type", "created_by_id", "created_at", "paid_at", "ready_at", "voided_at" FROM `order`;--> statement-breakpoint
DROP TABLE `order`;--> statement-breakpoint
ALTER TABLE `__new_order` RENAME TO `order`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `order_business_date_status_idx` ON `order` (`business_date`,`status`);--> statement-breakpoint
CREATE INDEX `order_status_idx` ON `order` (`status`);--> statement-breakpoint
CREATE INDEX `order_shift_idx` ON `order` (`shift_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_device_id_receipt_no_unique` ON `order` (`device_id`,`receipt_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_device_id_business_date_queue_no_unique` ON `order` (`device_id`,`business_date`,`queue_no`);--> statement-breakpoint
ALTER TABLE `outbox` ADD `next_attempt_at` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `parent_key` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `result_json` text;--> statement-breakpoint
CREATE INDEX `outbox_parent_idx` ON `outbox` (`parent_key`);