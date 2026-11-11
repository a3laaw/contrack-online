import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { scanScheduleText, scanScheduleExcel, type ScheduleParsedActivity } from "@/lib/import/schedule-parse";
import { extractPdfText } from "@/lib/import/schedule-pdf";
import type { ScheduleDivisionDTO, ScheduleMetaDTO, ScheduleWarningDTO } from "@/lib/schedule-types";

type P = { params: Promise<{ id: string }> };

/** سقف الملف — PDF مرتفع الصفحات (24 صفحة ≈ 1.5MB) والملفات المستقبلية أوسع. */
const MAX_BYTES = 30 * 1024 * 1024;

/**
 * POST /api/contracts/[id]/schedule/import — استيراد البرنامج الزمني CPM (docs/schedule-import-design.md §3/§6 ب1).
 * FormData: file (إلزامي — PDF أو xlsx) + mode=preview|run (افتراضي preview).
 *
 * preview: التحليل فقط بلا كتابة — ميتا الجدول (Project Start/Finish · Data Date · Revision)
 *          + الأقسام بنوافذها الزمنية المشتقة من أنشطة work مقابل قيم بنود BOQ + التحذيرات.
 * run:     دفعة استيراد جديدة (إلحاق لا استبدال — Baseline محفوظ: أحدث دفعة = الحي) + أسطر
 *          الأنشطة + تعبئة BoqItem.plannedStart/plannedFinish من نافذة قسم كل بند.
 * الحرس: action_edit_contract (مطابق لمسار استيراد BOQ).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const mode = String(form?.get("mode") || "preview") === "run" ? "run" : "preview";
  if (!file || !(file instanceof File)) return jsonError("اختر ملف البرنامج الزمني أولاً", 400);
  if (file.size === 0) return jsonError("الملف فارغ", 400);
  if (file.size > MAX_BYTES) return jsonError("حجم الملف يتجاوز 30MB", 413);

  // التحليل — PDF نصي أو Excel من Primavera (نفس قناتي v1 في الوثيقة)
  const isPdf = /\.pdf$/i.test(file.name);
  const isXlsx = /\.xlsx$/i.test(file.name);
  if (!isPdf && !isXlsx) return jsonError("الصيغتان المدعومتان: PDF أو xlsx", 400);

  let activities: ScheduleParsedActivity[];
  let meta: ScheduleMetaDTO;
  let warnings: ScheduleWarningDTO[];
  let counts: { total: number; work: number; summary: number; withDates: number };
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = isPdf
      ? scanScheduleText((await extractPdfText(buffer)).text)
      : await scanScheduleExcel(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    activities = parsed.activities;
    meta = {
      projectStart: parsed.meta.projectStart,
      projectFinish: parsed.meta.projectFinish,
      dataDate: parsed.meta.dataDate,
      revision: parsed.meta.revision,
      totalPages: parsed.meta.totalPages,
    };
    warnings = parsed.warnings.map((w) => ({ line: w.line, message: w.message }));
    counts = parsed.counts;
  } catch {
    return jsonError("تعذر قراءة الملف — تأكد أنه ملف برنامج زمني سليم (PDF نصي أو xlsx من Primavera)", 400);
  }

  const workActivities = activities.filter((a) => !a.isSummary && a.kind === "work");
  if (activities.filter((a) => !a.isSummary).length === 0 || workActivities.length === 0) {
    return jsonError("لم يُعثر على أنشطة برنامج زمني — تأكد أن الملف CPM Detailed Schedule بأعمدة Early/Late Start/Finish", 400);
  }

  // نوافذ الأقسام المشتقة من أنشطة work (مشتق لحظة العرض — لا مخزن — G9)
  const windowByDivision = new Map<string, { start: string; finish: string; count: number; bandName: string }>();
  for (const a of workActivities) {
    if (!a.earlyStart || !a.earlyFinish) continue;
    const w = windowByDivision.get(a.divisionCode);
    if (!w) {
      windowByDivision.set(a.divisionCode, { start: a.earlyStart, finish: a.earlyFinish, count: 1, bandName: a.groupName });
    } else {
      if (a.earlyStart < w.start) w.start = a.earlyStart;
      if (a.earlyFinish > w.finish) w.finish = a.earlyFinish;
      w.count += 1;
    }
  }

  // قيم BOQ الحقيقية لكل قسم (اسم القسم من بيانات العقد نفسها)
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

  const latest = await db.scheduleImport.findFirst({
    where: { contractId },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, revision: true, createdAt: true },
  });

  if (mode === "run") {
    const created = await db.scheduleImport.create({
      data: {
        contractId,
        fileName: file.name,
        revision: meta.revision,
        dataDate: meta.dataDate,
        projectStart: meta.projectStart,
        projectFinish: meta.projectFinish,
        activityCount: activities.filter((a) => !a.isSummary).length,
        workCount: workActivities.length,
        warnings: JSON.stringify(warnings),
        importedBy: guard.user?.username || "",
        activities: {
          create: activities.map((a, i) => ({
            contractId,
            activityCode: a.activityCode,
            name: a.name.slice(0, 500),
            kind: a.kind,
            family: a.family,
            durationDays: a.durationDays,
            earlyStart: a.earlyStart,
            earlyFinish: a.earlyFinish,
            lateStart: a.lateStart,
            lateFinish: a.lateFinish,
            isSummary: a.isSummary,
            groupName: a.groupName.slice(0, 200),
            divisionCode: a.divisionCode,
            sortOrder: i,
          })),
        },
      },
      select: { id: true },
    });

    // تعبئة نافذة كل بند من نافذة قسمه — عرض لا مصدر (الأنشطة هي المصدر)
    let filledDivisions = 0;
    for (const [code, w] of windowByDivision) {
      const res = await db.boqItem.updateMany({
        where: { contractId, deleted: false, divisionCode: code },
        data: { plannedStart: w.start, plannedFinish: w.finish },
      });
      if (res.count > 0) filledDivisions += 1;
    }

    return ok({
      importId: created.id,
      created: activities.filter((a) => !a.isSummary).length,
      work: workActivities.length,
      summary: activities.filter((a) => a.isSummary).length,
      filledDivisions,
      meta,
      warnings,
    });
  }

  return ok({
    meta,
    counts,
    warnings,
    divisions,
    latest,
  });
}
