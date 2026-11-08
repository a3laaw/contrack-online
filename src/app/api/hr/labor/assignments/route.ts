import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { r3 } from "@/lib/hr-constants";
import { assertAssignmentShareCap } from "@/lib/hr-server";

const ASSIGNMENT_STATUSES = ["سارية", "منتهية"] as const;

function validOptionalPair(startRaw: unknown, endRaw: unknown): { startDate: string; endDate: string } | string {
  const startDate = startRaw ? parseDay(startRaw) : "";
  const endDate = endRaw ? parseDay(endRaw) : "";
  if (startRaw && !startDate) return "تاريخ بداية التكليف غير صالح";
  if (endRaw && !endDate) return "تاريخ نهاية التكليف غير صالح";
  if (startDate && endDate && endDate < startDate) return "نهاية التكليف قبل بدايته";
  return { startDate, endDate };
}

/** GET: التكليفات — فلاتر employeeId / contractId / status */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const employeeId = Number(req.nextUrl.searchParams.get("employeeId")) || 0;
  const contractId = Number(req.nextUrl.searchParams.get("contractId")) || 0;
  const status = req.nextUrl.searchParams.get("status") || "";

  const where: Record<string, unknown> = {};
  if (employeeId) where.employeeId = employeeId;
  if (contractId) where.contractId = contractId;
  if (status) {
    if (!(ASSIGNMENT_STATUSES as readonly string[]).includes(status)) return jsonError("حالة تكليف غير معروفة");
    where.status = status;
  }

  const rows = await db.employeeAssignment.findMany({
    where,
    orderBy: [{ status: "desc" }, { id: "desc" }],
    take: 1000,
    include: {
      employee: { select: { name: true, jobNumber: true, jobTitle: true } },
      contract: { select: { contractNumber: true, contractName: true, description: true } },
    },
  });

  return ok({
    assignments: rows.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      employeeName: a.employee.name,
      jobNumber: a.employee.jobNumber,
      jobTitle: a.employee.jobTitle,
      contractId: a.contractId,
      contractNumber: a.contract.contractNumber,
      contractName: a.contract.description || a.contract.contractName || a.contract.contractNumber,
      role: a.role,
      allocationPct: Number(a.allocationPct),
      startDate: a.startDate,
      endDate: a.endDate,
      status: a.status,
      notes: a.notes,
    })),
  });
}

/** POST: تكليف موظف بعقد — فحص سقف النسب السارية ≤100% قبل الكتابة (د7) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const employeeId = Number(body.employeeId);
  const contractId = Number(body.contractId);
  if (!Number.isFinite(employeeId)) return jsonError("اختر الموظف أولًا");
  if (!Number.isFinite(contractId)) return jsonError("اختر العقد أولًا");

  const [employee, contract] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, active: true } }),
    db.contract.findUnique({ where: { id: contractId }, select: { id: true, contractNumber: true } }),
  ]);
  if (!employee) return jsonError("الموظف غير موجود", 404);
  if (!contract) return jsonError("العقد غير موجود", 404);

  const pct = Number(body.allocationPct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return jsonError("نسبة التكليف يجب أن تكون بين 0 و100 حصريًا");

  const dates = validOptionalPair(body.startDate, body.endDate);
  if (typeof dates === "string") return jsonError(dates);

  try {
    await assertAssignmentShareCap(db, employeeId, 0, pct);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تجاوز سقف التكليفات", 400);
  }

  const created = await db.employeeAssignment.create({
    data: {
      employeeId,
      contractId,
      role: String(body.role || "").trim(),
      allocationPct: r3(pct),
      startDate: dates.startDate,
      endDate: dates.endDate,
      notes: String(body.notes || "").trim(),
      status: "سارية",
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "تكليف",
    entityType: "employee_assignment",
    entityId: created.id,
    entityName: `${employee.name} → ${contract.contractNumber} (${r3(pct)}%)`,
  });
  return ok({ assignment: created }, 201);
}
