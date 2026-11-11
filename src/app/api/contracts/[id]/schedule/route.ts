import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import type { ScheduleDivisionDTO, ScheduleStateDTO } from "@/lib/schedule-types";

type P = { params: Promise<{ id: string }> };

/**
 * GET /api/contracts/[id]/schedule — حالة البرنامج الزمني للعقد (docs/schedule-import-design.md §4).
 * أحدث دفعة استيراد هي الحيّة (Baseline القديم محفوظ) + نوافذ الأقسام المشتقة من أنشطة
 * work الحية مقابل قيم بنود BOQ — كله مشتق لحظة الطلب (لا مخزن — G9).
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const latest = await db.scheduleImport.findFirst({
    where: { contractId },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    const empty: ScheduleStateDTO = { latest: null, divisions: [], kindCounts: {} };
    return ok(empty);
  }

  // أنشطة الدفعة الحية — work بلا bands هي أصحاب النوافذ الزمنية
  const activities = await db.scheduleActivity.findMany({
    where: { importId: latest.id },
    select: {
      kind: true, isSummary: true, divisionCode: true,
      earlyStart: true, earlyFinish: true, groupName: true,
    },
  });

  const kindCounts: Record<string, number> = {};
  for (const a of activities) {
    if (a.isSummary) continue;
    kindCounts[a.kind] = (kindCounts[a.kind] ?? 0) + 1;
  }

  const windowByDivision = new Map<string, { start: string; finish: string; count: number; bandName: string }>();
  for (const a of activities) {
    if (a.isSummary || a.kind !== "work" || !a.earlyStart || !a.earlyFinish) continue;
    const w = windowByDivision.get(a.divisionCode);
    if (!w) {
      windowByDivision.set(a.divisionCode, { start: a.earlyStart, finish: a.earlyFinish, count: 1, bandName: a.groupName });
    } else {
      if (a.earlyStart < w.start) w.start = a.earlyStart;
      if (a.earlyFinish > w.finish) w.finish = a.earlyFinish;
      w.count += 1;
    }
  }

  const boqGroups = await db.boqItem.groupBy({
    by: ["divisionCode", "divisionName"],
    where: { contractId, deleted: false },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const boqByDivision = new Map(boqGroups.map((g) => [g.divisionCode, g]));

  const divisions: ScheduleDivisionDTO[] = [...windowByDivision.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }))
    .map(([code, w]) => {
      const g = boqByDivision.get(code);
      return {
        code,
        name: g?.divisionName || w.bandName || "—",
        activityCount: w.count,
        start: w.start,
        finish: w.finish,
        boqItems: g?._count._all ?? 0,
        boqTotal: Number(g?._sum.amount ?? 0),
      };
    });

  let warnings: string[] = [];
  try {
    const parsed = JSON.parse(latest.warnings) as string[];
    if (Array.isArray(parsed)) warnings = parsed.map((w) => (typeof w === "string" ? w : w?.message ?? "")).filter(Boolean);
  } catch {
    warnings = [];
  }

  const state: ScheduleStateDTO = {
    latest: {
      id: latest.id,
      fileName: latest.fileName,
      revision: latest.revision,
      dataDate: latest.dataDate,
      projectStart: latest.projectStart,
      projectFinish: latest.projectFinish,
      activityCount: latest.activityCount,
      workCount: latest.workCount,
      warnings,
      createdAt: latest.createdAt.toISOString(),
    },
    divisions,
    kindCounts,
  };
  return ok(state);
}
