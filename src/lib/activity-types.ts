/**
 * activity-types.ts — كتالوج «أنواع النشاط» (القطاع التجاري للشركة) — نقي 100% بلا DB ولا React:
 * • المصدر الواحد للحقيقة لبوابة الانضمام المقسّمة: أولًا نوع النشاط ⇒ ومنه اقتراح الموديولات
 * • نوع النشاط ليس موديولًا — هو القطاع الذي تمارسه الشركة (مقاولات، استشارات، صيانة، تجارة…)
 *   والموديول هو ما يشتريه من النظام. الاقتراح اشتقاقي من النوع حصرًا (درس G9) — لا تخزين للاقتراح.
 * • suggested = أكواد موديولات مقترحة من modules-catalog (تُنقّح ضد الكتالوج عند الاشتقاق —
 *   النوع لا يملك معرفة بحالة available — والنواة تُرجع المقترح المتاح غير الكور فقط)
 * • «نشاط متعدد» بلا اقتراح آلي ([]) — تُترك بوابة الموديولات حرة كليًا
 */

import { moduleByCode, MODULE_CATALOG } from "./modules-catalog";

export interface ActivityTypeDef {
  code: string;
  name: string;
  /** مفتاح أيقونة lucide — تُترجم في طبقة الواجهة (الكتالوج نقي بلا مكتبات) */
  icon: string;
  desc: string;
  /** أكواد الموديولات المقترحة لهذا النوع — فارغ = اختيار حر */
  suggested: string[];
}

export const ACTIVITY_TYPES: ActivityTypeDef[] = [
  {
    code: "contracting",
    name: "مقاولات عامة",
    icon: "hardhat",
    desc: "بناء وتنفيذ مشاريع وعقود إنشاء — عقود العملاء ومستخلصاتها ومواد المشاريع من المخازن",
    suggested: ["contracting", "warehouses"],
  },
  {
    code: "consulting",
    name: "استشارات هندسية",
    icon: "compass",
    desc: "مكاتب الاستشارات والإشراف الهندسي — الفريق بتخصصاته وتراخيصه وساعاته على المشاريع",
    suggested: ["consulting"],
  },
  {
    code: "maintenance",
    name: "صيانة وتشغيل",
    icon: "wrench",
    desc: "عقود صيانة دورية وتشغيل مرافق — أوامر عمل وجدول وقائي مولّد وقطع غيار من المخازن",
    suggested: ["maintenance", "warehouses"],
  },
  {
    code: "trading",
    name: "تجارة ومبيعات",
    icon: "store",
    desc: "متاجر وتوريد — عروض أسعار ونقاط بيع سريعة ومخزون أصناف بأرصدة اشتقاقية",
    suggested: ["sales", "warehouses"],
  },
  {
    code: "mixed",
    name: "نشاط متعدد أو آخر",
    icon: "layers",
    desc: "أكثر من نشاط معًا أو نشاط غير مذكور — تختارون الموديولات بأنفسكم في الخطوة التالية",
    suggested: [],
  },
];

/** كود نوع النشاط الافتراضي للعرض التوافقي (طلبات قديمة بلا نوع) */
export const ACTIVITY_TYPE_EMPTY_LABEL = "غير محدد";

export function activityTypeByCode(code: string): ActivityTypeDef | undefined {
  return ACTIVITY_TYPES.find((t) => t.code === code);
}

/** تسمية نوع النشاط للعرض — الفارغ/المجهول ⇒ «غير محدد» (طلبات ما قبل التقسيم) */
export function activityTypeName(code: string | null | undefined): string {
  if (!code) return ACTIVITY_TYPE_EMPTY_LABEL;
  return activityTypeByCode(code)?.name ?? ACTIVITY_TYPE_EMPTY_LABEL;
}

/**
 * اقتراح الموديولات لنوع النشاط — اشتقاقي حصرًا:
 * يُنقّح ضد الكتالوج (متاح + غير core) وبترتيب الكتالوج نفسه (لا ترتيب التعريف)
 */
export function suggestedModulesFor(typeCode: string): string[] {
  const type = activityTypeByCode(typeCode);
  if (!type || type.suggested.length === 0) return [];
  return MODULE_CATALOG.filter((m) => !m.core && m.available && type.suggested.includes(m.code)).map(
    (m) => m.code
  );
}

/** تسمية عربية لاقتراح نوع النشاط (تُعرض على بطاقة النوع) */
export function suggestedModulesLabel(typeCode: string): string {
  const names = suggestedModulesFor(typeCode)
    .map((c) => moduleByCode(c)?.name)
    .filter((n): n is string => !!n);
  return names.length > 0 ? names.join(" + ") : "تختارون الموديولات بأنفسكم";
}

/** تحقق كود نوع النشاط القادم من عميل — يُرجع الكود المنظف أو أول خطأ عربي */
export function validateActivityType(
  code: unknown
): { ok: true; code: string } | { ok: false; error: string } {
  const c = String(code ?? "").trim();
  if (!c) return { ok: false, error: "نوع النشاط مطلوب — اختر نوع نشاط شركتكم أولًا" };
  const def = activityTypeByCode(c);
  if (!def) return { ok: false, error: "نوع النشاط غير معروف — اختر من القائمة" };
  return { ok: true, code: def.code };
}
