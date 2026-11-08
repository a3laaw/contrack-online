import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { r3 } from "@/lib/hr-constants";
import { assertAssignmentShareCap } from "@/lib/hr-server";

type P = { params: Promise<{ id: string }> };

/** PATCH: تعديل تكليف — الدور/النسبة/الفترة/الحالة (سارية→منتهية بقرار موثق) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const a = await db.employeeAssignment.findUnique({
    where: { id },
    include: { employee: { select: { name: true } }, contract: { select: { contractNumber: true } } },
  });
  if (!a) return jsonError("التكليف غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { role?: string; allocationPct?: number; startDate?: string; endDate?: string; status?: string; notes?: string } = {};

  if (body.role !== undefined) data.role = String(body.role || "").trim();
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim();

  let newPct = Number(a.allocationPct);
  if (body.allocationPct !== undefined) {
    const pct = Number(body.allocationPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return jsonError("نسبة التكليف يجب أن تكون بين 0 و100 حصريًا");
    newPct = pct;
    data.allocationPct = r3(pct);
  }

  if (body.startDate !== undefined || body.endDate !== undefined) {
    const startDate = body.startDate !== undefined ? (body.startDate ? parseDay(body.startDate) : "") : a.startDate;
    const endDate = body.endDate !== undefined ? (body.endDate ? parseDay(body.endDate) : "") : a.endDate;
    if (body.startDate !== undefined && body.startDate && !startDate) return jsonError("تاريخ بداية التكليف غير صالح");
    if (body.endDate !== undefined && body.endDate && !endDate) return jsonError("تاريخ نهاية التكليف غير صالح");
    if (startDate && endDate && endDate < startDate) return jsonError("نهاية التكليف قبل بدايته");
    data.startDate = startDate;
    data.endDate = endDate;
  }

  let newStatus = a.status;
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!(status === "سارية" || status === "منتهية")) return jsonError("حالة التكليف: سارية أو منتهية");
    if (a.status === "منتهية" && status === "سارية") return jsonError("لا يمكن إعادة تنشيط تكليف منتهٍ — أنشئ تكليفًا جديدًا");
    newStatus = status;
    data.status = status;
  }

  // فحص السقف فقط عند زيادة النسبة على تكليف ساري (المنتهي خارج المجموع — د7)
  if (a.status === "سارية" && newStatus === "سارية" && newPct > Number(a.allocationPct)) {
    try {
      await assertAssignmentShareCap(db, a.employeeId, id, newPct);
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "تجاوز سقف التكليفات", 400);
    }
  }

  const endDateForAudit = body.status === "منتهية" ? (data.endDate || new Date().toISOString().slice(0, 10)) : undefined;
  if (endDateForAudit && body.endDate === undefined && newStatus === "منتهية" && !a.endDate) {
    data.endDate = endDateForAudit; // إنهاء موثق — التاريخ اليوم إن لم يحدده المستخدم
  }

  await db.employeeAssignment.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: newStatus !== a.status ? (newStatus === "منتهية" ? "إنهاء تكليف" : "تعديل") : "تعديل",
    entityType: "employee_assignment",
    entityId: id,
    entityName: `${a.employee.name} → ${a.contract.contractNumber}`,
    oldStatus: `${a.status} ${Number(a.allocationPct)}%`,
    newStatus: `${newStatus} ${newPct}%`,
    reason: String(body.reason || "").trim(),
  });
  return ok({ updated: true });
}

/** DELETE: حذف تكليف — حر (بلا ربط مالي) مع audit بسبب */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const a = await db.employeeAssignment.findUnique({
    where: { id },
    include: { employee: { select: { name: true } }, contract: { select: { contractNumber: true } } },
  });
  if (!a) return jsonError("التكليف غير موجود", 404);

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف تكليف";
  await db.$transaction(async (tx) => {
    await tx.employeeAssignment.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "employee_assignment",
      entityId: id,
      entityName: `${a.employee.name} → ${a.contract.contractNumber} (${Number(a.allocationPct)}%)`,
      reason,
    });
  });
  return ok({ deleted: true });
}
