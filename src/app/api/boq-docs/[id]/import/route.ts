// POST /api/boq-docs/[id]/import — استيراد جدول كميات (BOQ) إلى وثيقة مستقلة.
// نفس المحلل المعاير على الملف الحقيقي (docs/boq-import-design.md — POMI الكويتي):
// FormData: file (.xlsx) + mode=preview|run.
// preview: التحليل فقط بلا كتابة — الأقسام مع عينة بنود + التحذيرات + عدد البنود القائمة.
// run:     إعادة التحليل ثم createMany بترتيب متسلسل — إلحاق لا استبدال (المرحلة أ).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { parseBoqWorkbook } from "@/lib/import/boq-parse";
import { r3 } from "@/lib/contrack-core";

type P = { params: Promise<{ id: string }> };

/** سقف حجم ملف BOQ (15MB — ملفات BOQ الحقيقية متعددة الصفحات تصل 2-5MB). */
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const docId = Number(idStr);
  if (!Number.isFinite(docId)) return jsonError("معرف غير صالح");

  const doc = await db.boqDoc.findUnique({ where: { id: docId } });
  if (!doc) return jsonError("وثيقة BOQ غير موجودة", 404);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const mode = String(form?.get("mode") || "preview") === "run" ? "run" : "preview";
  if (!file || !(file instanceof File)) return jsonError("اختر ملف Excel (.xlsx) أولًا", 400);
  if (file.size === 0) return jsonError("الملف فارغ", 400);
  if (file.size > MAX_BYTES) return jsonError("حجم الملف يتجاوز 15MB", 413);
  if (!/\.xlsx$/i.test(file.name)) return jsonError("الصيغة المدعومة xlsx حصراً (ملفات Excel الحديثة)", 400);

  let parsed;
  try {
    parsed = await parseBoqWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch {
    return jsonError("تعذر قراءة الملف — تأكد أنه ملف Excel سليم بصيغة xlsx", 400);
  }
  if (parsed.divisions.length === 0 || parsed.divisions.every((d) => d.items.length === 0)) {
    return jsonError("لم يُعثر على بنود قابلة للاستيراد — تأكد أن الملف جدول كميات (BOQ) بأعمدة: بند/وصف/كمية/وحدة/سعر وحدة", 400);
  }

  const existingCount = await db.boqDocItem.count({ where: { docId } });
  const itemCount = parsed.divisions.reduce((s, d) => s + d.items.length, 0);

  if (mode === "run") {
    const max = await db.boqDocItem.aggregate({ where: { docId }, _max: { sortOrder: true } });
    let sort = (max._max.sortOrder ?? -1) + 1;
    const rows = parsed.divisions.flatMap((d) =>
      d.items.map((it) => ({
        docId,
        itemNo: it.itemNo,
        divisionCode: d.code,
        divisionName: d.name,
        description: it.description,
        qty: r3(it.qty),
        unit: it.unit,
        unitPrice: r3(it.unitPrice),
        amount: r3(it.amount), // مبلغ الملف الأصلي — مطابقة لصيغ الملف نفسه
        sortOrder: sort++,
      })),
    );
    await db.boqDocItem.createMany({ data: rows });
    return ok({
      created: rows.length,
      grandTotal: parsed.grandTotal,
      divisions: parsed.divisions.map((d) => ({ code: d.code, name: d.name, itemCount: d.items.length, total: d.total })),
      warnings: parsed.warnings,
      existingCount,
      meta: parsed.meta,
    });
  }

  // معاينة — عينة 8 بنود لكل قسم (القائمة الكاملة تُحسب من itemCount)
  return ok({
    divisions: parsed.divisions.map((d) => ({
      code: d.code,
      name: d.name,
      sheet: d.sheet,
      itemCount: d.items.length,
      total: d.total,
      items: d.items.slice(0, 8).map((it) => ({ ...it, qty: r3(it.qty), unitPrice: r3(it.unitPrice), amount: r3(it.amount) })),
    })),
    itemCount,
    grandTotal: parsed.grandTotal,
    warnings: parsed.warnings,
    existingCount,
    meta: parsed.meta,
  });
}
