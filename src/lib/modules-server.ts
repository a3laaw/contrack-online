import "server-only";
/**
 * modules-server.ts — خدمات الموديولات الخادمية (خطة الأنشطة — المرحلة A):
 * • قراءة أكواد الموديولات الفعّالة لشركة (للدخول وme — تصفية الشل)
 * • بذر موديولات شركة جديدة + قسم افتراضي لكل موديول (idempotent)
 * • تفعيل/إيقاف موديول من المطور (الإيقاف = تجميد، البيانات لا تُحذف)
 * كل القراءات والكتابات عبر sysDb — حوكمة عبر الشركات لا بيانات تشغيلية.
 */
import { sysDb } from "@/lib/db";
import {
  CORE_MODULE_CODE,
  MODULE_CATALOG,
  moduleByCode,
  moduleSelectionLabel,
} from "./modules-catalog";

/** أكواد الموديولات الفعّالة لشركة — null = المطور/بلا سياق (الشل يعرض كل شيء) */
export async function enabledModuleCodes(
  companyId: number | null | undefined
): Promise<string[] | null> {
  if (companyId == null || companyId <= 0) return null;
  const rows = await sysDb.companyModule.findMany({
    where: { companyId, status: "active" },
    select: { code: true },
  });
  const codes = rows
    .map((r) => r.code)
    .filter((c) => moduleByCode(c)?.available && !moduleByCode(c)?.core);
  // عمود النظام مشمول دائمًا حتى بلا صفوف
  return [CORE_MODULE_CODE, ...codes];
}

/** ضمان قسم افتراضي لموديول شركة (idempotent) — «قسم <اسم النشاط>» */
export async function ensureModuleDivision(companyId: number, code: string): Promise<void> {
  const def = moduleByCode(code);
  if (!def || def.core) return; // الكور بلا قسم مستقل — المال العام
  const divCode = `div-${code}`;
  const existing = await sysDb.division.findUnique({
    where: { companyId_code: { companyId, code: divCode } },
    select: { id: true },
  });
  if (!existing) {
    await sysDb.division.create({
      data: { companyId, code: divCode, name: `قسم ${def.name}`, moduleCode: code },
    });
  }
}

/**
 * بذر موديولات شركة (عند الإنشاء اليدوي أو اعتماد طلب انضمام) — idempotent:
 * صف company_modules بحالة active لكل كود + قسم افتراضي لكل موديول.
 * الكور لا يُبذر له صف (مشمول بالبنية) — يُقبل في المدخل ويُتجاهل.
 */
export async function seedCompanyModules(
  companyId: number,
  codes: string[],
  by: string
): Promise<void> {
  const clean = codes.filter((c) => c !== CORE_MODULE_CODE && moduleByCode(c)?.available);
  for (const code of clean) {
    const existing = await sysDb.companyModule.findUnique({
      where: { companyId_code: { companyId, code } },
      select: { id: true },
    });
    if (!existing) {
      await sysDb.companyModule.create({
        data: { companyId, code, status: "active", enabledBy: by, notes: "بذر أولي" },
      });
    } else {
      await sysDb.companyModule.update({
        where: { id: existing.id },
        data: { status: "active" },
      });
    }
    await ensureModuleDivision(companyId, code);
  }
}

/**
 * تفعيل/إيقاف موديول لشركة بواسطة المطور — يعيد رسالة خطأ أو null عند النجاح.
 * الإيقاف: status=disabled (الشاشات تختفي والبيانات باقية) — الكور لا يُوقف أبدًا.
 * التفعيل: ممنوع لغير المتاح في الكتالوج (قريبًا) — ويضمن القسم الافتراضي.
 */
export async function setCompanyModule(
  companyId: number,
  code: string,
  enable: boolean,
  by: string
): Promise<{ error?: string; label?: string }> {
  const def = moduleByCode(code);
  if (!def) return { error: "نشاط غير معروف" };
  if (def.core) return { error: "المحاسبة والخزينة عمود النظام — مشمولة دائمًا ولا تُوقف" };
  if (enable && !def.available) return { error: `نشاط «${def.name}» غير متاح بعد — قريبًا` };
  const company = await sysDb.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) return { error: "الشركة غير موجودة" };

  const existing = await sysDb.companyModule.findUnique({
    where: { companyId_code: { companyId, code } },
  });
  if (enable) {
    if (existing) {
      await sysDb.companyModule.update({
        where: { id: existing.id },
        data: { status: "active", enabledBy: by, notes: enable ? "" : existing.notes },
      });
    } else {
      await sysDb.companyModule.create({
        data: { companyId, code, status: "active", enabledBy: by, notes: "تفعيل من المطور" },
      });
    }
    await ensureModuleDivision(companyId, code);
  } else {
    if (existing) {
      await sysDb.companyModule.update({
        where: { id: existing.id },
        data: { status: "disabled", enabledBy: by, notes: "إيقاف من المطور — البيانات محفوظة" },
      });
    }
    // لا صف = لم يكن مفعّلًا أصلًا — نجاح صامت
  }
  return { label: def.name };
}

/** حالة موديولات شركة للعرض في لوحة المطور (الكتالوج كاملًا + الحالة الفعلية) */
export async function companyModulesState(companyId: number) {
  const rows = await sysDb.companyModule.findMany({ where: { companyId } });
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return MODULE_CATALOG.filter((m) => !m.core).map((m) => {
    const row = byCode.get(m.code);
    return {
      code: m.code,
      name: m.name,
      icon: m.icon,
      available: m.available,
      status: row ? row.status : "none", // none = لم يُفعَّل قط
      enabledBy: row?.enabledBy ?? "",
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/** أكواد الطلب المخزنة JSON — مع ترجيع للنشاط النصي القديم (طلبات ما قبل الكتالوج) */
export function parseRequestModules(request: { modules: string; activity: string }): string[] {
  try {
    const parsed = JSON.parse(request.modules || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter((c) => typeof c === "string");
  } catch {
    /* طلب قديم بنص حر */
  }
  // ترجيع: طلب قديم نصه الحر يذكر مقاولات؟ الافتراضي مقاولات (النشاط الوحيد المتاح)
  return ["contracting"];
}

/** تسمية أنشطة طلب للعرض */
export function requestModulesLabel(request: { modules: string; activity: string }): string {
  try {
    const parsed = JSON.parse(request.modules || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) return moduleSelectionLabel(parsed);
  } catch {
    /* نص حر */
  }
  return request.activity || moduleSelectionLabel(["contracting"]);
}
