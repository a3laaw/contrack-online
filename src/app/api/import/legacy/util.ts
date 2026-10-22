import "server-only";
/**
 * أدوات مشتركة لمسارات مستورد الملفات القديمة (SQLite/نص) — Task 86:
 * حارس المطور · تحقق تطابق شركة الجلسة مع الشركة المستهدفة · بناء الأوراق
 * الخام من الحمولة (ملف SQLite أو نص جدولي) · تعزيز أنواع العقود بالأنواع
 * القادمة من المصدر حتى لا يوقفها الفحص (تُنشأ فعلًا قبل التنفيذ).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { featureOn, jsonError } from "@/lib/api-utils";

import { buildImportDbContext } from "@/lib/import/db-context";
import type { ImportDbContext, RawSheet } from "@/lib/import/parse-core";
import { buildTextSheet } from "@/lib/import/legacy-shared";
import type { LegacyMapping } from "@/lib/import/legacy-shared";
import { buildLegacySheets, LEGACY_TYPE_FALLBACK } from "@/lib/import/legacy-core";
import type { LegacyReference } from "@/lib/import/legacy-core";
import { nameKey } from "@/lib/import/normalize";
import { IMPORT_LOCK_MESSAGE, acquireImportLock } from "@/lib/import/lock";

export interface LegacyUser {
  id: number;
  username: string;
  role: string;
  companyId: number;
  companyName?: string;
}

export async function developerGuard(req: NextRequest): Promise<{ user: LegacyUser } | { response: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) return { response: NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 }) };
  if (user.role !== "developer") {
    return { response: NextResponse.json({ error: "معالج الاستيراد للمطور فقط" }, { status: 403 }) };
  }
  return { user: user as LegacyUser };
}

/** ميزة الاستيراد + القفل */
export async function featureAndLock(): Promise<NextResponse | null> {
  if (!(await featureOn("import_old"))) {
    return jsonError("ميزة «استيراد البيانات القديمة» معطّلة", 403);
  }
  if (!acquireImportLock()) return jsonError(IMPORT_LOCK_MESSAGE, 429);
  return null;
}

/**
 * حارس الشركة المستهدفة: التنفيذ/الفحص يجري على شركة الجلسة — إن اختار
 * المطور شركة أخرى يُرفض الطلب برسالة التبديل (منع الاستيراد في شركة خاطئة).
 */
export async function companyMismatchGuard(
  user: LegacyUser,
  targetCompanyId: unknown
): Promise<NextResponse | null> {
  const target = Math.trunc(Number(targetCompanyId));
  if (!Number.isFinite(target) || target <= 0) return jsonError("حدّد الشركة المستهدفة للاستيراد.", 400);
  if (user.companyId === target) return null;
  const [sessionCompany, targetCompany] = await Promise.all([
    db.company.findUnique({ where: { id: user.companyId } }),
    db.company.findUnique({ where: { id: target } }),
  ]);
  return jsonError(
    `الجلسة الحالية في شركة «${sessionCompany?.name ?? user.companyId}» والاستيراد مطلوب في ` +
      `«${targetCompany?.name ?? target}» — بدّل إلى الشركة المستهدفة من مبدّل الشركات أعلى الشاشة ثم أعد المحاولة.`,
    409
  );
}

export interface LegacyPayload {
  mode: "sqlite" | "text";
  targetCompanyId: number;
  mapping?: LegacyMapping;
  text?: string;
  sheet?: string;
  /** مسار التنفيذ فقط: أسماء الأوراق المنفَّذة */
  selected?: string[];
}

export function parsePayload(form: FormData): LegacyPayload | { error: string } {
  const raw = form.get("payload");
  if (typeof raw !== "string" || !raw.trim()) return { error: "حمولة الطلب مفقودة." };
  try {
    const p = JSON.parse(raw) as LegacyPayload;
    if (p.mode !== "sqlite" && p.mode !== "text") return { error: "نمط الاستيراد غير معروف." };
    return p;
  } catch {
    return { error: "حمولة الطلب غير صالحة." };
  }
}

export interface BuiltSource {
  sheets: RawSheet[];
  notes: string[];
  reference: LegacyReference | null;
}

/** بناء الأوراق الخام من الحمولة: ملف SQLite (يُعاد إرساله كل مرة — بلا حالة خادم) أو نص ملصوق */
export async function buildSource(form: FormData, payload: LegacyPayload): Promise<BuiltSource | { error: string }> {
  if (payload.mode === "sqlite") {
    const file = form.get("file");
    if (!file || !(file instanceof File)) return { error: "أعد اختيار ملف SQLite أولًا." };
    if (file.size > 10 * 1024 * 1024) return { error: "حجم الملف يتجاوز الحد المسموح (10MB)." };
    if (!payload.mapping) return { error: "خريطة الجداول مفقودة — أعد الفحص." };
    try {
      const built = await buildLegacySheets(Buffer.from(await file.arrayBuffer()), payload.mapping);
      return { sheets: built.sheets, notes: built.notes, reference: built.reference };
    } catch {
      return { error: "تعذر قراءة الملف كقاعدة SQLite — تأكد أنه ملف قاعدة بيانات سليم." };
    }
  }
  // النص الملصوق — ورقة واحدة
  const text = String(payload.text ?? "");
  const sheet = String(payload.sheet ?? "");
  if (!text.trim()) return { error: "الصق النص الجدولي أولًا." };
  if (!sheet) return { error: "اختر الورقة المستهدفة للنص." };
  const res = buildTextSheet(text, sheet);
  if ("error" in res) return { error: res.error };
  return { sheets: [res.sheet], notes: [], reference: null };
}

/** تعزيز أنواع العقود المعروفة بأنواع المصدر (+ «بيانات قديمة») — تُنشأ فعلًا قبل التنفيذ */
export function augmentKnownTypes(ctx: ImportDbContext, built: BuiltSource): void {
  const names = new Set<string>([LEGACY_TYPE_FALLBACK]);
  if (built.reference) {
    for (const t of built.reference.types) {
      const n = (t.name || "").trim();
      if (n) names.add(n);
    }
  }
  // أنواع قادمة داخل أوراق العقود نفسها (نص ملصوق)
  for (const s of built.sheets) {
    if (s.name !== "العقود" || s.rows.length < 2) continue;
    for (let i = 1; i < s.rows.length; i++) {
      const v = String(s.rows[i]?.[7] ?? "").trim();
      if (v) names.add(v);
    }
  }
  for (const n of names) {
    if (!ctx.knownContractTypes[nameKey(n)]) ctx.knownContractTypes[nameKey(n)] = n;
  }
}

export async function buildContextWithTypes(
  built: BuiltSource,
  opts: { placeholderRefs?: boolean } = {}
): Promise<ImportDbContext> {
  const ctx = await buildImportDbContext();
  augmentKnownTypes(ctx, built);
  // في المعاينة فقط: محاكاة ما ستنجزه المزامنة — حسابات/مشاريع المصدر الناقصة
  // تأخذ معرّفًا مؤقتًا سالبًا حتى لا تظهر أخطاء زائفة (التنفيذ الفعلي يزامن
  // المرجعيات قبل بناء السياق فيأخذ المعرّفات الحقيقية).
  if (opts.placeholderRefs && built.reference) {
    built.reference.accounts.forEach((a, i) => {
      const id = -(i + 1);
      if (!ctx.expenseAccounts[nameKey(a.fullPath)]) ctx.expenseAccounts[nameKey(a.fullPath)] = id;
      if (!ctx.expenseAccounts[nameKey(a.name)]) ctx.expenseAccounts[nameKey(a.name)] = id;
    });
    built.reference.projects.forEach((p, i) => {
      if (!ctx.projects[nameKey(p)]) ctx.projects[nameKey(p)] = -(i + 1);
    });
  }
  return ctx;
}
