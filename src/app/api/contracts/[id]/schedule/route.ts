import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { activityFloat } from "@/lib/schedule-activities-core";
import type { ScheduleActivityDTO, ScheduleDivisionDTO, ScheduleStateDTO } from "@/lib/schedule-types";

type P = { params: Promise<{ id: string }> };

/**
 * GET /api/contracts/[id]/schedule — حالة البرنامج الزمني للعقد (docs/schedule-import-design.md §4).
 * أحدث دفعة استيراد هي الحيّة (Baseline القديم محفوظ) + نوافذ الأقسام المشتقة من أنشطة
 * work الحية مقابل قيم بنود BOQ — كله مشتق لحظة الطلب (لا مخزن — G9).
 * ب3 §13.2: يزيد activities (غير الملخصة) بfloat المشتق والبند المربوط — الشجرة
 * والتوزيع الشهري يشتقان بالعميل من الصفوف.
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
    const empty: ScheduleStateDTO = { latest: null, divisions: [], kindCounts: {}, activities: [] };
    return ok(empty);
  }

  // أنشطة الدفعة الحية — غير الملخصة حصرًا للعرض (الملخصات bands محفوظة في groupName)
  const activityRows = await db.scheduleActivity.findMany({
    where: { importId: latest.id, isSummary: false },
    select: {
      id: true, activityCode: true, name: true, kind: true, family: true,
      durationDays: true, earlyStart: true, earlyFinish: true,
      lateStart: true, lateFinish: true, groupName: true,
      divisionCode: true, boqItemId: true, sortOrder: true,
      boqItem: { select: { itemNo: true, description: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  const kindCounts: Record<string, number> = {};
  for (const a of activityRows) {
    kindCounts[a.kind] = (kindCounts[a.kind] ?? 0) + 1;
  }

  const windowByDivision = new Map<string, { start: string; finish: string; count: number; bandName: string }>();
  for (const a of activityRows) {
    if (a.kind !== "work" || !a.earlyStart || !a.earlyFinish) continue;
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

  const activities: ScheduleActivityDTO[] = activityRows.map((a) => ({
    id: a.id,
    activityCode: a.activityCode,
    name: a.name,
    kind: a.kind,
    family: a.family,
    durationDays: a.durationDays,
    earlyStart: a.earlyStart,
    earlyFinish: a.earlyFinish,
    lateStart: a.lateStart,
    lateFinish: a.lateFinish,
    float: activityFloat(a.earlyFinish, a.lateFinish),
    groupName: a.groupName,
    divisionCode: a.divisionCode,
    boqItemId: a.boqItemId,
    linkedItemNo: a.boqItem?.itemNo || "",
    linkedItemDescription: a.boqItem?.description || "",
    sortOrder: a.sortOrder,
  }));

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
    activities,
  };
  return ok(state);
}
