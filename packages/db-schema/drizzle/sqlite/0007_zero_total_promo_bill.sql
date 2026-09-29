-- plan 10 T6 (owner answer Q1 = ข): a bill a promotion brings to ฿0 is still a paid bill with a ฿0 payment row. SQLite
-- cannot change a CHECK in place, so `payment` is rebuilt (drizzle-kit's recreate) with amount_satang stored as a whole
-- number >= 0; a ฿0 row is allowed only for a bill whose total_satang is 0 (triggers below). Nothing else is touched:
-- `payment` had no trigger before this migration, no table has a foreign key to it, and its one index is recreated with
-- the same SQL. A device with an amount that is not whole satang (text/real, which the old > 0 CHECK let in) fails this
-- migration and stays on 0006 with every row — no money value is rewritten.
-- NOTE: the four triggers below make `payment` and `order` name each other, so a later drizzle-kit rebuild
-- (__new_… → DROP → RENAME) of EITHER table fails at the RENAME ("error in trigger …: no such table"). A migration that
-- rebuilds `payment` or `order` must DROP payment_zero_only_zero_bill, payment_zero_only_zero_bill_on_update,
-- order_total_keeps_zero_payment and order_insert_keeps_zero_payment first and CREATE them again after the RENAME —
-- test/zero-bill.test.ts shows the recipe. (`shift` has had the same trap since 0006: cash_movement_open_shift_only and
-- order_open_shift_only name it.)
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
	CONSTRAINT "payment_amount_nonneg_ck" CHECK(typeof("__new_payment"."amount_satang") = 'integer' and "__new_payment"."amount_satang" >= 0)
);
--> statement-breakpoint
-- rowid is copied too (drizzle-kit leaves it out): every row keeps its rowid, so rowid order stays the order rows were written.
INSERT INTO `__new_payment`("rowid", "id", "order_id", "method", "amount_satang", "tendered_satang", "change_satang", "reference", "verify_status", "created_by", "created_at") SELECT "rowid", "id", "order_id", "method", "amount_satang", "tendered_satang", "change_satang", "reference", "verify_status", "created_by", "created_at" FROM `payment`;--> statement-breakpoint
DROP TABLE `payment`;--> statement-breakpoint
ALTER TABLE `__new_payment` RENAME TO `payment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `payment_order_idx` ON `payment` (`order_id`);--> statement-breakpoint
-- A ฿0 payment belongs to a ฿0 bill only. A bill that cannot be found (foreign keys are off during migrations) is not read as ฿0.
-- INSERT OR REPLACE of a payment runs this insert guard too.
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
--> statement-breakpoint
-- INSERT OR REPLACE / REPLACE of a bill deletes the row and inserts it again, so it never meets the UPDATE guard above.
-- A new bill has no payment yet (the sale writes the bill first), so this only fires on a re-insert of an existing bill.
CREATE TRIGGER `order_insert_keeps_zero_payment` BEFORE INSERT ON `order`
WHEN NEW.`total_satang` IS NOT 0 AND EXISTS (SELECT 1 FROM `payment` WHERE `order_id` = NEW.`id` AND `amount_satang` = 0)
BEGIN SELECT RAISE(ABORT, '฿0 payment only for a bill whose total is 0 (plan 10 Q1)'); END;
