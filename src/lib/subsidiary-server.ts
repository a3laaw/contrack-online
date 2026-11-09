import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  AR_PARENT_CODE,
  SUBSIDIARY_NATURE,
  SUBSIDIARY_TYPE,
  WIP_CONTROL_CODE,
  WIP_CONTROL_NAME,
  WIP_CONTROL_NOTES,
  buildSubsidiarySpecs,
  type SubsidiaryContractRef,
  type SubsidiaryKind,
} from "@/lib/subsidiary-core";

/**
 * subsidiary-server.ts — خادم ضمان الحسابات الفرعية للعقود (البند الثالث NOVA).
 * كل الدوال تأخذ عميل معاملة (tx) وتعمل داخله — الضمان بالكود الحتمي عبر
 * @@unique([companyId, code]) فلا تكرار ولا سباق منطقي.
 * الفشل الرخو: إن لم يوجد الأب/حساب التحكم (شركة لم تُبذَر شجرتها) تُعيد null
 * والمستدعي يسلك المسار القائم (القاعدة/النصي) — بلا كسر لأي ترحيل.
 * docs/subsidiary-wip-design.md
 */

type DbClient = Prisma.TransactionClient | PrismaClient;

/** ضمان حساب التحكم 1125 «أعمال تحت التنفيذ (WIP)» تحت 1120 — يُنشأ مرة واحدة */
export async function ensureWipControl(tx: DbClient): Promise<{ id: number } | null> {
  const found = await tx.account.findFirst({
    where: { code: WIP_CONTROL_CODE },
    select: { id: true },
  });
  if (found) return found;

  const parent = await tx.account.findFirst({
    where: { code: "1120" },
    select: { id: true },
  });
  if (!parent) return null; // الشركة بلا بذرة دليل — البذر القياسي سيتضمن 1125

  return await tx.account.create({
    data: {
      code: WIP_CONTROL_CODE,
      name: WIP_CONTROL_NAME,
      type: SUBSIDIARY_TYPE,
      nature: SUBSIDIARY_NATURE,
      parentId: parent.id,
      isLeaf: true,
      allowPosting: true,
      isActive: true,
      isSystem: true,
      notes: WIP_CONTROL_NOTES,
    },
    select: { id: true },
  });
}

/**
 * ضمان الحساب الفرعي الواحد لعقد (ar تحت 1121 / wip تحت 1125) — بالكود الحتمي.
 * isSystem: false — الحساب مُدار من المدير إن لزم، وحذفه بلا حركة يعيد
 * إنشاؤه آليًا عند أول ترحيل (self-healing).
 */
export async function ensureContractSubsidiary(
  tx: DbClient,
  kind: SubsidiaryKind,
  contract: SubsidiaryContractRef
): Promise<number | null> {
  const spec = buildSubsidiarySpecs(contract).find((s) => s.kind === kind);
  if (!spec || !spec.code) return null;

  const found = await tx.account.findFirst({
    where: { code: spec.code },
    select: { id: true },
  });
  if (found) return found.id;

  let parentId: number | null = null;
  if (kind === "ar") {
    const p = await tx.account.findFirst({ where: { code: AR_PARENT_CODE }, select: { id: true } });
    parentId = p?.id ?? null;
  } else {
    const wip = await ensureWipControl(tx);
    parentId = wip?.id ?? null;
  }
  if (!parentId) return null;

  const created = await tx.account.create({
    data: {
      code: spec.code,
      name: spec.name,
      type: SUBSIDIARY_TYPE,
      nature: SUBSIDIARY_NATURE,
      parentId,
      isLeaf: true,
      allowPosting: true,
      isActive: true,
      isSystem: false,
      notes: `حساب فرعي آلي للعقد #${contract.id}${contract.contractNumber ? ` (${contract.contractNumber})` : ""} — يُعاد إنشاؤه آليًا عند أول ترحيل إن حُذف`,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * ضمان الحسابين (ذمم + WIP) لعقد — يُستدعى بعد إنشاء العقد وفي الترحيل الخامل.
 * ترتيب الذمم أولًا يضمن أن غياب 1121 (شركة بلا بذرة) يُنهي مبكرًا بلا WIP نصف مضمون.
 */
export async function ensureContractSubsidiaries(
  tx: DbClient,
  contract: SubsidiaryContractRef
): Promise<{ arId: number | null; wipId: number | null }> {
  const arId = await ensureContractSubsidiary(tx, "ar", contract);
  if (arId === null) return { arId: null, wipId: null };
  const wipId = await ensureContractSubsidiary(tx, "wip", contract);
  return { arId, wipId };
}

/**
 * جلب العقد وضمان فرعيه وإعادة (id + name) — نقطة الدخول من مسارات الترحيل
 * التي تحتاج اسم الحساب لسطر القيد (إصدار الفاتورة).
 */
export async function resolveContractSubsidiary(
  tx: DbClient,
  contractId: number,
  kind: SubsidiaryKind
): Promise<{ id: number; name: string } | null> {
  if (!Number.isInteger(contractId) || contractId <= 0) return null;
  const contract = await tx.contract.findUnique({
    where: { id: contractId },
    select: { id: true, contractName: true, contractNumber: true },
  });
  if (!contract) return null;
  const id = await ensureContractSubsidiary(tx, kind, contract);
  if (id === null) return null;
  const spec = buildSubsidiarySpecs(contract).find((s) => s.kind === kind);
  return { id, name: spec?.name || "" };
}

/** إصدار المعرف فقط — للتوجيه الدفعي في تخصيصات السداد */
export async function resolveContractSubsidiaryId(
  tx: DbClient,
  contractId: number,
  kind: SubsidiaryKind
): Promise<number | null> {
  return (await resolveContractSubsidiary(tx, contractId, kind))?.id ?? null;
}
