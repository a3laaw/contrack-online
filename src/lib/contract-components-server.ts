import "server-only";
import { db } from "@/lib/db";
import { resolvePricingMode, type PricingMode } from "./contract-mode";

/**
 * G6 — مكوّنات العقد لكل عقد (المكتبي contract_service 243–296):
 * اللقطة تُهيَّأ من افتراضيات النوع عند أول قراءة (seed_contract_components)،
 * والحفظ استبدال كامل (save_contract_components).
 */

export interface ContractComponentDTO {
  compKey: string;
  label: string;
  kind: string; // qty | months
  enabled: boolean;
  qty: number;
  months: number;
  monthly: number;
}

/** قراءة لقطة مكوّنات العقد — وتُهيَّأ من افتراضيات النوع إن غابت (عند غياب اللقطة) */
export async function getContractComponents(contractId: number): Promise<ContractComponentDTO[]> {
  const existing = await db.contractComponent.findMany({
    where: { contractId },
    orderBy: { id: "asc" },
  });
  if (existing.length > 0) {
    return existing.map((c) => ({
      compKey: c.compKey,
      label: c.label,
      kind: c.kind,
      enabled: c.enabled,
      qty: Number(c.qty),
      months: c.months,
      monthly: Number(c.monthly),
    }));
  }
  // seed من افتراضيات النوع (لغير الشامل: فارغة كالمكتبي)
  const contract = await db.contract.findUnique({ where: { id: contractId }, select: { contractType: true } });
  if (!contract) return [];
  const type = await db.contractType.findUnique({ where: { name: contract.contractType }, include: { bundleParents: { include: { componentType: { select: { name: true } } } } } });
  if (!type) return [];
  const seeded: ContractComponentDTO[] = type.bundleParents.map((b) => ({
    compKey: b.componentType.name,
    label: b.componentType.name,
    kind: "qty",
    enabled: true,
    qty: Number(b.qty || 1),
    months: 0,
    monthly: 0,
  }));
  if (seeded.length > 0) {
    await db.contractComponent.createMany({
      data: seeded.map((c) => ({ contractId, ...c, qty: c.qty, monthly: c.monthly })),
      skipDuplicates: true,
    });
  }
  return seeded;
}

/** حفظ اللقطة — استبدال كامل، يعيد العدد */
export async function saveContractComponents(contractId: number, comps: ContractComponentDTO[]): Promise<number> {
  await db.$transaction(async (tx) => {
    await tx.contractComponent.deleteMany({ where: { contractId } });
    const rows = (comps || [])
      .filter((c) => (c.compKey || "").trim())
      .map((c) => ({
        contractId,
        compKey: c.compKey.trim(),
        label: (c.label || "").trim(),
        kind: (c.kind || "qty").trim(),
        enabled: Boolean(c.enabled),
        qty: c.qty ?? 1,
        months: Math.trunc(Number(c.months) || 0),
        monthly: c.monthly ?? 0,
      }));
    if (rows.length) await tx.contractComponent.createMany({ data: rows });
    return rows.length;
  });
  return db.contractComponent.count({ where: { contractId } });
}

/** نمط تسعير العقد — الترتيب الخمسي في contract-mode.ts */
export async function getContractMode(contractId: number): Promise<{ mode: PricingMode; isBundleType: boolean }> {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: { contractType: true, supStartDate: true, unitPrice: true },
  });
  if (!contract) return { mode: "lump", isBundleType: false };
  const [itemsCount, typeRow] = await Promise.all([
    db.boqItem.count({ where: { contractId, deleted: false } }),
    db.contractType.findUnique({
      where: { name: contract.contractType },
      select: { pricingMode: true, bundleParents: { select: { id: true } } },
    }),
  ]);
  return {
    mode: resolvePricingMode({
      contractTypeIsBundle: Boolean(typeRow?.bundleParents?.length),
      itemsCount,
      supStartDate: contract.supStartDate,
      unitPrice: Number(contract.unitPrice || 0),
      typeMode: typeRow?.pricingMode || "lump",
    }),
    isBundleType: Boolean(typeRow?.bundleParents?.length),
  };
}
