// ============================================================
// ConTrack Online — موديول الصيانة والتشغيل: طبقة الخادم (docs/maintenance-design.md §5)
// موديول تشغيلي صافٍ: صفر قيود وصفر حسابات — كل المال عبر محركات الفواتير والسندات
// والمخازن القائمة حصرًا. المواد عبر createStockDocTx المستخلصة (مسار كتابة واحد —
// د8)، والفوترة بمحرك الفواتير مع سقف الفوترة القائم (د9)، والبذر المؤجل واحد (د2).
// ============================================================

import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, nextNumber, todayStr } from "@/lib/api-utils";
import { TX_OPTS } from "@/lib/journal-server";
import { buildInvoiceItems, postInvoiceIssueEntry } from "@/lib/invoice-server";
import { EPS, r3 } from "@/lib/contrack-core";
import { intOr, loadContractCore } from "@/lib/contrack-server";
import { createStockDocTx, loadBalances, loadStockMovements } from "@/lib/warehouses-server";
import { docMovements, validateAvailability, type MovementInput } from "@/lib/warehouses-core";
import {
  MAINTENANCE_TYPE_CATEGORY,
  MAINTENANCE_TYPE_NAME,
  WO_PREFIX,
  isWoStatus,
} from "@/lib/maintenance-constants";
import {
  canCancelOrder,
  canEditOrder,
  canInvoiceOrder,
  canIssueMaterials,
  generateOccurrenceDates,
  maintenanceKpis,
  occurrenceStatusOf,
  regeneratePending,
  suggestInvoiceAmount,
  validatePlan,
  validateTransition,
  validateWorkOrder,
} from "@/lib/maintenance-core";

/** خطأ الصيانة برمز حالة — تترجمه المسارات إلى jsonError */
export class MaintenanceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ==================== البذر المؤجل الوحيد (د2 — نمط ensureOne) ====================

/**
 * ضمان نوع «صيانة دورية» الموسوم — بذر مؤجل عند أول فتح لأقسام الصيانة (د2):
 * manualTrack لأن أوامر العمل هي التتبع بلا مراحل، pricingMode lump —
 * إن وُجد الاسم سابقًا بلا وسم يُوسم (لا ازدواج أسماء).
 */
export async function ensureMaintenanceType(): Promise<{ id: number; name: string }> {
  const found = await db.contractType.findFirst({
    where: { name: MAINTENANCE_TYPE_NAME },
    select: { id: true, name: true, isMaintenance: true },
  });
  if (found) {
    if (!found.isMaintenance) {
      await db.contractType.update({ where: { id: found.id }, data: { isMaintenance: true } });
    }
    return { id: found.id, name: found.name };
  }
  const created = await db.contractType.create({
    data: {
      name: MAINTENANCE_TYPE_NAME,
      category: MAINTENANCE_TYPE_CATEGORY,
      defaultAmount: 0,
      notes: "بذر آلي — موديول الصيانة والتشغيل (docs/maintenance-design.md د2)",
      active: true,
      manualTrack: true,
      pricingMode: "lump",
      isMaintenance: true,
    },
  });
  return { id: created.id, name: created.name };
}

/** أسماء الأنواع الموسومة صيانة — الفلتر الحاكم لكل استعلامات الموديول (د11) */
async function maintenanceTypeNames(): Promise<string[]> {
  const types = await db.contractType.findMany({
    where: { isMaintenance: true },
    select: { name: true },
  });
  return types.map((t) => t.name);
}

// ==================== قسم عقود الصيانة (د2 — القائمة المجمعة) ====================

export interface MaintenanceContractRow {
  id: number;
  contractNumber: string;
  contractName: string;
  contractType: string;
  customerName: string;
  amount: number;
  status: string;
  startDate: string;
  endDate: string;
  plan: {
    id: number;
    name: string;
    intervalMonths: number;
    occurrencesCount: number;
    startDate: string;
    active: boolean;
  } | null;
  nextDue: string | null;
  openOrders: number;
  invoiced: number;
}

/** قائمة العقود الموسومة صيانة مع تجميعاتها (خطة/حدث قادم/أوامر مفتوحة/المفوتر) — استعلامات مجمعة */
export async function loadMaintenanceContracts(): Promise<{
  contracts: MaintenanceContractRow[];
  typeNames: string[];
}> {
  // البذر المؤجل (د2): أول فتح للقسم يبذّر «صيانة دورية» حرفيًا حتى لو كان جدول الأنواع فارغًا —
  // ثم تُقرأ الأسماء بعده حتى يدخل النوع المبذور في الفلتر الحاكم فورًا (وإلا حلقة ميتة: لا أنواع ⇒ لا قائمة ⇒ لا إنشاء).
  await ensureMaintenanceType();
  const typeNames = await maintenanceTypeNames();
  if (typeNames.length === 0) return { contracts: [], typeNames };

  const contracts = await db.contract.findMany({
    where: { contractType: { in: typeNames } },
    orderBy: { id: "desc" },
    take: 200,
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      contractType: true,
      amount: true,
      status: true,
      startDate: true,
      endDate: true,
      customer: { select: { name: true } },
    },
  });
  const ids = contracts.map((c) => c.id);
  const today = todayStr();
  const empty = { contracts: [] as MaintenanceContractRow[], typeNames };
  if (ids.length === 0) return empty;

  const [plans, orderAgg, invoicedAgg, occurrences] = await Promise.all([
    db.maintenancePlan.findMany({
      where: { contractId: { in: ids } },
      select: {
        id: true, contractId: true, name: true, intervalMonths: true,
        occurrencesCount: true, startDate: true, active: true,
      },
    }),
    db.workOrder.groupBy({
      by: ["contractId", "status"],
      where: { contractId: { in: ids } },
      _count: { _all: true },
    }),
    db.invoice.groupBy({
      by: ["contractId"],
      where: { contractId: { in: ids }, status: { not: "void" } },
      _sum: { total: true },
    }),
    db.maintenanceOccurrence.findMany({
      where: { plan: { contractId: { in: ids } } },
      select: {
        dueDate: true,
        skipped: true,
        plan: { select: { contractId: true, active: true } },
        workOrder: { select: { status: true } },
      },
      orderBy: { dueDate: "asc" as const },
    }),
  ]);

  const openBy = new Map<number, number>();
  for (const g of orderAgg) {
    if (g.status === "مفتوحة" || g.status === "جارية") {
      openBy.set(g.contractId, (openBy.get(g.contractId) ?? 0) + g._count._all);
    }
  }
  const invoicedBy = new Map<number, number>();
  for (const g of invoicedAgg) {
    if (g.contractId != null) invoicedBy.set(g.contractId, r3(Number(g._sum.total ?? 0)));
  }
  // الحدث القادم لكل عقد: أقرب مجدول (بلا أمر نشط، بلا تخطٍّ، خطة نشطة) بتاريخ اليوم فأبعد
  const nextBy = new Map<number, string>();
  for (const o of occurrences) {
    const cid = o.plan.contractId;
    if (nextBy.has(cid)) continue; // مرتبة تصاعديًا — الأول يفوز
    const st = occurrenceStatusOf({ skipped: o.skipped }, o.workOrder);
    if (st !== "مجدولة") continue;
    if (o.dueDate < today) continue;
    nextBy.set(cid, o.dueDate);
  }

  const rows: MaintenanceContractRow[] = contracts.map((c) => {
    const plan = plans.find((p) => p.contractId === c.id) ?? null;
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      contractType: c.contractType,
      customerName: c.customer.name,
      amount: r3(Number(c.amount)),
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            intervalMonths: plan.intervalMonths,
            occurrencesCount: plan.occurrencesCount,
            startDate: plan.startDate,
            active: plan.active,
          }
        : null,
      nextDue: nextBy.get(c.id) ?? null,
      openOrders: openBy.get(c.id) ?? 0,
      invoiced: invoicedBy.get(c.id) ?? 0,
    };
  });
  return { contracts: rows, typeNames };
}

// ==================== الجدول الوقائي (د5/د6) ====================

export interface SchedulePlanRow {
  id: number;
  contractId: number;
  contractNumber: string;
  contractName: string;
  customerName: string;
  name: string;
  intervalMonths: number;
  occurrencesCount: number;
  startDate: string;
  active: boolean;
  notes: string;
  occurrences: {
    id: number;
    dueDate: string;
    skipped: boolean;
    note: string;
    status: string; // اشتقاقية — د6
    workOrderId: number | null;
    workOrderNumber: string | null;
    workOrderStatus: string | null;
  }[];
}

/** خطط الصيانة بأحداثها وحالاتها الاشتقاقية — القادم أولًا داخل كل خطة */
export async function loadMaintenanceSchedule(): Promise<SchedulePlanRow[]> {
  const typeNames = await maintenanceTypeNames();
  if (typeNames.length === 0) return [];
  const plans = await db.maintenancePlan.findMany({
    where: { contract: { contractType: { in: typeNames } } },
    orderBy: { id: "desc" },
    take: 100,
    include: {
      contract: {
        select: { contractNumber: true, contractName: true, customer: { select: { name: true } } },
      },
      occurrences: {
        orderBy: { dueDate: "asc" as const },
        include: { workOrder: { select: { id: true, docNumber: true, status: true } } },
      },
    },
  });
  return plans.map((p) => ({
    id: p.id,
    contractId: p.contractId,
    contractNumber: p.contract.contractNumber,
    contractName: p.contract.contractName,
    customerName: p.contract.customer.name,
    name: p.name,
    intervalMonths: p.intervalMonths,
    occurrencesCount: p.occurrencesCount,
    startDate: p.startDate,
    active: p.active,
    notes: p.notes,
    occurrences: p.occurrences.map((o) => ({
      id: o.id,
      dueDate: o.dueDate,
      skipped: o.skipped,
      note: o.note,
      status: occurrenceStatusOf({ skipped: o.skipped }, o.workOrder),
      workOrderId: o.workOrder?.id ?? null,
      workOrderNumber: o.workOrder?.docNumber ?? null,
      workOrderStatus: o.workOrder?.status ?? null,
    })),
  }));
}

async function requireMaintenanceContract(contractId: number) {
  const typeNames = await maintenanceTypeNames();
  const contract = await db.contract.findFirst({
    where: { id: contractId, contractType: { in: typeNames.length ? typeNames : ["__none__"] } },
    select: { id: true, contractNumber: true, contractType: true, status: true, amount: true },
  });
  if (!contract) throw new MaintenanceError("عقد الصيانة غير موجود أو النوع غير موسوم صيانة (د2)");
  return contract;
}

/** إنشاء خطة وقائية — معاملة واحدة: خطة + أحداثها المولدة + audit (د5) */
export async function createMaintenancePlan(
  input: {
    contractId: number;
    name?: string;
    intervalMonths: number;
    occurrencesCount: number;
    startDate: string;
    notes?: string;
  },
  actor: string
): Promise<{ id: number; occurrencesCount: number }> {
  const contract = await requireMaintenanceContract(input.contractId);
  if (contract.status !== "نشط") throw new MaintenanceError("العقد غير نشط — لا خطط صيانة عليه");
  const errors = validatePlan({
    intervalMonths: input.intervalMonths,
    occurrencesCount: input.occurrencesCount,
    startDate: input.startDate,
  });
  if (errors.length > 0) throw new MaintenanceError(errors[0]);
  const existing = await db.maintenancePlan.findFirst({ where: { contractId: input.contractId }, select: { id: true } });
  if (existing) throw new MaintenanceError("لعقد الصيانة خطة قائمة — عدّلها بدل إنشاء ثانية (خطة واحدة لكل عقد — د5)");

  const dates = generateOccurrenceDates({
    startDate: input.startDate,
    intervalMonths: input.intervalMonths,
    occurrencesCount: input.occurrencesCount,
  });
  const result = await db.$transaction(async (tx) => {
    const plan = await tx.maintenancePlan.create({
      data: {
        contractId: input.contractId,
        name: (input.name || "").trim(),
        intervalMonths: input.intervalMonths,
        occurrencesCount: input.occurrencesCount,
        startDate: input.startDate,
        active: true,
        notes: (input.notes || "").trim(),
      },
    });
    await tx.maintenanceOccurrence.createMany({
      data: dates.map((d) => ({ planId: plan.id, dueDate: d })),
    });
    await audit(tx, {
      username: actor,
      action: "إنشاء",
      entityType: "maintenance_plan",
      entityId: plan.id,
      entityName: `خطة صيانة ${contract.contractNumber} — ${input.occurrencesCount} زيارات`,
      newStatus: "active",
    });
    return { id: plan.id, occurrencesCount: dates.length };
  }, TX_OPTS);
  return result;
}

/** تعديل الخطة — يحفظ المنجز والمتخطى ويعيد توليد المعلق حصرًا (د5 — G9: الحالة اشتقاقية) */
export async function updateMaintenancePlan(
  planId: number,
  input: {
    name?: string;
    intervalMonths: number;
    occurrencesCount: number;
    startDate: string;
    active?: boolean;
    notes?: string;
  },
  actor: string
): Promise<{ kept: number; removed: number; created: number }> {
  const plan = await db.maintenancePlan.findFirst({
    where: { id: planId },
    include: {
      occurrences: { include: { workOrder: { select: { id: true, status: true } } } },
      contract: { select: { contractNumber: true } },
    },
  });
  if (!plan) throw new MaintenanceError("الخطة غير موجودة", 404);
  const errors = validatePlan({
    intervalMonths: input.intervalMonths,
    occurrencesCount: input.occurrencesCount,
    startDate: input.startDate,
  });
  if (errors.length > 0) throw new MaintenanceError(errors[0]);

  const existing = plan.occurrences.map((o) => ({
    id: o.id,
    dueDate: o.dueDate,
    skipped: o.skipped,
    workOrderId: o.workOrder?.id ?? null,
    workOrderStatus: o.workOrder?.status ?? null,
  }));
  const reg = regeneratePending(existing, {
    startDate: input.startDate,
    intervalMonths: input.intervalMonths,
    occurrencesCount: input.occurrencesCount,
  });

  const result = await db.$transaction(async (tx) => {
    await tx.maintenancePlan.update({
      where: { id: planId },
      data: {
        name: (input.name ?? plan.name).trim(),
        intervalMonths: input.intervalMonths,
        occurrencesCount: input.occurrencesCount,
        startDate: input.startDate,
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      },
    });
    if (reg.removeIds.length > 0) {
      await tx.maintenanceOccurrence.deleteMany({ where: { id: { in: reg.removeIds } } });
    }
    if (reg.createDates.length > 0) {
      await tx.maintenanceOccurrence.createMany({
        data: reg.createDates.map((d) => ({ planId, dueDate: d })),
      });
    }
    await audit(tx, {
      username: actor,
      action: "تعديل",
      entityType: "maintenance_plan",
      entityId: planId,
      entityName: `خطة صيانة ${plan.contract.contractNumber}`,
      reason: `محفوظ ${reg.keepIds.length} · محذوف ${reg.removeIds.length} · مولّد ${reg.createDates.length} (د5)`,
    });
    return { kept: reg.keepIds.length, removed: reg.removeIds.length, created: reg.createDates.length };
  }, TX_OPTS);
  return result;
}

/** تخطي/إلغاء تخطي حدث وقائي — مرفوض ذو أمر نشط (د6) */
export async function toggleOccurrenceSkip(
  occurrenceId: number,
  actor: string
): Promise<{ skipped: boolean }> {
  const occ = await db.maintenanceOccurrence.findFirst({
    where: { id: occurrenceId },
    include: {
      workOrder: { select: { id: true, status: true } },
      plan: { select: { contractId: true } },
    },
  });
  if (!occ) throw new MaintenanceError("الحدث الوقائي غير موجود", 404);
  if (occ.workOrder && occ.workOrder.status !== "ملغاة") {
    throw new MaintenanceError("للحدث أمر عمل نشط — لا يُخطَّى؛ أنهِ أو ألغِ الأمر أولًا");
  }
  const skipped = !occ.skipped;
  await db.$transaction(async (tx) => {
    await tx.maintenanceOccurrence.update({ where: { id: occurrenceId }, data: { skipped } });
    await audit(tx, {
      username: actor,
      action: skipped ? "تخطي حدث" : "إلغاء تخطي",
      entityType: "maintenance_occurrence",
      entityId: occurrenceId,
      entityName: `حدث ${occ.dueDate}`,
    });
  }, TX_OPTS);
  return { skipped };
}

// ==================== أوامر العمل (د3/د4) ====================

export interface WorkOrderRow {
  id: number;
  docNumber: string;
  title: string;
  description: string;
  contractId: number;
  contractNumber: string;
  contractName: string;
  customerName: string;
  occurrenceId: number | null;
  occurrenceDue: string | null;
  technicianId: number | null;
  technicianName: string | null;
  scheduledDate: string;
  status: string;
  completedAt: string;
  completedNote: string;
  cancelReason: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  materialsDocId: number | null;
  materialsDocNumber: string | null;
  materialsTotal: number | null;
  notes: string;
  createdAt: string;
}

/** قائمة أوامر العمل بفلاترها — الأحدث أولًا */
export async function loadWorkOrders(filters: {
  status?: string;
  contractId?: number;
  technicianId?: number;
  from?: string;
  to?: string;
}): Promise<WorkOrderRow[]> {
  const where: Prisma.WorkOrderWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.contractId) where.contractId = filters.contractId;
  if (filters.technicianId) where.technicianId = filters.technicianId;
  if (filters.from || filters.to) {
    where.scheduledDate = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  const rows = await db.workOrder.findMany({
    where,
    orderBy: { id: "desc" },
    take: 200,
    include: {
      contract: {
        select: { contractNumber: true, contractName: true, customer: { select: { name: true } } },
      },
      occurrence: { select: { dueDate: true } },
      technician: { select: { name: true } },
      invoice: { select: { invoiceNumber: true, total: true } },
      materialsDoc: { select: { docNumber: true, totalAmount: true } },
    },
  });
  return rows.map((w) => ({
    id: w.id,
    docNumber: w.docNumber,
    title: w.title,
    description: w.description,
    contractId: w.contractId,
    contractNumber: w.contract.contractNumber,
    contractName: w.contract.contractName,
    customerName: w.contract.customer.name,
    occurrenceId: w.occurrenceId,
    occurrenceDue: w.occurrence?.dueDate ?? null,
    technicianId: w.technicianId,
    technicianName: w.technician?.name ?? null,
    scheduledDate: w.scheduledDate,
    status: w.status,
    completedAt: w.completedAt,
    completedNote: w.completedNote,
    cancelReason: w.cancelReason,
    invoiceId: w.invoiceId,
    invoiceNumber: w.invoice?.invoiceNumber ?? null,
    invoiceTotal: w.invoice ? r3(Number(w.invoice.total)) : null,
    materialsDocId: w.materialsDocId,
    materialsDocNumber: w.materialsDoc?.docNumber ?? null,
    materialsTotal: w.materialsDoc ? r3(Number(w.materialsDoc.totalAmount)) : null,
    notes: w.notes,
    createdAt: w.createdAt.toISOString(),
  }));
}

/** إنشاء أمر عمل — تحقق نقي + مرجعي (G8) ثم معاملة ترقيم + audit — بلا أي قيد (موديول تشغيلي) */
export async function createWorkOrder(
  input: {
    title: string;
    description?: string;
    contractId: number;
    occurrenceId?: number | null;
    technicianId?: number | null;
    scheduledDate: string;
    notes?: string;
  },
  actor: string
): Promise<{ id: number; docNumber: string }> {
  // المراجع للتحقق النقي (G8)
  const typeNames = await maintenanceTypeNames();
  const contract = await db.contract.findFirst({
    where: { id: input.contractId, contractType: { in: typeNames.length ? typeNames : ["__none__"] } },
    select: { id: true, contractNumber: true, status: true, contractType: true },
  });
  const technician = input.technicianId
    ? await db.visitStaff.findFirst({ where: { id: input.technicianId }, select: { id: true, active: true } })
    : null;
  const errors = validateWorkOrder(
    {
      title: input.title,
      scheduledDate: input.scheduledDate,
      contractId: input.contractId,
      technicianId: input.technicianId ?? null,
    },
    {
      contract: contract
        ? { id: contract.id, status: contract.status, isMaintenance: true }
        : input.contractId
          ? { id: input.contractId, status: "", isMaintenance: false } // موجود لكن غير موسوم
          : null,
      technician: technician ? { id: technician.id, active: technician.active } : null,
    }
  );
  if (errors.length > 0) throw new MaintenanceError(errors[0]);

  // الحدث إن وُصل: يجب أن يعود لخطة نفس العقد وبلا أمر نشط (حدث واحد ⇒ أمر واحد)
  let occurrence: { id: number; dueDate: string } | null = null;
  if (input.occurrenceId) {
    const occ = await db.maintenanceOccurrence.findFirst({
      where: { id: input.occurrenceId },
      include: { workOrder: { select: { id: true, status: true } }, plan: { select: { contractId: true } } },
    });
    if (!occ) throw new MaintenanceError("الحدث الوقائي غير موجود", 404);
    if (occ.plan.contractId !== input.contractId) {
      throw new MaintenanceError("الحدث الوقائي لا يعود لخطة عقد هذا الأمر");
    }
    if (occ.workOrder && occ.workOrder.status !== "ملغاة") {
      throw new MaintenanceError("الحدث له أمر عمل نشط بالفعل");
    }
    occurrence = { id: occ.id, dueDate: occ.dueDate };
  }

  const result = await db.$transaction(async (tx) => {
    const docNumber = await nextNumber(WO_PREFIX, 4, tx);
    const wo = await tx.workOrder.create({
      data: {
        docNumber,
        title: input.title.trim(),
        description: (input.description || "").trim(),
        contractId: input.contractId,
        occurrenceId: occurrence?.id ?? null,
        technicianId: input.technicianId ?? null,
        scheduledDate: input.scheduledDate,
        status: "مفتوحة",
        notes: (input.notes || "").trim(),
        createdBy: actor,
      },
    });
    await audit(tx, {
      username: actor,
      action: "إنشاء",
      entityType: "work_order",
      entityId: wo.id,
      entityName: `${docNumber} — ${input.title.trim()}`,
      newStatus: "مفتوحة",
    });
    return { id: wo.id, docNumber };
  }, TX_OPTS);
  return result;
}

async function requireWorkOrder(id: number) {
  const wo = await db.workOrder.findFirst({
    where: { id },
    include: {
      contract: { select: { contractNumber: true, contractName: true, status: true, contractType: true } },
      invoice: { select: { id: true, invoiceNumber: true } },
      materialsDoc: { select: { id: true, docNumber: true, status: true } },
    },
  });
  if (!wo) throw new MaintenanceError("أمر العمل غير موجود", 404);
  return wo;
}

/** تعديل أمر وهو «مفتوحة» حصرًا (د4) */
export async function updateWorkOrder(
  id: number,
  input: {
    title?: string;
    description?: string;
    technicianId?: number | null;
    scheduledDate?: string;
    notes?: string;
  },
  actor: string
): Promise<{ id: number }> {
  const wo = await requireWorkOrder(id);
  const gate = canEditOrder({ status: isWoStatus(wo.status) ? wo.status : "مفتوحة" });
  if (gate) throw new MaintenanceError(gate);
  if (input.technicianId) {
    const t = await db.visitStaff.findFirst({ where: { id: input.technicianId }, select: { active: true } });
    if (!t) throw new MaintenanceError("الفني المختار غير موجود", 404);
    if (!t.active) throw new MaintenanceError("الفني المختار معطّل — اختر فنيًا نشطًا");
  }
  if (input.scheduledDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
    throw new MaintenanceError("تاريخ الجدولة مطلوب بصيغة YYYY-MM-DD");
  }
  await db.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.technicianId !== undefined ? { technicianId: input.technicianId || null } : {}),
        ...(input.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
        ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      },
    });
    await audit(tx, {
      username: actor,
      action: "تعديل",
      entityType: "work_order",
      entityId: id,
      entityName: `${wo.docNumber} — ${input.title?.trim() || wo.title}`,
    });
  }, TX_OPTS);
  return { id };
}

/** انتقال حالة الأمر — آلة مغلقة (د4) + بوابات الإلغاء (د8) */
export async function transitionWorkOrder(
  id: number,
  to: string,
  opts: { reason?: string; completedNote?: string },
  actor: string
): Promise<{ status: string }> {
  const wo = await requireWorkOrder(id);
  const from = isWoStatus(wo.status) ? wo.status : null;
  if (!from) throw new MaintenanceError(`حالة الأمر غير معروفة: ${wo.status}`);
  const gate = validateTransition(from, to as never);
  if (gate) throw new MaintenanceError(gate);

  if (to === "ملغاة") {
    const refuse = canCancelOrder({
      status: from,
      materialsDocId: wo.materialsDoc?.id ?? null,
      materialsDocNumber: wo.materialsDoc?.docNumber ?? null,
      // الإذن الملغى (سُحب من المخازن وعُكس قيده) لم يعد مانعًا — د8: الرفض للإذن الحي حصرًا
      materialsDocCancelled: wo.materialsDoc?.status === "cancelled",
      invoiceId: wo.invoice?.id ?? null,
      invoiceNumber: wo.invoice?.invoiceNumber ?? null,
    });
    if (refuse) throw new MaintenanceError(refuse);
    if (!opts.reason?.trim()) throw new MaintenanceError("سبب الإلغاء مطلوب");
  }

  await db.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: { id },
      data: {
        status: to,
        ...(to === "منجزة" ? { completedAt: todayStr() } : {}),
        ...(to === "منجزة" ? { completedNote: (opts.completedNote || "").trim() } : {}),
        ...(to === "ملغاة"
          ? { cancelReason: opts.reason!.trim(), cancelledAt: todayStr() }
          : {}),
      },
    });
    await audit(tx, {
      username: actor,
      action: to === "ملغاة" ? "إلغاء" : "تغيير حالة",
      entityType: "work_order",
      entityId: id,
      entityName: `${wo.docNumber} — ${wo.title}`,
      oldStatus: from,
      newStatus: to,
      reason: (opts.reason || opts.completedNote || "").trim(),
    });
  }, TX_OPTS);
  return { status: to };
}

// ==================== صرف المواد على الأمر (د8 — بمحرك المخازن حرفًا) ====================

export interface IssueMaterialsResult {
  docId: number;
  docNumber: string;
  totalAmount: number;
  journalEntryId: number | null;
}

/**
 * إذن صرف مخزني واحد لكل أمر — نفس خطوات مسار المخازن حرفيًا (تحقق → لقطات خادمية →
 * فحص خط الزمني → createStockDocTx) وببُعد العقد إلزاميًا، ثم يربط الأمر materialsDocId.
 */
export async function issueMaterialsForOrder(
  orderId: number,
  input: {
    vdate: string;
    warehouseId: number;
    notes?: string;
    lines: { itemId: number; qty: number; note?: string }[];
  },
  actor: string
): Promise<IssueMaterialsResult> {
  const wo = await requireWorkOrder(orderId);
  const gate = canIssueMaterials({
    status: isWoStatus(wo.status) ? wo.status : "مفتوحة",
    materialsDocId: wo.materialsDoc?.id ?? null,
  });
  if (gate) throw new MaintenanceError(gate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.vdate)) {
    throw new MaintenanceError("تاريخ الإذن مطلوب بصيغة YYYY-MM-DD");
  }
  const rawLines = (input.lines ?? []).filter((l) => l && Number(l.itemId) > 0 && Number(l.qty) > 0);
  if (rawLines.length === 0) throw new MaintenanceError("الإذن بلا أسطر — أضف صنفًا واحدًا على الأقل");

  // المراجع — مرآة مسار المخازن (G8)
  const contract = await db.contract.findFirst({
    where: { id: wo.contractId },
    select: { id: true, contractNumber: true, status: true },
  });
  if (!contract) throw new MaintenanceError("عقد الأمر غير موجود", 404);
  if (contract.status === "ملغى" || contract.status === "مسودة") {
    throw new MaintenanceError(`العقد ${contract.contractNumber} غير صالح للصرف المخزني`);
  }
  const warehouse = await db.warehouse.findFirst({
    where: { id: input.warehouseId },
    select: { id: true, name: true, active: true },
  });
  if (!warehouse) throw new MaintenanceError("المستودع غير موجود", 404);
  if (!warehouse.active) throw new MaintenanceError("المستودع موقوف — لا أذون جديدة عليه");
  const itemIds = Array.from(new Set(rawLines.map((l) => Number(l.itemId))));
  const items = await db.stockItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, active: true },
  });
  if (items.length !== itemIds.length) throw new MaintenanceError("أحد الأصناف غير موجود", 404);
  const inactive = items.filter((i) => !i.active);
  if (inactive.length > 0) throw new MaintenanceError(`الصنف «${inactive[0].name}» موقوف — لا حركة جديدة عليه`);
  const itemNames = new Map(items.map((i) => [i.id, i.name]));

  // اللقطات الخادمية حصرًا (د2 المخازن) + فحص السالب بإعادة تشغيل الخط الزمني (د4 المخازن — درس G9)
  const parsedLines = rawLines.map((l) => ({ itemId: Number(l.itemId), qty: r3(Number(l.qty)), note: (l.note || "").trim() }));
  const { balances } = await loadBalances();
  const lines = parsedLines.map((l) => {
    const b = balances.find((x) => x.itemId === l.itemId && x.warehouseId === warehouse.id);
    return {
      itemId: l.itemId,
      boqItemId: null as number | null,
      qty: l.qty,
      countedQty: 0,
      snapUnitCost: b && b.qty > 0 ? b.wac : 0,
      note: l.note,
    };
  });
  const head = {
    kind: "issue" as const,
    entrySource: "" as const,
    vdate: input.vdate,
    warehouseId: warehouse.id,
    targetWarehouseId: null,
    contractId: contract.id,
    payAccountId: null,
    party: "",
    status: "posted" as const,
  };
  const incoming: MovementInput[] = docMovements(head, lines);
  const existingMovements = await loadStockMovements();
  const violations = validateAvailability(existingMovements, incoming);
  if (violations.length > 0) {
    const v = violations[0];
    throw new MaintenanceError(
      `الكمية غير متوفرة — الصنف «${itemNames.get(v.itemId) ?? `#${v.itemId}`}» بمستودع «${warehouse.name}»: المتاح ${v.available} والمطلوب ${v.required}`
    );
  }
  const totalAmount = r3(lines.reduce((s, l) => s + Math.abs(r3(l.qty * l.snapUnitCost)), 0));

  const result = await db.$transaction(async (tx) => {
    const doc = await createStockDocTx(tx, {
      kind: "issue",
      entrySource: "",
      vdate: input.vdate,
      warehouseId: warehouse.id,
      targetWarehouseId: null,
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      party: "",
      payAccountId: null,
      payAccountName: "",
      totalAmount,
      notes: (input.notes || "").trim() || `صرف مواد أمر عمل ${wo.docNumber}`,
      actor,
      auditLabel: `صرف مواد أمر عمل ${wo.docNumber}`,
      lines,
    });
    await tx.workOrder.update({ where: { id: wo.id }, data: { materialsDocId: doc.docId } });
    await audit(tx, {
      username: actor,
      action: "ربط إذن صرف",
      entityType: "work_order",
      entityId: wo.id,
      entityName: `${wo.docNumber} — ${wo.title}`,
      reason: `إذن ${doc.docNumber} بقيمة ${totalAmount}`,
    });
    return { docId: doc.docId, docNumber: doc.docNumber, totalAmount, journalEntryId: doc.journalEntryId };
  }, TX_OPTS);
  return result;
}

// ==================== فاتورة الزيارة (د9 — بمحرك الفواتير وسقفه) ====================

export interface InvoiceOrderResult {
  invoiceId: number;
  invoiceNumber: string;
  total: number;
  entryNo: number;
}

/** مزامنة عدّاد INV — مرآة مسار الفواتير والمبيعات (العدّاد لا يتراجع) */
async function syncInvoiceCounter(): Promise<void> {
  const maxNoAgg = await db.invoice.aggregate({ _max: { invoiceNo: true } });
  const maxInvoiceNo = maxNoAgg._max.invoiceNo ?? 0;
  if (maxInvoiceNo > 0) {
    const seqRow = await db.numberSequence.findFirst({ where: { name: "voucher:INV" } });
    if (!seqRow) {
      await db.numberSequence.create({ data: { name: "voucher:INV", lastNo: maxInvoiceNo } });
    } else if (Number(seqRow.lastNo) < maxInvoiceNo) {
      await db.numberSequence.update({
        where: { companyId_name: { companyId: seqRow.companyId, name: "voucher:INV" } },
        data: { lastNo: maxInvoiceNo },
      });
    }
  }
}

/**
 * فاتورة الزيارة بعد الإنهاء حصرًا (د9) — سطر واحد مقترحه قيمة العقد ÷ زيارات الخطة
 * (قابل للتعديل)، على العقد بمحرك الفواتير القائم مع سقف الفوترة نفسه وحدث العقد —
 * والقبض يبقى بسند RV من شاشاته.
 */
export async function invoiceWorkOrder(
  orderId: number,
  input: { invoiceDate: string; linePrice?: number | null; description?: string; notes?: string },
  actor: string
): Promise<InvoiceOrderResult> {
  const wo = await requireWorkOrder(orderId);
  const gate = canInvoiceOrder({
    status: isWoStatus(wo.status) ? wo.status : "مفتوحة",
    invoiceId: wo.invoice?.id ?? null,
  });
  if (gate) throw new MaintenanceError(gate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate)) {
    throw new MaintenanceError("تاريخ الفاتورة مطلوب بصيغة YYYY-MM-DD");
  }

  const contract = await db.contract.findFirst({
    where: { id: wo.contractId },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!contract) throw new MaintenanceError("عقد الأمر غير موجود", 404);

  // السعر: المُدخل صراحةً وإلا المقترح (قيمة العقد ÷ زيارات الخطة — د9)
  const plan = await db.maintenancePlan.findFirst({
    where: { contractId: wo.contractId },
    select: { occurrencesCount: true },
  });
  const suggested = suggestInvoiceAmount(r3(Number(contract.amount)), plan?.occurrencesCount ?? null);
  const price = input.linePrice != null && Number(input.linePrice) > 0 ? r3(Number(input.linePrice)) : suggested;
  const description =
    (input.description || "").trim() || `أمر صيانة ${wo.docNumber} — ${wo.title}`;

  const built = buildInvoiceItems([{ description, quantity: 1, unitPrice: price }]);
  if (!built.ok) throw new MaintenanceError(built.error);

  // سقف الفوترة القائم حرفيًا — نفس رسالة مسار الفواتير (د9)
  const core = await loadContractCore(contract.id);
  if (!core) throw new MaintenanceError("العقد غير موجود", 404);
  const invoicedAgg = await db.invoice.aggregate({
    where: { contractId: contract.id, status: { not: "void" } },
    _sum: { total: true },
  });
  const invoicedBefore = r3(Number(invoicedAgg._sum.total || 0));
  const remaining = r3(core.current - invoicedBefore);
  if (built.total > remaining + EPS) {
    throw new MaintenanceError(`الفاتورة تتجاوز المتبقي من العقد (${remaining} د.ك)`);
  }

  await syncInvoiceCounter();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await db.$transaction(async (tx) => {
        const invoiceNumber = await nextNumber("INV", 4, tx);
        const invoiceNo = intOr(invoiceNumber.replace(/^INV-/, ""), 0);
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            invoiceNo,
            customerId: contract.customerId,
            contractId: contract.id,
            invoiceDate: input.invoiceDate,
            dueDate: "",
            description,
            subtotal: built.subtotal,
            discountTotal: built.discountTotal,
            total: built.total,
            notes: (input.notes || "").trim() || `فاتورة زيارة — أمر عمل ${wo.docNumber}`,
          },
        });
        await tx.invoiceItem.createMany({
          data: built.items.map((it, i) => ({
            invoiceId: invoice.id,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discountPct: it.discountPct,
            lineTotal: it.lineTotal,
            sortOrder: i,
          })),
        });
        const entry = await postInvoiceIssueEntry(
          tx,
          {
            id: invoice.id,
            invoiceNumber,
            invoiceDate: input.invoiceDate,
            total: built.total,
            customerId: contract.customerId,
            contractId: contract.id,
          },
          contract.customer.name,
          actor
        );
        await tx.contractEvent.create({
          data: {
            contractId: contract.id,
            eventType: "إصدار فاتورة",
            description: `إصدار فاتورة ${invoiceNumber} بمبلغ ${built.total} (قيد #${entry.entryNo}) — العقد ${contract.contractNumber} — أمر عمل ${wo.docNumber}`,
            username: actor,
          },
        });
        await tx.workOrder.update({ where: { id: wo.id }, data: { invoiceId: invoice.id } });
        await audit(tx, {
          username: actor,
          action: "إنشاء",
          entityType: "invoice",
          entityId: invoice.id,
          entityName: `${invoiceNumber} (فاتورة زيارة — أمر ${wo.docNumber})`,
        });
        return { invoiceId: invoice.id, invoiceNumber, total: built.total, entryNo: entry.entryNo };
      }, TX_OPTS);
      return result;
    } catch (e) {
      if (e instanceof MaintenanceError) throw e;
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("مقفلة") || msg.includes("فاتورة غير صالحة")) {
        throw new MaintenanceError(msg, 400);
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        lastError = e;
        continue;
      }
      lastError = e;
      break;
    }
  }
  console.error("فشل فوترة أمر الصيانة:", lastError);
  throw new MaintenanceError("تعذر إصدار فاتورة الزيارة، حاول مجددًا", 500);
}

// ==================== مؤشرات الشاشة (د12 — من القوائم) ====================

/** KPI الشاشة من قائمي الأوامر والأحداث + عدد العقود النشطة — بلا استعلامات موازية */
export async function loadMaintenanceKpis() {
  const typeNames = await maintenanceTypeNames();
  const today = todayStr();
  const [orderStatuses, occurrences, activeContracts] = await Promise.all([
    db.workOrder.findMany({ where: { status: { in: ["مفتوحة", "جارية"] } }, select: { status: true } }),
    db.maintenanceOccurrence.findMany({
      where: { plan: { active: true, contract: { contractType: { in: typeNames.length ? typeNames : ["__none__"] } } } },
      select: { dueDate: true, skipped: true, workOrder: { select: { status: true } } },
    }),
    typeNames.length
      ? db.contract.count({ where: { contractType: { in: typeNames }, status: "نشط" } })
      : Promise.resolve(0),
  ]);
  return maintenanceKpis({
    orders: orderStatuses.map((o) => ({ status: isWoStatus(o.status) ? o.status : "مفتوحة" })),
    occurrences: occurrences.map((o) => ({
      dueDate: o.dueDate,
      skipped: o.skipped,
      planActive: true,
      woStatus: o.workOrder?.status ?? null,
    })),
    maintenanceContractsActive: activeContracts,
    today,
  });
}
