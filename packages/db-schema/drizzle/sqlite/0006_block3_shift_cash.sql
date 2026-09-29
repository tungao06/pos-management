ALTER TABLE `cash_count` ADD `counted_at` text;--> statement-breakpoint
ALTER TABLE `cash_count` ADD `includes_bot_cash` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `cash_count_shift_uq` ON `cash_count` (`shift_id`);--> statement-breakpoint
ALTER TABLE `order` ADD `off_catalog_at` text;--> statement-breakpoint
ALTER TABLE `order` ADD `central_mismatch_json` text;--> statement-breakpoint
ALTER TABLE `shift` ADD `counted_at` text;--> statement-breakpoint
ALTER TABLE `shift` ADD `sync_mode` text DEFAULT 'local_only' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `shift_counting_uq` ON `shift` (`device_id`) WHERE status = 'counting';--> statement-breakpoint
-- block 3 (spec 04 §4.10 rule 4 · ruling R1): every shift from before this migration never reached dayo — local_only for good.
UPDATE `shift` SET `sync_mode` = 'local_only';
--> statement-breakpoint
UPDATE `shift` SET `counted_at` = (SELECT min(`created_at`) FROM `cash_count` WHERE `cash_count`.`shift_id` = `shift`.`id`) WHERE `status` = 'closed';
--> statement-breakpoint
UPDATE `cash_count` SET `counted_at` = `created_at`;
--> statement-breakpoint
CREATE TRIGGER `cash_count_no_update` BEFORE UPDATE ON `cash_count` BEGIN SELECT RAISE(ABORT, 'cash_count is append-only: UPDATE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `cash_count_no_delete` BEFORE DELETE ON `cash_count` BEGIN SELECT RAISE(ABORT, 'cash_count is append-only: DELETE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `shift_status_forward_only` BEFORE UPDATE OF `status` ON `shift`
WHEN NEW.`status` NOT IN ('open', 'counting', 'counted', 'closed')
  OR (CASE NEW.`status` WHEN 'open' THEN 0 WHEN 'counting' THEN 1 WHEN 'counted' THEN 2 ELSE 3 END) < (CASE OLD.`status` WHEN 'open' THEN 0 WHEN 'counting' THEN 1 WHEN 'counted' THEN 2 ELSE 3 END)
BEGIN SELECT RAISE(ABORT, 'shift.status only moves forward: open → counting → counted → closed (D101)'); END;
--> statement-breakpoint
CREATE TRIGGER `shift_counted_at_once` BEFORE UPDATE OF `counted_at` ON `shift` WHEN OLD.`counted_at` IS NOT NULL AND NEW.`counted_at` IS NOT OLD.`counted_at`
BEGIN SELECT RAISE(ABORT, 'shift.counted_at is set once (D101)'); END;
--> statement-breakpoint
CREATE TRIGGER `cash_movement_open_shift_only` BEFORE INSERT ON `cash_movement` WHEN (SELECT `status` FROM `shift` WHERE `id` = NEW.`shift_id`) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'cash_movement needs an open shift (D101: a counted shift takes no more cash movements)'); END;
--> statement-breakpoint
CREATE TRIGGER `order_open_shift_only` BEFORE INSERT ON `order` WHEN NEW.`shift_id` IS NOT NULL AND (SELECT `status` FROM `shift` WHERE `id` = NEW.`shift_id`) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a bill needs an open shift (D101)'); END;
