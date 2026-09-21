CREATE TABLE `stock_adjustment` (
	`id` text PRIMARY KEY NOT NULL,
	`business_date` text NOT NULL,
	`reason_code` text NOT NULL,
	`reason` text NOT NULL,
	`detail_json` text,
	`device_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
