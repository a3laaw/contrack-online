-- ======================================================================
-- ترحيل يدوي لـ Supabase: إكمال علاقات الجداول + تفضيلات الواجهة
-- يولّد من: prisma migrate diff (schema قبل/بعد)
-- التطبيق: بعد استعادة DATABASE_URL — عبر `psql` أو محرر SQL في لوحة Supabase
-- ======================================================================

-- [1] تنظيف الصفوف اليتيمة قبل إضافة القيود (وإلا فشل ADD CONSTRAINT)
DELETE FROM contract_group_items ci WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = ci.contract_id);
DELETE FROM gateway_fee_vouchers gf WHERE NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id = gf.voucher_id);
UPDATE addendum_items ai SET sub_contract_id = NULL WHERE sub_contract_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sub_contracts sc WHERE sc.id = ai.sub_contract_id);
UPDATE claims cl SET sub_line_id = NULL WHERE sub_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sub_payment_plan sp WHERE sp.id = cl.sub_line_id);
UPDATE gateway_ops go SET paid_transfer_id = NULL WHERE paid_transfer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM other_company_transfers t WHERE t.id = go.paid_transfer_id);
UPDATE type_payment_tpl tp SET trigger_stage_id = NULL WHERE trigger_stage_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workflow_stages ws WHERE ws.id = tp.trigger_stage_id);
UPDATE form_fields f SET continues_field_id = NULL WHERE continues_field_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM form_fields p WHERE p.id = f.continues_field_id);

-- [2] الفرق بين المخططين (عمود ui_prefs + 7 قيود علاقات)
-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "ui_prefs" TEXT;

-- AddForeignKey
ALTER TABLE "addendum_items" ADD CONSTRAINT "addendum_items_sub_contract_id_fkey" FOREIGN KEY ("sub_contract_id") REFERENCES "sub_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_sub_line_id_fkey" FOREIGN KEY ("sub_line_id") REFERENCES "sub_payment_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "type_payment_tpl" ADD CONSTRAINT "type_payment_tpl_trigger_stage_id_fkey" FOREIGN KEY ("trigger_stage_id") REFERENCES "workflow_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_group_items" ADD CONSTRAINT "contract_group_items_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_ops" ADD CONSTRAINT "gateway_ops_paid_transfer_id_fkey" FOREIGN KEY ("paid_transfer_id") REFERENCES "other_company_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_fee_vouchers" ADD CONSTRAINT "gateway_fee_vouchers_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_continues_field_id_fkey" FOREIGN KEY ("continues_field_id") REFERENCES "form_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;
