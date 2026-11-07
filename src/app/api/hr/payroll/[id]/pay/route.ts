import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, adminGuard, jsonError, moduleGuard, nextNumber, ok, parseDay } from "@/lib/api-utils";
import { insertVoucherJournal } from "@/lib/posting-rules-server";
import { VOUCHER_PREFIX, VOUCHER_TYPE_LABELS } from "@/lib/voucher-server";
import { monthLabelAr } from "@/lib/hr-constants";

type P = { params: Promise<{ id: string }> };

/**
 * POST: دفع المسير (المدير حصرًا) — سند PV من حساب 2160 (مدين 2160 / دائن الصندوق أو البنك) ⇒ batch=paid.
 * الخصومات كانت سُددت بسندات SD وقت الاعتماد، فالمتبقي على 2160 = صافي المسير حصرًا.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const vdate = parseDay(body.vdate) || new Date().toISOString().slice(0, 10);
  const method = String(body.method || "نقدي").trim() || "نقدي";

  const batch = await db.payrollBatch.findUnique({ where: { id } });
  if (!batch) return jsonError("المسير غير موجود", 404);
  if (batch.status === "draft") return jsonError("اعتمد المسير أولًا قبل الدفع");
  if (batch.status === "paid") return jsonError("المسير مدفوع من قبل");
  if (batch.status === "cancelled") return jsonError("المسير ملغى — لا دفع عليه");
  if (batch.paymentVoucherId) return jsonError("يوجد سند دفع مرتبط بالمسير");

  const netTotal = Math.round(Number(batch.netTotal) * 1000) / 1000;
  if (netTotal <= 0) return jsonError("صافي المسير صفر — لا دفع");

  const acc2160 = await db.account.findFirst({ where: { code: "2160", type: "liability" }, select: { id: true, code: true, name: true } });
  if (!acc2160) return jsonError("حساب «رواتب مستحقة» (2160) غير موجود في دليل الحسابات");

  const batchLabel = `مسير رواتب ${monthLabelAr(batch.month)} — PR-${batch.batchNo}`;
  const actor = guard.user.username;

  try {
    const payment = await db.$transaction(async (tx) => {
      const voucherNumber = await nextNumber(VOUCHER_PREFIX.payment, 4, tx);
      const voucher = await tx.voucher.create({
        data: {
          voucherNumber,
          vtype: "payment",
          vdate,
          party: `رواتب ${monthLabelAr(batch.month)}`,
          partyType: "",
          partyId: null,
          method,
          account: "",
          accountId: acc2160.id,
          accountSnapshot: acc2160.name,
          amount: netTotal,
          description: `دفع ${batchLabel}`,
        },
      });
      // مدين 2160 (explicit) / دائن النقد بحسب الوسيلة — عبر محرك قواعد الترحيل
      await insertVoucherJournal(tx, {
        id: voucher.id,
        voucherNumber,
        vtype: "payment",
        vdate,
        amount: netTotal,
        account: "",
        method,
        contractId: null,
        subContractId: null,
        accountId: acc2160.id,
        custodyAccountId: null,
        accountSnapshot: acc2160.name,
        partyType: "",
      });
      await tx.payrollBatch.update({
        where: { id: batch.id },
        data: { status: "paid", paidAt: new Date(), paymentVoucherId: voucher.id },
      });
      await audit(tx, {
        username: actor,
        action: "دفع مسير",
        entityType: "payroll_batch",
        entityId: batch.id,
        entityName: `${batchLabel} — ${VOUCHER_TYPE_LABELS.payment} ${voucherNumber}`,
        oldStatus: "approved",
        newStatus: `paid / ${voucherNumber}`,
      });
      return { voucherNumber, voucherId: voucher.id };
    });

    return ok({ paid: true, voucherNumber: payment.voucherNumber, voucherId: payment.voucherId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("مقفلة")) return jsonError(msg);
    console.error(e);
    return jsonError("تعذر دفع المسير", 500);
  }
}
