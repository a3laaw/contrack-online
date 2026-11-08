/**
 * modules-catalog.ts — كتالوج الموديولات (الأنشطة) — نقي 100% بلا DB ولا React:
 * • مصدر واحد للحقيقة تستهلكه الواجهة (بطاقات /join، لوحة المطور، فلترة الشل) والخادم (تحقق وبذر)
 * • core = عمود النظام (المحاسبة والخزينة): مشمول دائمًا مع أي نشاط ولا يُوقف أبدًا
 * • available=false ⇒ «قريبًا»: يظهر في البوابة واللوحة لكن تفعيله ممنوع حتى جاهزيته
 * • navModules = تبويبات الشل التي يملكها الموديول (تُخفى دفعة واحدة عند إيقافه)
 */

export interface ModuleDef {
  code: string;
  name: string;
  /** مفتاح أيقونة lucide — تُترجم في طبقة الواجهة (الكتالوج نقي بلا مكتبات) */
  icon: string;
  desc: string;
  /** false = قريبًا — لا يُفعَّل بعد */
  available: boolean;
  /** عمود النظام — مشمول دائمًا ولا يُوقف */
  core: boolean;
  /** تبويبات الشل المملوكة لهذا الموديول (ModuleId في nav-structure) */
  navModules: string[];
}

export const MODULE_CATALOG: ModuleDef[] = [
  {
    code: "accounting",
    name: "المحاسبة والخزينة",
    icon: "wallet",
    desc: "السندات والأستاذ والقوائم المالية والفواتير والتسوية — عمود النظام المشترك",
    available: true,
    core: true,
    navModules: ["accounting", "settings"],
  },
  {
    code: "contracting",
    name: "المقاولات",
    icon: "hardhat",
    desc: "العقود والعملاء والباطن والمتابعة والزيارات والتقارير التشغيلية",
    available: true,
    core: false,
    navModules: ["clients", "subs", "reports"],
  },
  {
    code: "consulting",
    name: "الاستشارات الهندسية",
    icon: "compass",
    desc: "مكاتب الاستشارات: الفريق الهندسي بتخصصاتهم وتراخيصهم، إسنادهم للمشاريع، ساعاتهم على المخططات والإشراف، وإجازاتهم",
    available: true,
    core: false,
    navModules: ["consulting"],
  },
  {
    // HR-1 — الموارد البشرية (docs/hr-module-design.md): يُضاف لأي نشاط — الموظف الموحد يخدم الجميع
    code: "hr",
    name: "الموارد البشرية",
    icon: "users",
    desc: "الموظفون بأنواعهم ورواتبهم، الحضور اليدوي، الإجازات بالامتثال الكويتي، مسير الرواتب المرتبط بالخزينة، وسلف الموظفين",
    available: true,
    core: false,
    navModules: ["hr"],
  },
  {
    // المخازن (docs/warehouses-design.md) — أصناف ومستودعات وأذون إدخال/صرف/تحويل/جرد وربط المواد بالعقود
    code: "warehouses",
    name: "المخازن",
    icon: "package",
    desc: "الأصناف والمستودعات وأذون الإدخال والصرف والجرد وربط المواد بالعقود",
    available: true,
    core: false,
    navModules: ["warehouses"],
  },
  {
    // المبيعات (docs/sales-design.md) — صفر جداول جديدة: عروض الأسعار ببيت مستقل + نقاط البيع بمعاملة واحدة
    code: "sales",
    name: "المبيعات",
    icon: "store",
    desc: "عروض الأسعار وتحويلها لفاتورة، ونقاط البيع السريع بفاتورة وسند وإذن صرف آلي بمعاملة واحدة",
    available: true,
    core: false,
    navModules: ["sales"],
  },
  {
    code: "maintenance",
    name: "الصيانة والتشغيل",
    icon: "wrench",
    desc: "عقود الصيانة الدورية وأوامر العمل وجدول الصيانة الوقائية",
    available: false,
    core: false,
    navModules: [],
  },
];

/** كود موديول الأساس (المحاسبة) — مشمول دائمًا حتى بلا صفوف company_modules */
export const CORE_MODULE_CODE = "accounting";

export function moduleByCode(code: string): ModuleDef | undefined {
  return MODULE_CATALOG.find((m) => m.code === code);
}

/** الموديولات المتاحة للاختيار (بلا core — فهو مشمول تلقائيًا، وبلا «قريبًا») */
export function selectableModules(): ModuleDef[] {
  return MODULE_CATALOG.filter((m) => m.available && !m.core);
}

/** تنظيف قائمة أكواد مختارة من عميل (طلب انضمام/إنشاء يدوي): يصحح ويستبعد ويعيد خطأ واضح */
export function validateModuleSelection(
  codes: unknown
): { ok: true; codes: string[] } | { ok: false; error: string } {
  // غياب الاختيار = افتراضي مقاولات (توافق مع الطرق القديمة)
  if (codes == null) return { ok: true, codes: ["contracting"] };
  if (!Array.isArray(codes)) return { ok: false, error: "قائمة الأنشطة غير صالحة" };
  const clean: string[] = [];
  for (const c of codes) {
    const def = moduleByCode(String(c));
    if (!def) return { ok: false, error: `نشاط غير معروف: ${String(c)}` };
    if (def.core) continue; // الكور مشمول تلقائيًا — يُتجاهل إن أُرسل
    if (!def.available) return { ok: false, error: `نشاط «${def.name}» غير متاح بعد — قريبًا` };
    if (!clean.includes(def.code)) clean.push(def.code);
  }
  if (clean.length === 0) return { ok: false, error: "اختر نشاطًا واحدًا على الأقل" };
  return { ok: true, codes: clean };
}

/** تسمية عربية لقائمة أكواد (تُخزن في حقل activity للعرض والتوافق) */
export function moduleSelectionLabel(codes: string[]): string {
  const names = codes
    .map((c) => moduleByCode(c)?.name)
    .filter((n): n is string => !!n);
  return names.join(" + ") || "مقاولات";
}

/**
 * تبويبات الشل المسموحة لأكواد مفعّلة:
 * - null ⇒ الكل (مطور، أو جلسة قديمة بلا معلومة موديولات — قاعدة «لا تحذف ميزة قائمة بلا دليل»)
 * - غير ذلك: core دائمًا مشمول + ما يملكه كل كود فعّال ومتاح في الكتالوج
 */
export function navModulesFor(enabledCodes: string[] | null | undefined): Set<string> | null {
  if (enabledCodes == null) return null;
  const allowed = new Set<string>(moduleByCode(CORE_MODULE_CODE)!.navModules);
  for (const c of enabledCodes) {
    const def = moduleByCode(c);
    if (def && def.available) for (const nav of def.navModules) allowed.add(nav);
  }
  return allowed;
}
