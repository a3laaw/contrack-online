import "server-only";

import { db } from "@/lib/db";
import { audit } from "@/lib/api-utils";

/**
 * تقرير الفروقات (V3.2 ج) — المرجع: report_service.contract_gaps_report
 * العقود التي تختلف قيمتها عن مجموع خطتها/بنودها.
 */

export interface GapRow {
  contractId: number;
  contractNumber: string;
  customerName: string;
  contractType: string;
  status: string;
  amount: number;
  planTotal: number;
  planN: number;
  itemsTotal: number;
  itemsN: number;
  gapPlan: number;
  gapItems: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export async function contractGapsReport(): Promise<{ rows: GapRow[]; count: number }> {
  const contracts = await db.contract.findMany({
    where: { NOT: { status: { in: ["ملغى", "ملغي"] } } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      contractNumber: true,
      contractType: true,
      status: true,
      amount: true,
      customer: { select: { name: true } },
    },
  });

  const out: GapRow[] = [];
  for (const c of contracts) {
    const amount = r3(Number(c.amount ?? 0));
    const planAgg = await db.paymentPlanItem.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: { contractId: c.id },
    });
    const planTotal = r3(Number(planAgg._sum.amount ?? 0));
    const planN = planAgg._count._all;

    // البنود غير المحذوفة بملحق (deleted_addendum_id=0 كما في المكتبي)
    const itemsAgg = await db.$queryRaw<{ t: number | null; n: bigint }[]>`
      SELECT COALESCE(SUM(COALESCE(qty,1) * COALESCE(unit_price,0)), 0) AS t,
             COUNT(*) AS n
      FROM boq_items
      WHERE contract_id = ${c.id} AND COALESCE(deleted_addendum_id, 0) = 0`;
    const itemsTotal = r3(Number(itemsAgg[0]?.t ?? 0));
    const itemsN = Number(itemsAgg[0]?.n ?? 0);

    const gapPlan = planN > 0 ? r3(planTotal - amount) : 0;
    const gapItems = itemsN > 0 ? r3(itemsTotal - amount) : 0;

    if (Math.abs(gapPlan) <= 0.001 && Math.abs(gapItems) <= 0.001) continue;

    out.push({
      contractId: c.id,
      contractNumber: c.contractNumber,
      customerName: c.customer?.name ?? "",
      contractType: c.contractType ?? "",
      status: c.status ?? "",
      amount,
      planTotal,
      planN,
      itemsTotal,
      itemsN,
      gapPlan,
      gapItems,
    });
  }
  return { rows: out, count: out.length };
}

/**
 * إصلاح الكل — المرجع: GapsDialog._fix_all + lifecycle_service.rescale_payment_plan.
 * وضعان: "amounts" توحيد المبلغ مع المجموع، و"plan" توزيع الخطة على المبلغ.
 * ملاحظة: المكتبي يأخذ نسخة احتياطية للملف أولًا؛ في الويب (Postgres) يُسجَّل
 * كل تغيير في سجل الأحداث وسجل التدقيق بدل النسخة الملفية.
 */
export async function fixGapsAll(
  mode: "amounts" | "plan",
  contractIds: number[],
  username: string
): Promise<{ ok: number; skipped: string[]; errors: string[] }> {
  const rep = await contractGapsReport();
  const targets = rep.rows.filter((r) => contractIds.includes(r.contractId));
  let okCount = 0;
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const r of targets) {
    try {
      if (mode === "amounts") {
        const ref = r.planN > 0 ? r.planTotal : r.itemsTotal;
        const before = r.amount;
        await db.$transaction(async (tx) => {
          await tx.contract.update({
            where: { id: r.contractId },
            data: { amount: ref },
          });
          await tx.contractEvent.create({
            data: {
              contractId: r.contractId,
              eventType: "إصلاح فرق",
              description: `توحيد المبلغ مع المجموع ${ref.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`,
              username,
            },
          });
          await audit(tx, {
            username,
            action: "إصلاح فرق",
            entityType: "contract",
            entityId: r.contractId,
            entityName: r.contractNumber,
            oldStatus: String(before),
            newStatus: String(ref),
            reason: "تحديث المبالغ لتطابق المجاميع (تقرير الفروقات)",
          });
        });
        okCount += 1;
      } else {
        // وضع "plan": توزيع نسبي للخطة على المبلغ (الأخيرة تمتص الكسور)
        const rows = await db.paymentPlanItem.findMany({
          where: { contractId: r.contractId },
          orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, amount: true },
        });
        const total = r3(rows.reduce((s, x) => s + Number(x.amount ?? 0), 0));
        if (!rows.length || total <= 0) {
          skipped.push(r.contractNumber);
          continue;
        }
        const target = r.amount;
        if (target <= 0) throw new Error("المبلغ المستهدف يجب أن يكون أكبر من صفر.");
        const newAmounts: number[] = [];
        let acc = 0;
        for (let i = 0; i < rows.length; i++) {
          if (i < rows.length - 1) {
            const nw = r3((Number(rows[i].amount ?? 0) / total) * target);
            acc = r3(acc + nw);
            newAmounts.push(nw);
          } else {
            newAmounts.push(r3(target - acc));
          }
        }
        if (newAmounts.some((n) => n <= 0)) {
          throw new Error("التوزيع النسبي أنتج دفعة صفرية — راجع الخطة يدويًا.");
        }
        await db.$transaction(async (tx) => {
          for (let i = 0; i < rows.length; i++) {
            await tx.paymentPlanItem.update({
              where: { id: rows[i].id },
              data: { amount: newAmounts[i] },
            });
          }
          await tx.contractEvent.create({
            data: {
              contractId: r.contractId,
              eventType: "إعادة توزيع الدفعات",
              description: `توزيع نسبي على ${target.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} (${rows.length} دفعات)`,
              username,
            },
          });
          await audit(tx, {
            username,
            action: "إصلاح فرق",
            entityType: "contract",
            entityId: r.contractId,
            entityName: r.contractNumber,
            reason: "توزيع الخطط على المبالغ (تقرير الفروقات)",
          });
        });
        okCount += 1;
      }
    } catch (e) {
      errors.push(`${r.contractNumber}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: okCount, skipped, errors };
}
