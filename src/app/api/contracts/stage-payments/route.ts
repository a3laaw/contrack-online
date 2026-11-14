import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";

/**
 * الشاشة الموحدة «المراحل والدفعات» — قرار المالك (2026-01):
 * «أنواع العقود ومراحل العمل والدفعات كلها في صفحة واحدة — صف العقد أمامه عمود مراحل العمل،
 *  اختيار المرحلة يُظهر الدفعات المرتبطة بها».
 *
 * قراءة واحدة مجمعة: كل عقود الشركة (مع نوعها وعميلها) + مراحل كل عقد +
 * سطور خطة دفعاته + المقبوض المخصص لكل سطر (VoucherPaymentLink kind=receipt
 * على سندات قبض غير ملغاة) — فصل الشركات عبر غلاف db تلقائيًا.
 * الكتابة (ربط/فك/إضافة) تعتمد مسارات الخطة القائمة:
 *   PATCH /api/contracts/[id]/plan/[lineId]  (stageId)
 *   POST  /api/contracts/[id]/plan           (stageId)
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;

  const [contracts, stageRows, planRows, linkRows] = await Promise.all([
    db.contract.findMany({
      select: {
        id: true,
        contractNumber: true,
        contractName: true,
        contractType: true,
        status: true,
        amount: true,
        customer: { select: { name: true } },
      },
      orderBy: { id: "desc" },
    }),
    db.contractStage.findMany({
      select: {
        id: true,
        contractId: true,
        name: true,
        payPct: true,
        payKind: true,
        sortOrder: true,
        isSkipped: true,
        endDate: true,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    db.paymentPlanItem.findMany({
      select: {
        id: true,
        contractId: true,
        title: true,
        amount: true,
        dueDate: true,
        stageId: true,
        triggeredAt: true,
        notes: true,
      },
      orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
    }),
    db.voucherPaymentLink.findMany({
      where: { kind: "receipt", voucher: { vtype: "receipt", cancelled: false } },
      select: { lineId: true, amount: true },
    }),
  ]);

  // المقبوض المخصص لكل سطر خطة — تجميع بسيط بسطر (نفس مقياس كشف الخطة)
  const paidByLine = new Map<number, number>();
  for (const l of linkRows) {
    paidByLine.set(l.lineId, r3((paidByLine.get(l.lineId) ?? 0) + Number(l.amount)));
  }

  const stagesByContract = new Map<number, Record<string, unknown>[]>();
  for (const s of stageRows) {
    const arr = stagesByContract.get(s.contractId) ?? [];
    arr.push({
      id: s.id,
      name: s.name,
      payPct: Number(s.payPct),
      payKind: s.payKind,
      sortOrder: s.sortOrder,
      isSkipped: s.isSkipped,
      endDate: s.endDate,
    });
    stagesByContract.set(s.contractId, arr);
  }

  const paymentsByContract = new Map<number, Record<string, unknown>[]>();
  for (const p of planRows) {
    const arr = paymentsByContract.get(p.contractId) ?? [];
    arr.push({
      id: p.id,
      title: p.title,
      amount: Number(p.amount),
      dueDate: p.dueDate,
      stageId: p.stageId,
      triggeredAt: p.triggeredAt,
      notes: p.notes,
      paid: r3(paidByLine.get(p.id) ?? 0),
    });
    paymentsByContract.set(p.contractId, arr);
  }

  const rows = contracts.map((c) => ({
    id: c.id,
    contractNumber: c.contractNumber,
    contractName: c.contractName,
    contractType: c.contractType,
    status: c.status,
    customerName: c.customer.name,
    amount: Number(c.amount),
    stages: stagesByContract.get(c.id) ?? [],
    payments: paymentsByContract.get(c.id) ?? [],
  }));

  return ok({ contracts: rows });
}
