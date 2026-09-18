-- Custom SQL migration file, put your code below! --
-- M6: ledger tables are append-only at the DB level (spec §3.3 stock_movement "ห้ามแก้", §3.4 order_event,
-- §3.5 cash_movement and z_report "สร้างครั้งเดียว"). Any UPDATE or DELETE aborts. Corrections are new rows
-- (COUNT_ADJ, VOID_RETURN, VOID_REFUND, a new event). test/triggers.test.ts pins the trigger list.
CREATE OR REPLACE FUNCTION reject_append_only_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "stock_movement_append_only" BEFORE UPDATE OR DELETE ON "stock_movement" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER "order_event_append_only" BEFORE UPDATE OR DELETE ON "order_event" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER "cash_movement_append_only" BEFORE UPDATE OR DELETE ON "cash_movement" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER "z_report_append_only" BEFORE UPDATE OR DELETE ON "z_report" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
