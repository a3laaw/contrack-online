// ============================================================
// sub-certificate-server.ts — خادم مستخلصات الباطن SubIPC
// (المرحلة أ — docs/retention-subipc-advance-design.md §3)
// المنطق النقي في phase-a-core.ts — هنا فقط الوصول للبيانات
// ============================================================

import "server-only";
import type { PrismaClient } from "@prisma/client";

type Tx = import("@prisma/client").Prisma.TransactionClient;
type DbClient = Tx | PrismaClient;

/** المتاح الكمي لكل بند عقد باطن = الكمية − Σ كميات المستخلصات غير الملغاة (§3.4) */
export async function loadSubCertAvailability(
  client: DbClient,
  subContractId: number
): Promise<Map<number, number>> {
  const items = await client.subContractItem.findMany({
    where: { subContractId },
    select: { id: true, qty: true },
  });
  const used = await client.subCertificateLine.groupBy({
    by: ["subItemId"],
    where: {
      subItemId: { not: null },
      certificate: { subContractId, status: { not: "ملغي" } },
    },
    _sum: { qty: true },
  });
  const usedMap = new Map<number, number>();
  for (const u of used) {
    if (u.subItemId != null) usedMap.set(u.subItemId, Number(u._sum.qty || 0));
  }
  const available = new Map<number, number>();
  for (const it of items) {
    available.set(it.id, Math.max(0, Number(it.qty) - (usedMap.get(it.id) || 0)));
  }
  return available;
}

/** بنود العقد الباطن مع المتاح الكمي — لقائمة الإنشاء في الواجهة (الوصف لقطة من بند BOQ) */
export async function loadSubCertItemsWithAvailability(client: DbClient, subContractId: number) {
  const [items, availability] = await Promise.all([
    client.subContractItem.findMany({
      where: { subContractId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        qty: true,
        unitPrice: true,
        amount: true,
        boqItemId: true,
        boqItem: { select: { description: true, unit: true } },
      },
    }),
    loadSubCertAvailability(client, subContractId),
  ]);
  return items.map((it) => ({
    id: it.id,
    description: it.boqItem?.description || `بند #${it.id}`,
    unit: it.boqItem?.unit || "",
    qty: Number(it.qty),
    unitPrice: Number(it.unitPrice),
    amount: Number(it.amount),
    boqItemId: it.boqItemId,
    availableQty: availability.get(it.id) ?? 0,
  }));
}

/** تسلسل certNo لكل عقد باطن (unique معه) — أعلى رقم قائم + 1 */
export async function nextCertNo(client: DbClient, subContractId: number): Promise<number> {
  const agg = await client.subCertificate.aggregate({
    where: { subContractId },
    _max: { certNo: true },
  });
  return (agg._max.certNo ?? 0) + 1;
}

/** لقطة استرداد الدفعة المقدمة للمقاول الباطن — min(gross × pct/100, المتبقي من الدفعة) */
export async function computeSubAdvanceRecovery(
  client: DbClient,
  subContractId: number,
  gross: number
): Promise<number> {
  const { computeAdvanceRecovery } = await import("@/lib/phase-a-core");
  const sc = await client.subContract.findUnique({
    where: { id: subContractId },
    select: { advanceAmount: true, advanceRecoveryPct: true },
  });
  if (!sc) return 0;
  const agg = await client.subCertificate.aggregate({
    where: { subContractId, status: { not: "ملغي" } },
    _sum: { advanceRecovery: true },
  });
  return computeAdvanceRecovery(
    gross,
    Number(sc.advanceRecoveryPct),
    Number(sc.advanceAmount),
    Number(agg._sum.advanceRecovery || 0)
  );
}
