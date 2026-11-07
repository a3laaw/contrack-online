import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { ASSIGNMENT_STATUSES } from "@/lib/consulting-constants";

/** GET: الإسنادات مع المهندس والعقد والعميل — فلاتر اختيارية engineerId/contractId/status */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const engineerId = Number(sp.get("engineerId")) || 0;
  const contractId = Number(sp.get("contractId")) || 0;
  const status = sp.get("status") || "";

  const rows = await db.engineerAssignment.findMany({
    where: {
      ...(engineerId ? { engineerId } : {}),
      ...(contractId ? { contractId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { id: "desc" }],
    include: {
      engineer: { select: { name: true, specialty: true, status: true } },
      contract: {
        select: {
          contractNumber: true,
          contractName: true,
          status: true,
          customer: { select: { name: true } },
        },
      },
    },
  });

  return ok({
    assignments: rows.map((a) => ({
      id: a.id,
      engineerId: a.engineerId,
      engineerName: a.engineer.name,
      engineerSpecialty: a.engineer.specialty,
      contractId: a.contractId,
      contractNumber: a.contract.contractNumber,
      contractName: a.contract.contractName,
      contractStatus: a.contract.status,
      customerName: a.contract.customer?.name || "",
      role: a.role,
      allocationPct: Number(a.allocationPct),
      startDate: a.startDate,
      endDate: a.endDate,
      status: a.status,
      notes: a.notes,
      createdAt: a.createdAt,
    })),
  });
}

/** POST: إسناد مهندس إلى عقد — المهندس والعقد إلزاميان (نقطة الربط HR↔العقود) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const engineerId = Number(body.engineerId) || 0;
  const contractId = Number(body.contractId) || 0;
  if (!engineerId) return jsonError("اختيار المهندس إلزامي");
  if (!contractId) return jsonError("اختيار العقد/المشروع إلزامي");

  const engineer = await db.engineer.findUnique({ where: { id: engineerId }, select: { id: true, name: true } });
  if (!engineer) return jsonError("المهندس غير موجود", 404);
  const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true, contractNumber: true } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const allocationRaw = Number(body.allocationPct);
  const allocationPct = Number.isFinite(allocationRaw) && allocationRaw > 0 ? allocationRaw : 0;
  if (allocationPct > 100) return jsonError("نسبة الإخصاص لا تتجاوز 100%");

  const startDate = body.startDate ? parseDay(body.startDate) : "";
  if (body.startDate && !startDate) return jsonError("تاريخ بداية الإسناد غير صالح");
  const endDate = body.endDate ? parseDay(body.endDate) : "";
  if (body.endDate && !endDate) return jsonError("تاريخ نهاية الإسناد غير صالح");
  if (startDate && endDate && endDate < startDate) return jsonError("نهاية الإسناد قبل بدايته");

  const status = String(body.status || "سارية");
  if (!(ASSIGNMENT_STATUSES as readonly string[]).includes(status)) return jsonError("حالة الإسناد غير معروفة");

  const created = await db.engineerAssignment.create({
    data: {
      engineerId,
      contractId,
      role: String(body.role || "").trim(),
      allocationPct,
      startDate,
      endDate,
      status,
      notes: String(body.notes || "").trim(),
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "إسناد",
    entityType: "engineer_assignment",
    entityId: created.id,
    entityName: `${engineer.name} ← ${contract.contractNumber}`,
    newStatus: status,
  });
  return ok({ assignment: created }, 201);
}
