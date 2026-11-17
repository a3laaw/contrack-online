import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { nextNumberByKey } from "@/lib/contrack-server";
import {
  CONSULTING_PROJECT_ACTIVE,
  CONSULTING_PROJECT_STATUSES,
  CONSULTING_SERVICE_TYPES,
} from "@/lib/consulting-constants";

/**
 * المشاريع الاستشارية المستقلة (docs/consulting-projects-design.md) — قرار المالك 2026-11-16:
 * GET: القائمة مع العميل/العقد الاختياري وعدادات الارتباطات — فلاتر status/customerId/q
 * POST: إنشاء مشروع — الترقيم الذري CPR عبر nextNumberByKey داخل المعاملة (نمط QUO/CON)
 * الحرس: screen_consulting ⇐ moduleGuard("consulting") — نمط الوحدة حرفيًا
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const status = (sp.get("status") || "").trim();
  const customerId = Number(sp.get("customerId")) || 0;
  const q = (sp.get("q") || "").trim();

  const rows = await db.consultingProject.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
    },
    orderBy: { id: "desc" },
    include: {
      customer: { select: { name: true } },
      contract: { select: { contractNumber: true, contractName: true } },
      _count: { select: { assignments: true, timesheets: true, revisions: true } },
    },
  });

  const needle = q.toLowerCase();
  const filtered = needle
    ? rows.filter(
        (p) =>
          `${p.projectNumber} ${p.name} ${p.serviceType} ${p.customer?.name || ""}`
            .toLowerCase()
            .includes(needle),
      )
    : rows;

  return ok({
    projects: filtered.map((p) => ({
      id: p.id,
      projectNumber: p.projectNumber,
      name: p.name,
      serviceType: p.serviceType,
      fee: Number(p.fee),
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      customerId: p.customerId,
      customerName: p.customer?.name || "",
      contractId: p.contractId,
      contractNumber: p.contract?.contractNumber || "",
      contractName: p.contract?.contractName || "",
      assignmentsCount: p._count.assignments,
      timesheetsCount: p._count.timesheets,
      revisionsCount: p._count.revisions,
      notes: p.notes,
      createdAt: p.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) return jsonError("اسم المشروع الاستشاري مطلوب");
  if (name.length > 200) return jsonError("اسم المشروع طويل — 200 حرف كحد أقصى");

  const serviceType = String(body.serviceType ?? "").trim();
  if (!(CONSULTING_SERVICE_TYPES as readonly string[]).includes(serviceType))
    return jsonError("نوع الخدمة الاستشارية غير معروف");

  const status = String(body.status || CONSULTING_PROJECT_ACTIVE);
  if (!(CONSULTING_PROJECT_STATUSES as readonly string[]).includes(status))
    return jsonError("حالة المشروع غير معروفة");

  const feeRaw = Number(body.fee);
  const fee = Number.isFinite(feeRaw) && feeRaw > 0 ? feeRaw : 0;
  if (fee > 999_999_999) return jsonError("الأتعاب تتجاوز الحد المسموح");

  const startDate = body.startDate ? parseDay(body.startDate) : "";
  if (body.startDate && !startDate) return jsonError("تاريخ البداية غير صالح");
  const endDate = body.endDate ? parseDay(body.endDate) : "";
  if (body.endDate && !endDate) return jsonError("تاريخ النهاية غير صالح");
  if (startDate && endDate && endDate < startDate) return jsonError("تاريخ النهاية قبل البداية");

  const customerId = Number(body.customerId) || 0;
  const contractId = Number(body.contractId) || 0;
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) return jsonError("العميل غير موجود", 404);
  }
  if (contractId) {
    const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true } });
    if (!contract) return jsonError("العقد غير موجود", 404);
  }

  const created = await db.$transaction(async (tx) => {
    const projectNumber = await nextNumberByKey("consulting_project:number", "CPR", 4, tx);
    return tx.consultingProject.create({
      data: {
        projectNumber,
        name,
        serviceType,
        fee,
        status,
        startDate,
        endDate,
        customerId: customerId || null,
        contractId: contractId || null,
        notes: String(body.notes ?? "").trim(),
        createdBy: guard.user.username,
      },
    });
  });

  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "consulting_project",
    entityId: created.id,
    entityName: `${created.projectNumber} — ${created.name}`,
    newStatus: created.status,
  });

  return ok({ project: created }, 201);
}
