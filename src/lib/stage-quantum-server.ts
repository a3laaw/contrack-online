// ============================================================
// stage-quantum-server.ts — قراءة الحالة الكمّية للمرحلة من القاعدة
// (بند NOVA 6 — docs/stage-quantum-design.md §3)
// الاشتقاق من الصفوف لحظيًا (G9): البنود غير المحذوفة المرتبطة بالمرحلة
// + تجميع سجلات التنفيذ — ثم النواة النقية deriveStageQuantum.
// effectiveQty = qty (كمية البند الفعلية بعد تطبيق الملحقات كما NOVA-5).
// ============================================================
import "server-only";
import { db } from "@/lib/db";
import { deriveStageQuantum, type StageQuantum } from "@/lib/stage-quantum-core";

/**
 * الحالة الكمّية لمرحلة واحدة — قراءة رخيصة (findMany + groupBy) تُستدعى:
 * - بعد معاملة POST executions (بصورة قبلية اختيارية لمقارنة becameComplete)
 * - عند إقفال مرحلة في PATCH stages/[stageId] للتحذير الاستشاري
 * تعيد null إن كانت المرحلة بلا بنود مرتبطة (غير قابلة للتطبيق — تصميم §2)
 * أو إن لم توجد المرحلة.
 */
export async function quantumForStage(
  contractId: number,
  stageId: number,
  tx?: Parameters<Parameters<typeof db.$transaction>[0]>[0]
): Promise<StageQuantum | null> {
  const client = tx ?? db;
  const stage = await client.contractStage.findFirst({
    where: { id: stageId, contractId },
    select: { id: true },
  });
  if (!stage) return null;
  const items = await client.boqItem.findMany({
    where: { contractId, stageId, deleted: false },
    select: { id: true, qty: true, description: true },
  });
  if (items.length === 0) return null;
  const execAgg = await client.fieldExecution.groupBy({
    by: ["boqItemId"],
    where: { contractId, boqItemId: { in: items.map((i) => i.id) } },
    _sum: { qty: true },
  });
  const executedByItem = new Map<number, number>();
  for (const g of execAgg) executedByItem.set(g.boqItemId, Number(g._sum.qty || 0));
  const derived = deriveStageQuantum(
    items.map((i) => ({
      stageId,
      boqItemId: i.id,
      effectiveQty: Number(i.qty),
      executedQty: executedByItem.get(i.id) || 0,
      description: i.description,
    }))
  );
  return derived[0] ?? null;
}
