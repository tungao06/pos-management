-- Custom SQL migration file, put your code below! --
-- M6: ledger tables are append-only at the DB level (spec §3.3 stock_movement, §3.4 order_event, §3.5 cash_movement
-- and z_report). Any UPDATE or DELETE aborts. NOTE: SQLite drops a table's triggers with the table, so a future
-- migration that recreates one of these tables must recreate its triggers too — test/triggers.test.ts checks
-- the final state after all migrations.
CREATE TRIGGER `stock_movement_no_update` BEFORE UPDATE ON `stock_movement` BEGIN SELECT RAISE(ABORT, 'stock_movement is append-only: UPDATE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `stock_movement_no_delete` BEFORE DELETE ON `stock_movement` BEGIN SELECT RAISE(ABORT, 'stock_movement is append-only: DELETE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `order_event_no_update` BEFORE UPDATE ON `order_event` BEGIN SELECT RAISE(ABORT, 'order_event is append-only: UPDATE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `order_event_no_delete` BEFORE DELETE ON `order_event` BEGIN SELECT RAISE(ABORT, 'order_event is append-only: DELETE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `cash_movement_no_update` BEFORE UPDATE ON `cash_movement` BEGIN SELECT RAISE(ABORT, 'cash_movement is append-only: UPDATE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `cash_movement_no_delete` BEFORE DELETE ON `cash_movement` BEGIN SELECT RAISE(ABORT, 'cash_movement is append-only: DELETE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `z_report_no_update` BEFORE UPDATE ON `z_report` BEGIN SELECT RAISE(ABORT, 'z_report is append-only: UPDATE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `z_report_no_delete` BEFORE DELETE ON `z_report` BEGIN SELECT RAISE(ABORT, 'z_report is append-only: DELETE rejected'); END;
