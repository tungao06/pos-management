-- Custom SQL migration file, put your code below! --
-- I1/M7: server_seq is the pull cursor (spec §6.1). The bigserial default covers INSERT; this trigger gives every
-- UPDATE a fresh value from the same sequence so an incremental pull also sees edits (is_current flips, prices,
-- deactivations, order status changes). Every pg table with a server_seq column must be listed here —
-- test/triggers.test.ts fails if one is missing.
CREATE OR REPLACE FUNCTION bump_server_seq() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.server_seq := nextval(pg_get_serial_sequence(format('%I.%I', TG_TABLE_SCHEMA, TG_TABLE_NAME), 'server_seq'));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_bump_server_seq" BEFORE UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "device_bump_server_seq" BEFORE UPDATE ON "device" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "setting_bump_server_seq" BEFORE UPDATE ON "setting" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "category_bump_server_seq" BEFORE UPDATE ON "category" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "item_bump_server_seq" BEFORE UPDATE ON "item" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "purchase_unit_bump_server_seq" BEFORE UPDATE ON "purchase_unit" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "bom_bump_server_seq" BEFORE UPDATE ON "bom" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "bom_line_bump_server_seq" BEFORE UPDATE ON "bom_line" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "product_bump_server_seq" BEFORE UPDATE ON "product" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "size_bump_server_seq" BEFORE UPDATE ON "size" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "product_variant_bump_server_seq" BEFORE UPDATE ON "product_variant" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "sweetness_level_bump_server_seq" BEFORE UPDATE ON "sweetness_level" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "channel_bump_server_seq" BEFORE UPDATE ON "channel" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "price_bump_server_seq" BEFORE UPDATE ON "price" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "recipe_bump_server_seq" BEFORE UPDATE ON "recipe" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "recipe_line_bump_server_seq" BEFORE UPDATE ON "recipe_line" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "equipment_bump_server_seq" BEFORE UPDATE ON "equipment" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "customer_bump_server_seq" BEFORE UPDATE ON "customer" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "order_bump_server_seq" BEFORE UPDATE ON "order" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "order_line_bump_server_seq" BEFORE UPDATE ON "order_line" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "order_event_bump_server_seq" BEFORE UPDATE ON "order_event" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "payment_bump_server_seq" BEFORE UPDATE ON "payment" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
--> statement-breakpoint
CREATE TRIGGER "item_cost_state_bump_server_seq" BEFORE UPDATE ON "item_cost_state" FOR EACH ROW EXECUTE FUNCTION bump_server_seq();
