/**
 * activity-types.ts — كتالوج «أنواع النشاط» (القطاع التجاري للشركة) — نقي 100% بلا DB ولا React:
 * • المصدر الواحد للحقيقة لبوابة الانضمام المقسّمة: أولًا نوع النشاط ⇒ ومنه اقتراح الموديولات
 * • نوع النشاط ليس موديولًا — هو القطاع الذي تمارسه الشركة (مقاولات، استشارات، صيانة، تجارة…)
 *   والموديول هو ما يشتريه من النظام. الاقتراح اشتقاقي من النوع حصرًا (درس G9) — لا تخزين للاقتراح.
 * • suggested = أكواد موديولات مقترحة من modules-catalog (تُنقّح ضد الكتالوج عند الاشتقاق —
 *   النوع لا يملك معرفة بحالة available — والنواة تُرجع المقترح المتاح غير الكور فقط)
 * • «الموارد البشرية» ضمن كل اقتراح (د1-أ في docs/kuwait-activities.md): الرواتب والحضور
 *   حاجة شبه كونية — والعميل يحذفها بحرية في المرحلة ② إن لم يحتجها.
 * • «نشاط متعدد» بلا اقتراح آلي ([]) — تُترك بوابة الموديولات حرة كليًا
 * • المرجع الكامل لأنشطة السوق الكويتي الـ38 ومطابقتها بالبطاقات: docs/kuwait-activities.md
 * • الأكواد القائمة لا تُغيَّر أبدًا (تُخزن في طلبات الانضمام) — الجديد إضافة فقط.
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
    // 1 — يغطي أنشطة السوق 1، 3–6، 10 (docs/kuwait-activities.md §1)
    code: "contracting",
    name: "مقاولات عامة",
    icon: "hardhat",
    desc: "بناء وتنفيذ مشاريع وعقود إنشاء — عقود العملاء ومستخلصاتها ومواد المشاريع من المخازن",
    suggested: ["contracting", "warehouses", "hr"],
  },
  {
    // 2 — يغطي: مقاولات كهربائية وميكانيكية، تشطيبات ودهانات، بلور ورخام وألمنيوم، عزل، حدائق
    code: "contractingSpecialized",
    name: "مقاولات متخصصة",
    icon: "hammer",
    desc: "كهربائية وميكانيكية وتشطيبات وبلور وألمنيوم وعزل وحدائق — أعمال متخصصة بعقود ومواد",
    suggested: ["contracting", "warehouses", "hr"],
  },
  {
    // 3 — يغطي: مكاتب استشارية، مساحة، مخابر فحص، إدارة مشاريع PMC
    code: "consulting",
    name: "استشارات هندسية",
    icon: "compass",
    desc: "مكاتب الاستشارات والمساحة والمخابر والإشراف الهندسي — الفريق بتخصصاته وتراخيصه وساعاته على المشاريع",
    suggested: ["consulting", "hr"],
  },
  {
    // 4 — يغطي: عقود صيانة مبانٍ، مصاعد ومولدات وأنظمة تحكم، مكافحة حشرات
    code: "maintenance",
    name: "صيانة مبانٍ ومصاعد",
    icon: "wrench",
    desc: "عقود صيانة دورية للمباني والمصاعد والمولدات — أوامر عمل وجدول وقائي مولّد وقطع غيار من المخازن",
    suggested: ["maintenance", "warehouses", "hr"],
  },
  {
    // 5 — يغطي: نظافة عقود، حراسة، كادر، تشغيل ورفاهية FM (عقود دورية بزيارات — الكادر يضيف المقاولات من ②)
    code: "facilityServices",
    name: "تشغيل وخدمات دورية",
    icon: "building-2",
    desc: "نظافة وحراسة ومكافحة حشرات وكادر وتشغيل مرافق — عقود دورية بزيارات مجدولة وفواتير أقساط",
    suggested: ["maintenance", "hr"],
  },
  {
    // 6 — يغطي: تجارة جملة وتجزئة وتوزيع، مواد بناء، أدوات صحية وكهربائيات، أثاث وتجهيزات
    code: "trading",
    name: "تجارة وتوريد",
    icon: "store",
    desc: "جملة وتجزئة وتوزيع وتجهيزات — عروض أسعار ونقاط بيع سريعة ومخزون أصناف بأرصدة اشتقاقية",
    suggested: ["sales", "warehouses", "hr"],
  },
  {
    // 7 — يغطي: تأجير معدات وآليات بسائق أو بدونه
    code: "equipmentRental",
    name: "تأجير معدات وآليات",
    icon: "truck",
    desc: "تأجير معدات وآليات بسائق أو بدونه — عقود إيجار وفواتير دورية وقطع ومخزون",
    suggested: ["sales", "warehouses", "hr"],
  },
  {
    // 8 — يغطي: إدارة أملاك وعقود إيجار وصيانة الوحدات
    code: "realEstate",
    name: "إدارة وتأجير عقارات",
    icon: "home",
    desc: "إدارة أملاك وعقود إيجار وصيانة الوحدات — عقود المستأجرين بأقساطها وأوامر الصيانة الدورية",
    suggested: ["contracting", "maintenance", "hr"],
  },
  {
    // 9 — يغطي: مطاعم وكافيهات، كاترينج وإعاشة مشاريع
    code: "catering",
    name: "مطاعم وإعاشة",
    icon: "utensils",
    desc: "مطاعم وكافيهات وكاترينج وإعاشة مشاريع — نقاط بيع سريعة ومخزون خامات وعقود إعاشة شهرية",
    suggested: ["sales", "warehouses", "hr"],
  },
  {
    // 10 — يغطي: مكاتب محاسبة وقانون، تقنية معلومات، نقل وتوصيل، إعلان ومطبوعات
    code: "professional",
    name: "خدمات مهنية وتقنية",
    icon: "briefcase",
    desc: "مكاتب محاسبة وقانون وتقنية معلومات ونقل — خدمات صرفة بلا مخزون: موظفون وفواتير",
    suggested: ["hr"],
  },
  {
    // 11 — دائمًا آخر القائمة: باب حر لأي تركيبة غير مذكورة
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
