import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adminGuard, ok, jsonError } from "@/lib/api-utils";

/** سجل التدقيق — للمدير: فلاتر entityType/username/q/from/to مع ترقيم */
export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const entityType = (sp.get("entityType") || "").trim();
  const username = (sp.get("username") || "").trim();
  const q = (sp.get("q") || "").trim();
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  const where: Prisma.AuditLogWhereInput = {};

  if (entityType) where.entityType = entityType;
  if (username) where.username = { contains: username };

  if (q) {
    where.OR = [
      { action: { contains: q } },
      { entityName: { contains: q } },
      { reason: { contains: q } },
      { oldStatus: { contains: q } },
      { newStatus: { contains: q } },
    ];
  }

  // فترة زمنية: من بداية يوم from حتى نهاية يوم to
  const tsRange: Prisma.DateTimeFilter = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const d = new Date(`${from}T00:00:00`);
    if (!isNaN(d.getTime())) tsRange.gte = d;
    else return jsonError("تاريخ «من» غير صحيح — الصيغة YYYY-MM-DD");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const d = new Date(`${to}T23:59:59.999`);
    if (!isNaN(d.getTime())) tsRange.lte = d;
    else return jsonError("تاريخ «إلى» غير صحيح — الصيغة YYYY-MM-DD");
  }
  if (tsRange.gte || tsRange.lte) where.ts = tsRange;

  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { id: "desc" },
      take: limit,
      skip: offset,
    }),
    db.auditLog.count({ where }),
  ]);

  return ok({ items, total });
}
