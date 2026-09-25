-- block 2 (spec 04 §6.1, ruling R7): every row queued before block 2 used the plan-3/4 row format, which dayo's
-- /v1/pos/push does not accept. They stay on the tablet as local records only and are never sent.
UPDATE `outbox` SET `status` = 'local_only' WHERE `status` IN ('pending', 'dead');
--> statement-breakpoint
CREATE TRIGGER `order_item_no_update` BEFORE UPDATE ON `order_item` BEGIN SELECT RAISE(ABORT, 'order_item is append-only: UPDATE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `order_item_no_delete` BEFORE DELETE ON `order_item` BEGIN SELECT RAISE(ABORT, 'order_item is append-only: DELETE rejected'); END;
