/**
 * المزايا الاختيارية (Feature Flags) — سجل منقول حرفيًا من المكتبي
 * (feature_service.py · 42 مفتاحًا).
 *
 * قواعد التصميم (كالمصدر):
 *  • الأساسيات (العملاء · العقود · السندات) غير قابلة للتعطيل — بدونها لا يوجد
 *    نظام، فلا تظهر لها مفاتيح أصلًا (CORE).
 *  • كل ميزة قد تعتمد على أخرى (requires) · وتعطيل الأصل يعطّل التابع
 *    تلقائيًا (الأشياء المتداخلة).
 *  • التعطيل يخفي الواجهة ويوقف الأثر في الخلفية ولا يمسّ أي بيانات مسجَّلة سابقًا.
 *
 * الشيفرة الثابتة (الاسم/الوصف/المجموعة/الاعتماديات/الافتراضي) تبقى هنا
 * في الكود تمامًا كالمكتبي، وتُحفظ في القاعدة حالة التفعيل فقط
 * (FeatureFlag: key + enabled).
 */

export interface FeatureSpec {
  key: string;
  name: string;
  desc: string;
  group: string;
  requires: string[];
  default: boolean;
}

export const FEATURE_CATALOG: FeatureSpec[] = [
  // ---------- شاشات ----------
  {
    key: "subcontractors",
    name: "مقاولو الباطن",
    desc: "شاشة المقاولين وعقود الباطن وصفحتهم في مركز العقد وصرف الدفعات لهم",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  {
    key: "statement",
    name: "كشف الحساب",
    desc: "شاشة كشف حساب العقد وطباعته PDF",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  {
    key: "reports",
    name: "التقارير",
    desc: "شاشة التقارير كاملة (تعطيلها يخفي كل التقارير)",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  {
    key: "tasks",
    name: "المهام والتنبيهات",
    desc: "لوحة المهام في الرئيسية وتحويل التنبيهات إلى مهام",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  {
    key: "projects",
    name: "المشاريع",
    desc: "ربط العقود بمشاريع وتجميعها",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  {
    key: "invoices",
    name: "الفواتير",
    desc: "إصدار فواتير للعقد بجانب سندات القبض",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  // ---------- داخل العقد ----------
  {
    key: "addendums",
    name: "أوامر التغيير والعقود الإضافية",
    desc: "زيادة أو خصم على قيمة العقد بملاحق معتمدة",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  {
    key: "payment_plan",
    name: "خطة السداد",
    desc: "دفعات مجدولة بمواعيد وتنبيه المتأخر منها",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  {
    key: "boq_items",
    name: "بنود العقد",
    desc: "نمط «بنود مقابل أسعار» وصفحة البنود في مركز العقد",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  {
    key: "supervision",
    name: "الإشراف الهندسي",
    desc: "عقود الإشراف بتعهد البلدية والتمديد التلقائي وتقريره",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  {
    key: "comments",
    name: "تعليقات العميل",
    desc: "صفحة تعليقات داخل ملف العميل: ما دار مع العميل ومن كتبه ومتى · مع التثبيت والبحث",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  {
    key: "documents",
    name: "الملفات والطباعة",
    desc: "مرفقات العقد وقوالب Word وأرشيف ملفات العميل",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  {
    key: "followup",
    name: "المتابعة ومراحل التنفيذ",
    desc:
      "مراحل تنفيذ شجرية (رئيسية/فرعية) بعدّاد أيام وأزرار إنهاء/تخطي — بلا سحب وإفلات · شات داخلي · جرس تنبيهات · تقرير التأخيرات والاختناقات والمراحل المفقودة",
    group: "أدوات",
    requires: [],
    default: true,
  },
  {
    key: "rep_execution",
    name: "تقرير: مراحل التنفيذ",
    desc: "العقود المتأخرة في مراحلها · القاربة على الانتهاء · والمراحل التي تخطّاها العقد بلا مرور بها",
    group: "التقارير",
    requires: ["reports"],
    default: true,
  },
  {
    key: "forms_center",
    name: "مركز النماذج",
    desc: "رفع أي نموذج PDF وتحديد حقوله بصريًا واستخدامه مرات غير محدودة — بديل النماذج المكتوبة بالكود",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  {
    key: "word_forms",
    name: "قوالب Word القابلة للتعديل",
    desc:
      "رفع ملف Word في مركز النماذج: يُعرض في المصمم البصري مثل PDF تمامًا لرسم الخانات فوق أماكنها، وحقول {{...}} المكتوبة داخل الوورد تُكتشف تلقائيًا — والناتج عند كل تعبئة ملف Word قابل للتعديل (+PDF)",
    group: "الشاشات",
    requires: ["forms_center"],
    default: true,
  },
  {
    key: "visits",
    name: "جدول الزيارات اليومي",
    desc:
      "مواعيد الزيارات: صفوف الساعات × أعمدة المهندسين، بحث العملاء بالخانة، ترحيل كمهمة تذكير بالوقت، تذكير واتساب للمهندس والعميل، وتصدير PDF",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  {
    key: "user_permissions",
    name: "صلاحيات الموظفين الدقيقة",
    desc: "المدير يؤشر لكل موظف ما يراه من الشاشات وما يفعله من إجراءات — من «صلاحيات الموظف» في إدارة المستخدمين",
    group: "أدوات",
    requires: [],
    default: true,
  },
  // ---------- التقارير (كل تقرير مفتاح مستقل) ----------
  // طلب صاحب النظام: يقدر يُظهر أو يُخفي كل تقرير على حدة للعميل،
  // لا مفتاحًا واحدًا للتقارير كلها. الإطفاء الكلي يبقى بـ«التقارير».
  {
    key: "rep_customers",
    name: "تقرير: العملاء والأرصدة",
    desc: "لكل عميل عقوده وقيمتها والمحصّل والمنصرف والمتبقي",
    group: "التقارير",
    requires: ["reports"],
    default: true,
  },
  // ملاحظة: تقارير «مستحقات العملاء» و«المستحقات» دُمجت في
  // «العملاء والأرصدة» (عقود بمتبقٍ + أقساط مستحقة تحت كل عميل).
  // «العقود القاربة» و«أنواع العقود» دُمجت في «تقرير العقود».
  // المفاتيح القديمة متجاهَلة عمدًا حتى لا تظهر في لوحة المزايا.
  {
    key: "rep_supervision_delay",
    name: "تقرير: تأخير الإشراف",
    desc: "بداية الإشراف والمدة والتمديد والتأخير شهورًا ومبالغ",
    group: "التقارير",
    requires: ["reports", "supervision"],
    default: true,
  },
  {
    key: "rep_subcontractors",
    name: "تقرير: مقاولو الباطن",
    desc: "لكل مقاول عقوده وقيمتها والمنصرف له والمتبقي",
    group: "التقارير",
    requires: ["reports", "subcontractors"],
    default: true,
  },
  {
    key: "rep_dues_board",
    name: "لوحة مستحقات الباطن",
    desc: "سطور صرف الباطن مع المراحل المحركة",
    group: "التقارير",
    requires: ["reports"],
    default: true,
  },
  // ملاحظة: "ربحية العقود" دُمجت في "تقرير العقود"
  // (خيار عرض "ربحية العقود" من الفلتر العلوي). المفتاح
  // rep_profitability محتفظ به للتوافق مع الإعدادات القديمة.
  {
    key: "rep_vouchers",
    name: "تقرير: حركة السندات",
    desc: "كل السندات في الفترة مع فلتر قبض/صرف والصافي",
    group: "التقارير",
    requires: ["reports"],
    default: true,
  },
  {
    key: "rep_journal",
    name: "تقرير: دفتر اليومية",
    desc: "القيود المحاسبية مدين/دائن في الفترة",
    group: "التقارير",
    requires: ["reports"],
    default: true,
  },
  {
    key: "rep_contracts",
    name: "تقرير: العقود",
    desc: "كل العقود بقيمها والمحصّل والمتبقي، مع ملخص الأنواع والعقود القاربة",
    group: "التقارير",
    requires: ["reports"],
    default: true,
  },
  {
    key: "rep_cashflow",
    name: "تقرير مالي تفصيلي",
    desc: "كشف نقدي تفصيلي ثم الصافي ورصيدا البنك والصندوق",
    group: "التقارير",
    requires: ["reports", "cashflow"],
    default: true,
  },
  {
    key: "rep_leads",
    name: "تقرير: الفرص البيعية",
    desc: "متابعة العملاء المحتملين ومراحل التفاوض",
    group: "التقارير",
    requires: ["reports"],
    default: true,
  },
  // ---------- مالية ----------
  {
    key: "cashflow",
    name: "التقرير المالي",
    desc: "تقرير الداخل والخارج والرصيد للمدير (يومي/شهري/سنوي)",
    group: "المالية",
    requires: ["reports"],
    default: true,
  },
  {
    key: "bank_fee",
    name: "رسوم التحويل البنكي",
    desc: "سند صرف تلقائي بقيمة الرسوم مع كل سند قبض بتحويل بنكي",
    group: "المالية",
    requires: ["cashflow"],
    default: true,
  },
  // ---------- أدوات ----------
  {
    key: "whatsapp",
    name: "إرسال واتساب",
    desc: "أزرار إرسال السندات والمهام عبر واتساب",
    group: "أدوات",
    requires: [],
    default: true,
  },
  {
    key: "full_backup",
    name: "النسخة الاحتياطية الكاملة",
    desc: "نسخة ZIP دوّارة تضم القاعدة والمرفقات والقوالب",
    group: "أدوات",
    requires: [],
    default: true,
  },
  {
    key: "network_folder",
    name: "العمل على مجلد شبكة",
    desc: "قاعدة بيانات مشتركة بين أكثر من جهاز",
    group: "أدوات",
    requires: [],
    default: true,
  },
  {
    key: "import_old",
    name: "استيراد البيانات القديمة",
    desc: "رفع ملف Excel بالعملاء والعقود والسندات القديمة",
    group: "أدوات",
    requires: [],
    default: true,
  },
  // ---------- شاشات جديدة (V3.2–V3.4) ----------
  {
    key: "payment_gateway",
    name: "بوابة الدفع",
    desc: "شاشة المطابقة والتصفية لبوابات الدفع والبنك",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  {
    key: "custody",
    name: "العُهد والتصفيات",
    desc: "شاشة العهد: التسليم والتصفية والكشف والحسابات",
    group: "الشاشات",
    requires: [],
    default: true,
  },
  // ---------- داخل العقد (جديدة) ----------
  {
    key: "contract_gaps",
    name: "عقود بفروقات",
    desc: "زر الفروقات في مركز العقد: عقود تختلف قيمتها عن خطتها/بنودها مع الإصلاح",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  {
    key: "template_plan_mode",
    name: "وضع القالب في التعديل",
    desc: "النوع ذو الشجرة يعرض قالب الدفعات في التعديل بدل اليدوي (تعطيله = يدوي دائمًا)",
    group: "داخل العقد",
    requires: ["payment_plan"],
    default: true,
  },
  {
    key: "amount_guard",
    name: "تنبيه المبلغ باتجاهين",
    desc: "عند الفرق بين المبلغ والدفعات/البنود: تحديث المبلغ أو توزيع الدفعات أو الحفظ بالفرق (تعطيله = منع صارم)",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  {
    // المرجع المكتبى: زر «توحيد قيمة العقد والدفعات من مجموع البنود» في وضع البنود
    // بحوار العقد (contracts.py:_sync_plan_from_items — المبلغ قابل للتحرير هناك).
    // في الويب: مبلغ العقد لا يُعدّل بعد الإنشاء (قرار موثق) وصفحة البنود إضافة فقط —
    // فزر المزامنة يحتاج وضع البنود بكامله (المرحلة 7 — مركز العقد) ولا يُبنى الآن.
    key: "items_sync",
    name: "مزامنة الدفعات من البنود",
    desc: "زر توحيد قيمة العقد والدفعات من مجموع البنود",
    group: "داخل العقد",
    requires: ["boq_items", "payment_plan"],
    default: true,
  },
  {
    // المرجع المكتبى: contracts.py:_update_mode_banner ⇒ pass (مُزال بالكامل من النافذة)
    // والمفتاح محتفظ به في feature_service فقط — فالسلوك المطابق: بلا شارة في الويب أيضًا.
    key: "mode_banner",
    name: "شارة وضع العقد",
    desc: "سطر الوضع أعلى حوار العقد (مقطوع/بنود/إشراف...)",
    group: "داخل العقد",
    requires: [],
    default: true,
  },
  // ---------- مالية (جديدة) ----------
  // V3.13: تقاعد "settlements_report" — حُذف زر التقرير المكرر.
  {
    key: "settle_edit",
    name: "تعديل التصفية (مدير)",
    desc: "تعديل بنود التصفية وحذفها من مركز العهدة للمدير",
    group: "المالية",
    requires: ["custody"],
    default: true,
  },
  // ---------- أدوات (جديدة) ----------
  {
    // المرجع المكتبى: main_window.py:_notification_menu_items — بند «مسح كل إشعارات المتابعة»
    // في قائمة الجرس. مركز الجرس/الإشعارات نفسه لم يُنقل للويب بعد (المرحلة 7/9) —
    // فالمفتاح محفوظ في الكتالوج ويُستهلك عند نقل القائمة (لا يُبنى بند بلا قائمة).
    key: "notif_cleanup",
    name: "تصفية الإشعارات",
    desc: "زر مسح المقروءة والقديمة في قائمة الجرس",
    group: "أدوات",
    requires: ["followup"],
    default: true,
  },
];

const FEATURE_BY_KEY = new Map<string, FeatureSpec>(FEATURE_CATALOG.map((f) => [f.key, f]));

/** الأساسيات: لا مفاتيح لها ولا يمكن تعطيلها (كالمصدر) */
export const CORE_FEATURES: readonly string[] = ["customers", "contracts", "vouchers", "settings"];

/** مفاتيح مفعّلة دائمًا في هذا النظام (كالمصدر) */
export const FORCED_ON_FEATURES: readonly string[] = ["followup", "rep_execution"];

export function featureSpec(key: string): FeatureSpec | undefined {
  return FEATURE_BY_KEY.get(key);
}

/**
 * هل الميزة مفعّلة مع كل ما تعتمد عليه؟ (الأشياء المتداخلة) —
 * مطابقة لـ feature_service.enabled: تعطيل الأصل يعطّل التابع تلقائيًا.
 * مفتاح غير معروف أو أساسي ⇒ true (كالمصدر).
 */
export function isEffectivelyEnabled(key: string, stored: Record<string, boolean>): boolean {
  if (FORCED_ON_FEATURES.includes(key)) return true;
  const spec = FEATURE_BY_KEY.get(key);
  if (!spec || CORE_FEATURES.includes(key)) return true;
  if (!(stored[key] ?? spec.default)) return false;
  const seen = new Set<string>();
  const stack = [...spec.requires];
  while (stack.length) {
    const parent = stack.pop()!;
    if (seen.has(parent)) continue;
    seen.add(parent);
    const parentSpec = FEATURE_BY_KEY.get(parent);
    if (parentSpec) {
      if (!(stored[parent] ?? parentSpec.default)) return false;
      stack.push(...parentSpec.requires);
    }
  }
  return true;
}

/** قيمة المفتاح نفسه بلا حساب التبعية (لعرضها في شاشة المطور) — كـ raw_enabled */
export function isRawEnabled(key: string, stored: Record<string, boolean>): boolean {
  if (FORCED_ON_FEATURES.includes(key)) return true;
  const spec = FEATURE_BY_KEY.get(key);
  if (!spec) return true;
  return stored[key] ?? spec.default;
}

/** المزايا التي تتعطل تلقائيًا لو عُطّلت هذه الميزة — كـ dependents */
export function featureDependents(key: string): string[] {
  const out: string[] = [];
  for (const other of FEATURE_CATALOG) {
    if (other.key === key) continue;
    const chain = new Set<string>();
    const stack = [...other.requires];
    while (stack.length) {
      const p = stack.pop()!;
      if (chain.has(p)) continue;
      chain.add(p);
      const pSpec = FEATURE_BY_KEY.get(p);
      if (pSpec) stack.push(...pSpec.requires);
    }
    if (chain.has(key)) out.push(other.key);
  }
  return out;
}

/** المزايا مرتبة بمجموعاتها (لعرضها في شاشة المطور) — كـ grouped */
export function groupedFeatures(): Record<string, FeatureSpec[]> {
  const out: Record<string, FeatureSpec[]> = {};
  for (const spec of FEATURE_CATALOG) {
    (out[spec.group] ??= []).push(spec);
  }
  return out;
}
