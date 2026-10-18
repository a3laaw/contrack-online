import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { computeSubPlan } from "@/lib/voucher-server";

type P = { params: Promise<{ id: string }> };

/** خطة الباطن المحسوبة: FIFO بsortOrder + الروابط + البوابة + paid/total/capRemaining */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const subContractId = Number(idStr);
  if (!Number.isFinite(subContractId)) return jsonError("معرف غير صالح");

  const plan = await computeSubPlan(subContractId);
  if (!plan) return jsonError("عقد الباطن غير موجود", 404);

  return ok({
    subContract: plan.subContract,
    lines: plan.lines,
    paid: plan.paid,
    planTotal: plan.planTotal,
    subAmount: plan.subContract.amount,
    capRemaining: plan.capRemaining,
    gateEnabled: plan.gateEnabled,
  });
}

/** إضافة خط دفعة باطن مع مصادره من دفعات العميل — السقف: الإجمالي ≤ قيمة عقد الباطن + 0.001 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_add_payment");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const subContractId = Number(idStr);
  if (!Number.isFinite(subContractId)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({ where: { id: subContractId } });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);
  if (sc.status === "ملغى") return jsonError("لا يمكن التعديل على عقد باطن ملغى");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title || "").trim();
  if (!title) return jsonError("عنوان الدفعة مطلوب");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || !(amount > 0)) return jsonError("قيمة الدفعة يجب أن تكون أكبر من صفر");
  const dueDate = parseDay(body.dueDate);
  if (!dueDate) return jsonError("تاريخ الاستحقاق مطلوب بصيغة YYYY-MM-DD");

  // المصادر: دفعات عميل من عقد العميل الأب
  const sourceIds = Array.isArray(body.sources) ? [...new Set((body.sources as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))] : [];
  if (sourceIds.length > 0) {
    const found = await db.paymentPlanItem.findMany({ where: { id: { in: sourceIds }, contractId: sc.contractId }, select: { id: true } });
    if (found.length !== sourceIds.length) return jsonError("إحدى دفعات العميل المصدرية غير موجودة في هذا العقد");
  }

  // سقف الخطة
  const agg = await db.subPaymentPlanItem.aggregate({ where: { subContractId }, _sum: { amount: true } });
  const planSum = r3(Number(agg._sum.amount || 0));
  if (r3(planSum + amount) > r3(Number(sc.amount) + EPS)) {
    return jsonError("مجموع دفعات الباطن يتجاوز قيمة عقد الباطن");
  }

  const max = await db.subPaymentPlanItem.aggregate({ where: { subContractId }, _max: { sortOrder: true } });

  const line = await db.$transaction(async (tx) => {
    const created = await tx.subPaymentPlanItem.create({
      data: {
        subContractId,
        title,
        dueDate,
        amount,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
        notes: String(body.notes || ""),
      },
    });
    if (sourceIds.length > 0) {
      await tx.subPaymentSource.createMany({
        data: sourceIds.map((custLineId) => ({ subLineId: created.id, custLineId })),
      });
    }
    await tx.contractEvent.create({
      data: {
        contractId: sc.contractId,
        eventType: "إضافة دفعة باطن",
        description: `أُضيفت دفعة «${title}» بمبلغ ${amount} لعقد الباطن مع ${sourceIds.length} مصدر من دفعات العميل`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إنشاء",
      entityType: "sub_payment_plan",
      entityId: created.id,
      entityName: title,
    });
    return created;
  });

  return ok({ line: { id: line.id, title: line.title, dueDate: line.dueDate, amount: Number(line.amount), sortOrder: line.sortOrder, sources: sourceIds } }, 201);
}
