import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";

/**
 * G4 — سجل نقل المراحل الكامل بترقيم صفحات — GET ?type=contract&id=1&page=1&pageSize=20
 * لكل أنواع المعاملات (عقد/دفعة/باطن/عميل) — المنفِّذ والملاحظة وتاريخا البداية/الإغلاق.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const type = (sp.get("type") || "contract").trim();
  const id = Number(sp.get("id"));
  if (!id || !Number.isFinite(id)) return jsonError("معرف غير صالح");
  const page = Math.max(1, Math.trunc(Number(sp.get("page")) || 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(Number(sp.get("pageSize")) || 20)));

  const where = { transactionType: type, transactionId: id };
  const [total, rows] = await Promise.all([
    db.stageMove.count({ where }),
    db.stageMove.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        movedBy: { select: { fullName: true, username: true } },
        // اسم المرحلة يُحل من النموذج حسب النوع — للعقود من contractStage
      },
    }),
  ]);

  // حل اسم المرحلة للعقود (دفعة واحدة لصفحات صغيرة)
  const stageIds = [...new Set(rows.map((r) => r.stageId).filter((x): x is number => x != null))];
  const stageNames = new Map<number, string>();
  if (type === "contract" && stageIds.length) {
    const st = await db.contractStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, name: true } });
    for (const s of st) stageNames.set(s.id, s.name);
  }

  return ok({
    total,
    page,
    pageSize,
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      stageName: r.stageId != null ? stageNames.get(r.stageId) || `#${r.stageId}` : "",
      movedByName: r.movedBy?.fullName || r.movedBy?.username || "—",
      note: r.note,
      startDate: r.startDate,
      endDate: r.endDate,
      movedAt: r.movedAt.toISOString(),
    })),
  });
}

export const dynamic = "force-dynamic";
