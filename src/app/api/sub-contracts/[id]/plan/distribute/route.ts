import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";

type P = { params: Promise<{ id: string }> };

/**
 * توزيع خطة الباطن (V6.1/V6.6):
 * - boqItemIds: نصيب كل بند بنسبة قيمته (qty×unitPrice) من إجمالي قيم البنود المختارة.
 * - count: توزيع بالتساوي على عدد الخطوط مع الكسر على الأخير.
 * - وإلا: مرآة خطة العميل — خط لكل دفعة عميل موزونًا بمبلغها مع ربط مصادرها تلقائيًا
 *   (وبلا خطة عميل: خط واحد بقيمة total كاملة).
 * استبدال الخطة القديمة: تُحذف الخطوط غير المرتبطة بروابط صرف صريحة فقط.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_payment");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const subContractId = Number(idStr);
  if (!Number.isFinite(subContractId)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({ where: { id: subContractId } });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);
  if (sc.status === "ملغى") return jsonError("لا يمكن التعديل على عقد باطن ملغى");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const total = Number(body.total || 0);
  if (!Number.isFinite(total) || !(total > 0)) return jsonError("الإجمالي الموزع يجب أن يكون أكبر من صفر");

  const boqIds = Array.isArray(body.boqItemIds) && body.boqItemIds.length > 0
    ? [...new Set((body.boqItemIds as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
    : null;
  const count = body.count !== undefined && body.count !== null ? Number(body.count) : null;
  const dueDate = parseDay(body.dueDate) || todayStr();

  // الخطوط المرتبطة بروابط صريحة تبقى
  const oldLines = await db.subPaymentPlanItem.findMany({
    where: { subContractId },
    include: { sources: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const linkedLineIds = new Set(
    (
      await db.voucherPaymentLink.findMany({
        where: { kind: "payment", voucher: { subContractId, cancelled: false } },
        select: { lineId: true },
      })
    ).map((l) => l.lineId)
  );
  const kept = oldLines.filter((l) => linkedLineIds.has(l.id));
  const keptSum = r3(kept.reduce((s, l) => s + Number(l.amount), 0));
  if (r3(keptSum + total) > r3(Number(sc.amount) + EPS)) {
    return jsonError(`الإجمالي الموزع (${total}) مع الخطوط المرتبطة بالروابط (${keptSum}) يتجاوز قيمة عقد الباطن (${Number(sc.amount)})`);
  }

  // بناء الخطوط الجديدة
  interface NewLine {
    title: string;
    amount: number;
    dueDate: string;
    stageId: number | null;
    sources: number[];
  }
  const newLines: NewLine[] = [];

  if (boqIds) {
    const boqItems = await db.boqItem.findMany({ where: { id: { in: boqIds }, contractId: sc.contractId } });
    if (boqItems.length !== boqIds.length) return jsonError("إحدى بنود الكميات غير موجودة في عقد العميل");
    const weights = boqItems.map((b) => ({ b, w: Number(b.amount) > 0 ? Number(b.amount) : 0 }));
    const wSum = r3(weights.reduce((s, x) => s + x.w, 0));
    if (wSum <= 0) return jsonError("قيم بنود الكميات المختارة صفرية — لا يمكن التوزيع نسبيًا");
    weights.forEach((x, i) => {
      const amount = i === weights.length - 1 ? r3(total - r3(weights.slice(0, i).reduce((s, y) => s + r3((total * y.w) / wSum), 0))) : r3((total * x.w) / wSum);
      if (amount > 0) {
        newLines.push({
          title: x.b.description || `بند ${i + 1}`,
          amount,
          dueDate: dueDate,
          stageId: x.b.stageId,
          sources: [],
        });
      }
    });
  } else if (count !== null && Number.isFinite(count) && count > 0) {
    const n = Math.trunc(count);
    const per = r3(total / n);
    for (let i = 0; i < n; i++) {
      const amount = i === n - 1 ? r3(total - per * (n - 1)) : per;
      newLines.push({ title: `دفعة باطن ${i + 1}`, amount, dueDate, stageId: null, sources: [] });
    }
  } else {
    // مرآة خطة العميل
    const clientPlan = await db.paymentPlanItem.findMany({
      where: { contractId: sc.contractId },
      orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
    });
    if (clientPlan.length === 0) {
      newLines.push({ title: "دفعة كاملة", amount: total, dueDate, stageId: null, sources: [] });
    } else {
      const wSum = r3(clientPlan.reduce((s, p) => s + Number(p.amount), 0));
      clientPlan.forEach((p, i) => {
        const amount =
          i === clientPlan.length - 1
            ? r3(total - r3(clientPlan.slice(0, i).reduce((s, y) => s + r3((total * Number(y.amount)) / wSum), 0)))
            : r3((total * Number(p.amount)) / wSum);
        if (amount > 0) {
          newLines.push({
            title: p.title,
            amount,
            dueDate: p.dueDate || dueDate,
            stageId: p.stageId,
            sources: [p.id],
          });
        }
      });
    }
  }

  if (newLines.length === 0) return jsonError("لا توجد خطوط صالحة للتوزيع");

  const maxSort = oldLines.length > 0 ? Math.max(...oldLines.map((l) => l.sortOrder)) : -1;
  let sortOrder = maxSort + 1;

  await db.$transaction(async (tx) => {
    // احذف غير المرتبطة بروابط
    for (const l of oldLines) {
      if (!linkedLineIds.has(l.id)) {
        await tx.subPaymentSource.deleteMany({ where: { subLineId: l.id } });
        await tx.subPaymentPlanItem.delete({ where: { id: l.id } });
      }
    }
    for (const nl of newLines) {
      const created = await tx.subPaymentPlanItem.create({
        data: {
          subContractId,
          title: nl.title,
          amount: nl.amount,
          dueDate: nl.dueDate,
          sortOrder: sortOrder++,
          stageId: nl.stageId,
        },
      });
      if (nl.sources.length > 0) {
        await tx.subPaymentSource.createMany({
          data: nl.sources.map((custLineId) => ({ subLineId: created.id, custLineId })),
        });
      }
    }
    await tx.contractEvent.create({
      data: {
        contractId: sc.contractId,
        eventType: "توزيع خطة باطن",
        description: `توزيع خطة دفعات الباطن رقم ${subContractId} — إجمالي ${total} على ${newLines.length} خطًا${kept.length ? ` مع إبقاء ${kept.length} خطًا مرتبطًا بروابط` : ""}`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "توزيع",
      entityType: "sub_payment_plan",
      entityId: subContractId,
      entityName: `خطة باطن ${subContractId}`,
    });
  });

  return ok({ distributed: true, linesCreated: newLines.length, keptLines: kept.length, total: r3(newLines.reduce((s, l) => s + l.amount, 0)) });
}
