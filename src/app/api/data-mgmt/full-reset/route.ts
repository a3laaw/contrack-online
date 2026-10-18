import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, forbidden, unauthorized, jsonError, ok } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** حارس المطور — إعادة الضبط للمطور فقط */
async function developerGuard(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return { response: unauthorized() };
  if (user.role !== "developer") return { response: forbidden("أدوات إعادة الضبط للمطور فقط") };
  return { user };
}

/**
 * إعادة الضبط الكاملة — حذف كل بيانات الأعمال بمعاملة واحدة بالترتيب الآمن (الأبناء قبل الآباء).
 * يستثني حرفيًا: users / user_permissions / settings / feature_flags / number_sequences / audit_log / purge_audit
 */
async function fullResetInTx(tx: Tx): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  const step = async (name: string, fn: () => Promise<{ count: number }>) => {
    const r = await fn();
    deleted[name] = r.count;
  };

  // فك الارتباط الذاتي للسندات (رسوم الأبناء) قبل الحذف
  await tx.voucher.updateMany({ data: { parentVoucherId: null } });
  await tx.formField.updateMany({ data: { continuesFieldId: null } });
  await tx.workflowStage.updateMany({ data: { parentId: null } });

  await step("sub_payment_sources", () => tx.subPaymentSource.deleteMany({}));
  await step("voucher_payment_links", () => tx.voucherPaymentLink.deleteMany({}));
  await step("addendum_items", () => tx.addendumItem.deleteMany({}));
  await step("sub_contract_items", () => tx.subContractItem.deleteMany({}));
  await step("claims", () => tx.claim.deleteMany({}));
  await step("journal_entries", () => tx.journalEntry.deleteMany({}));
  await step("contract_events", () => tx.contractEvent.deleteMany({}));
  await step("contract_scope", () => tx.contractScope.deleteMany({}));
  await step("contract_group_items", () => tx.contractGroupItem.deleteMany({}));
  await step("contract_groups", () => tx.contractGroup.deleteMany({}));
  await step("visits", () => tx.visit.deleteMany({}));
  await step("tasks", () => tx.task.deleteMany({}));
  await step("customer_comments", () => tx.comment.deleteMany({}));
  await step("contract_attachments", () => tx.contractAttachment.deleteMany({}));
  await step("invoices", () => tx.invoice.deleteMany({}));
  await step("vouchers", () => tx.voucher.deleteMany({}));
  await step("sub_payment_plan", () => tx.subPaymentPlanItem.deleteMany({}));
  await step("sub_contracts", () => tx.subContract.deleteMany({}));
  await step("addendums", () => tx.addendum.deleteMany({}));
  await step("payment_plan", () => tx.paymentPlanItem.deleteMany({}));
  await step("boq_items", () => tx.boqItem.deleteMany({}));
  await step("contract_stages", () => tx.contractStage.deleteMany({}));
  await step("contracts", () => tx.contract.deleteMany({}));
  await step("customers", () => tx.customer.deleteMany({}));
  await step("subcontractors", () => tx.subcontractor.deleteMany({}));
  await step("transfer_op_allocs", () => tx.transferOpAlloc.deleteMany({}));
  await step("gateway_fee_vouchers", () => tx.gatewayFeeVoucher.deleteMany({}));
  await step("gateway_ops", () => tx.gatewayOp.deleteMany({}));
  await step("bank_lines", () => tx.bankLine.deleteMany({}));
  await step("other_company_transfers", () => tx.otherCompanyTransfer.deleteMany({}));
  await step("other_company_opening", () => tx.otherCompanyOpening.deleteMany({}));
  await step("match_aliases", () => tx.matchAlias.deleteMany({}));
  await step("employees", () => tx.employee.deleteMany({}));
  await step("expense_accounts", () => tx.expenseAccount.deleteMany({}));
  await step("type_payment_stages", () => tx.typePaymentStage.deleteMany({}));
  await step("type_payment_tpl", () => tx.typePaymentTemplate.deleteMany({}));
  await step("type_bundle_components", () => tx.typeBundleComponent.deleteMany({}));
  await step("contract_types", () => tx.contractType.deleteMany({}));
  await step("workflow_stages", () => tx.workflowStage.deleteMany({}));
  await step("visit_staff", () => tx.visitStaff.deleteMany({}));
  await step("payment_methods", () => tx.paymentMethod.deleteMany({}));
  await step("form_documents", () => tx.formDocument.deleteMany({}));
  await step("form_fields", () => tx.formField.deleteMany({}));
  await step("form_templates", () => tx.formTemplate.deleteMany({}));
  await step("form_categories", () => tx.formCategory.deleteMany({}));

  return deleted;
}

/** POST {confirm, reason} — نص التأكيد حرفيًا «إعادة الضبط الكاملة» وإلا 422 */
export async function POST(req: NextRequest) {
  const guard = await developerGuard(req);
  if ("response" in guard) return guard.response;
  const username = guard.user.username;

  const body = (await req.json().catch(() => ({}))) as { confirm?: string; reason?: string };
  const confirm = String(body.confirm || "").trim();
  const reason = String(body.reason || "").trim();

  if (confirm !== "إعادة الضبط الكاملة") {
    return jsonError("نص التأكيد غير مطابق — اكتب «إعادة الضبط الكاملة» حرفيًا للتأكيد", 422);
  }
  if (!reason) return jsonError("سبب إعادة الضبط إلزامي");

  let deleted: Record<string, number> = {};
  try {
    deleted = await db.$transaction(async (tx) => {
      const counts = await fullResetInTx(tx);

      // لقطة عددية في سجل المحو
      await tx.purgeAudit.create({
        data: {
          purgedBy: username,
          entity: "full_reset",
          entityId: 0,
          label: "إعادة الضبط الكاملة",
          reason,
          snapshot: JSON.stringify({ action: "full_reset", deleted: counts }),
        },
      });

      await audit(tx, {
        username,
        action: "إعادة الضبط الكاملة",
        entityType: "system",
        entityName: "full_reset",
        reason,
      });

      return counts;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`فشلت إعادة الضبط — لم يُحذف شيء: ${msg}`, 500);
  }

  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  return ok({
    reset: true,
    deleted,
    total,
    message: `تمت إعادة الضبط الكاملة — حُذف ${total} صفًا من جداول بيانات الأعمال. بقيت بيانات المستخدمين والصلاحيات والإعدادات وأرقام التسلسل وسجلات التدقيق.`,
  });
}
