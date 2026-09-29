-- plan 10 T6 (owner answer Q1 = ข): a bill a promotion brings to ฿0 is still a paid bill with a ฿0 payment row. SQLite
-- cannot change a CHECK in place, so `payment` is rebuilt (drizzle-kit's recreate) with amount_satang >= 0; a ฿0 row is
-- allowed only for a bill whose total_satang is 0 (triggers below). Nothing else is touched: `payment` had no trigger
-- before this migration, no table has a foreign key to it, and its one index is recreated with the same SQL.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payment` (
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
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_amount_nonneg_ck" CHECK("__new_payment"."amount_satang" >= 0)
);
--> statement-breakpoint
-- rowid is copied too (drizzle-kit leaves it out): every row keeps its rowid, so rowid order stays the order rows were written.
INSERT INTO `__new_payment`("rowid", "id", "order_id", "method", "amount_satang", "tendered_satang", "change_satang", "reference", "verify_status", "created_by", "created_at") SELECT "rowid", "id", "order_id", "method", "amount_satang", "tendered_satang", "change_satang", "reference", "verify_status", "created_by", "created_at" FROM `payment`;--> statement-breakpoint
DROP TABLE `payment`;--> statement-breakpoint
ALTER TABLE `__new_payment` RENAME TO `payment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `payment_order_idx` ON `payment` (`order_id`);--> statement-breakpoint
-- A ฿0 payment belongs to a ฿0 bill only. A bill that cannot be found (foreign keys are off during migrations) is not read as ฿0.
CREATE TRIGGER `payment_zero_only_zero_bill` BEFORE INSERT ON `payment`
WHEN NEW.`amount_satang` = 0 AND (SELECT `total_satang` FROM `order` WHERE `id` = NEW.`order_id`) IS NOT 0
BEGIN SELECT RAISE(ABORT, '฿0 payment only for a bill whose total is 0 (plan 10 Q1)'); END;
--> statement-breakpoint
CREATE TRIGGER `payment_zero_only_zero_bill_on_update` BEFORE UPDATE OF `amount_satang`, `order_id` ON `payment`
WHEN NEW.`amount_satang` = 0 AND (SELECT `total_satang` FROM `order` WHERE `id` = NEW.`order_id`) IS NOT 0
BEGIN SELECT RAISE(ABORT, '฿0 payment only for a bill whose total is 0 (plan 10 Q1)'); END;
--> statement-breakpoint
-- …and from the bill's side: the total of a bill that holds a ฿0 payment cannot move off 0 (the tablet never rewrites a total).
CREATE TRIGGER `order_total_keeps_zero_payment` BEFORE UPDATE OF `total_satang` ON `order`
WHEN NEW.`total_satang` IS NOT 0 AND EXISTS (SELECT 1 FROM `payment` WHERE `order_id` = NEW.`id` AND `amount_satang` = 0)
BEGIN SELECT RAISE(ABORT, '฿0 payment only for a bill whose total is 0 (plan 10 Q1)'); END;
