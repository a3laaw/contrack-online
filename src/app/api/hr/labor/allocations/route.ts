import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/hr-constants";
import { effectiveMonthlyRate, unallocatedOf } from "@/lib/hr-labor-core";
import { writeBatchAllocations } from "@/lib/hr-server";

/** GET ?batchId= — عرض توزيع دفعة: الأسطر + لكل موظف التعرفة الأساس وغير الموزع + المجاميع */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const batchId = Number(req.nextUrl.searchParams.get("batchId"));
  if (!Number.isFinite(batchId)) return jsonError("معرف الدفعة غير صالح");

  const batch = await db.payrollBatch.findUnique({
    where: { id: batchId },
    select: { id: true, month: true, status: true, batchNo: true, records: { select: { employeeId: true, snapName: true } } },
  });
  if (!batch) return jsonError("الدفعة غير موجودة", 404);

  const rows = await db.laborAllocation.findMany({
    where: { batchId },
    orderBy: [{ employeeId: "asc" }, { id: "asc" }],
    include: {
      contract: { select: { contractNumber: true, contractName: true, description: true } },
      employee: { select: { name: true, jobNumber: true, salary: true, monthlyCostRate: true } },
    },
  });

  // أساس التكلفة لكل موظف: اللقطة من أسطره إن وجدت وإلا التعرفة الحالية (اتساق الحساب داخليًا)
  const rateByEmployee = new Map<number, number>();
  for (const r of rows) {
    const rate = Number(r.snapMonthlyRate) || 0;
    rateByEmployee.set(r.employeeId, Math.max(rateByEmployee.get(r.employeeId) ?? 0, rate));
  }
  const amountsByEmployee = new Map<number, number[]>();
  for (const r of rows) {
    const list = amountsByEmployee.get(r.employeeId) ?? [];
    list.push(Number(r.amount) || 0);
    amountsByEmployee.set(r.employeeId, list);
  }
  // تعرفة الموظفين بلا أسطر من ملفهم الحالي — استعلام واحد
  const noRowsIds = batch.records.map((r) => r.employeeId).filter((id) => !amountsByEmployee.has(id));
  if (noRowsIds.length > 0) {
    const emps = await db.employee.findMany({ where: { id: { in: noRowsIds } }, select: { id: true, salary: true, monthlyCostRate: true } });
    for (const e of emps) rateByEmployee.set(e.id, effectiveMonthlyRate({ salary: Number(e.salary), monthlyCostRate: Number(e.monthlyCostRate) }));
  }

  const employeesSummary = batch.records.map((rec) => {
    const rate = rateByEmployee.get(rec.employeeId) ?? 0;
    const amounts = amountsByEmployee.get(rec.employeeId) ?? [];
    return {
      employeeId: rec.employeeId,
      name: rec.snapName,
      rate: r3(rate),
      allocated: r3(amounts.reduce((s, a) => s + a, 0)),
      unallocated: unallocatedOf(rate, amounts),
    };
  });

  const allocatedTotal = r3(employeesSummary.reduce((s, e) => s + e.allocated, 0));
  const fullCostTotal = r3(employeesSummary.reduce((s, e) => s + e.rate, 0));

  return ok({
    batch: { id: batch.id, month: batch.month, status: batch.status, batchNo: batch.batchNo },
    editable: batch.status === "draft" || batch.status === "approved", // د5 — التجميد عند الدفع
    rows: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employee.name,
      jobNumber: r.employee.jobNumber,
      contractId: r.contractId,
      contractNumber: r.contract.contractNumber,
      contractName: r.contract.description || r.contract.contractName || r.contract.contractNumber,
      sharePercent: Number(r.sharePercent),
      snapMonthlyRate: Number(r.snapMonthlyRate),
      amount: Number(r.amount),
      note: r.note,
    })),
    employeesSummary,
    totals: { allocatedTotal, fullCostTotal, unallocatedTotal: r3(Math.max(0, fullCostTotal - allocatedTotal)) },
  });
}

/** POST: كتابة توزيع دفعة — استبدال كامل للأسطر (قائمة فارغة = مسح) — لقطات جديدة لحظة الحفظ */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const batchId = Number(body.batchId);
  if (!Number.isFinite(batchId)) return jsonError("معرف الدفعة غير صالح");
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  const rows = rawRows.map((x) => {
    const r = x as Record<string, unknown>;
    return {
      employeeId: Number(r.employeeId),
      contractId: Number(r.contractId),
      sharePercent: Number(r.sharePercent),
      note: String(r.note ?? "").trim(),
    };
  });
  if (rows.some((r) => !Number.isFinite(r.employeeId) || !Number.isFinite(r.contractId))) {
    return jsonError("سطر توزيع ناقص المعرفات");
  }

  try {
    const res = await db.$transaction(async (tx) => writeBatchAllocations(tx, batchId, rows, guard.user.username));
    await audit(db, {
      username: guard.user.username,
      action: rows.length > 0 ? "توزيع تكلفة" : "مسح توزيع",
      entityType: "labor_allocation",
      entityId: batchId,
      entityName: `دفعة #${batchId} — ${res.created} سطرًا`,
    });
    return ok(res);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر حفظ التوزيع", 400);
  }
}

/** DELETE ?id= — حذف سطر تخصيص واحد (دفعة قابلة للتحرير فقط) */
export async function DELETE(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return jsonError("معرف السطر غير صالح");
  const row = await db.laborAllocation.findUnique({
    where: { id },
    include: { batch: { select: { id: true, status: true } }, employee: { select: { name: true } } },
  });
  if (!row) return jsonError("سطر التوزيع غير موجود", 404);
  if (row.batch.status === "paid") return jsonError("الدفعة مدفوعة — التخصيص مجمّد للقراءة فقط (د5)");
  if (row.batch.status === "cancelled") return jsonError("الدفعة ملغاة");

  await db.$transaction(async (tx) => {
    await tx.laborAllocation.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف سطر توزيع",
      entityType: "labor_allocation",
      entityId: id,
      entityName: `${row.employee.name} — دفعة #${row.batchId}`,
    });
  });
  return ok({ deleted: true });
}
