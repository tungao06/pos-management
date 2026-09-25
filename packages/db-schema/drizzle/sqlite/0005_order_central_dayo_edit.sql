-- block 2 (ADR-0050): dayo's E3 dayo_edit for this bill — the owner's latest edit/cancel on the dayo web, null = none.
-- Display only on the tablet: total_satang, payment and status stay what was collected (spec 04 §4.6 · O1 pending).
ALTER TABLE `order` ADD `central_dayo_edit_json` text;
