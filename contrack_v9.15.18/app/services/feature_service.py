# -*- coding: utf-8 -*-
"""المزايا الاختيارية (Feature Flags) · يضبطها المطور لكل عميل.

الفكرة: النظام واحد، والعميل يرى ما اشتراه أو ما يحتاجه فقط. المطور
يفتح: الإعدادات ← أدوات المطور ← مزايا النظام، ويؤشر ما يظهر.

قواعد التصميم:
  • الأساسيات (العملاء · العقود · السندات) **غير قابلة للتعطيل** — بدونها
    لا يوجد نظام، فلا تظهر لها مفاتيح أصلًا.
  • كل ميزة قد تعتمد على أخرى (`requires`) · وتعطيل الأصل يعطّل التابع
    تلقائيًا (الأشياء المتداخلة).
  • التعطيل **يخفي الواجهة ويوقف الأثر في الخلفية** ولا يمسّ أي بيانات
    مسجَّلة سابقًا (قاعدة 38).
"""
from database.database import get_connection

# ============================================================
# سجل المزايا
# key: (الاسم · الوصف · المجموعة · يعتمد على · مفعّل افتراضيًا)
# ============================================================
FEATURES: dict[str, dict] = {
    # ---------- شاشات ----------
    "subcontractors": {
        "name": "مقاولو الباطن",
        "desc": "شاشة المقاولين وعقود الباطن وصفحتهم في مركز العقد "
                "وصرف الدفعات لهم",
        "group": "الشاشات", "requires": [], "default": True,
    },
    "statement": {
        "name": "كشف الحساب",
        "desc": "شاشة كشف حساب العقد وطباعته PDF",
        "group": "الشاشات", "requires": [], "default": True,
    },
    "reports": {
        "name": "التقارير",
        "desc": "شاشة التقارير كاملة (تعطيلها يخفي كل التقارير)",
        "group": "الشاشات", "requires": [], "default": True,
    },
    "tasks": {
        "name": "المهام والتنبيهات",
        "desc": "لوحة المهام في الرئيسية وتحويل التنبيهات إلى مهام",
        "group": "الشاشات", "requires": [], "default": True,
    },
    "projects": {
        "name": "المشاريع",
        "desc": "ربط العقود بمشاريع وتجميعها",
        "group": "الشاشات", "requires": [], "default": True,
    },
    "invoices": {
        "name": "الفواتير",
        "desc": "إصدار فواتير للعقد بجانب سندات القبض",
        "group": "الشاشات", "requires": [], "default": True,
    },
    # ---------- داخل العقد ----------
    "addendums": {
        "name": "أوامر التغيير والعقود الإضافية",
        "desc": "زيادة أو خصم على قيمة العقد بملاحق معتمدة",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    "payment_plan": {
        "name": "خطة السداد",
        "desc": "دفعات مجدولة بمواعيد وتنبيه المتأخر منها",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    "boq_items": {
        "name": "بنود العقد",
        "desc": "نمط «بنود مقابل أسعار» وصفحة البنود في مركز العقد",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    "supervision": {
        "name": "الإشراف الهندسي",
        "desc": "عقود الإشراف بتعهد البلدية والتمديد التلقائي وتقريره",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    "comments": {
        "name": "تعليقات العميل",
        "desc": "صفحة تعليقات داخل ملف العميل: ما دار مع العميل ومن كتبه "
                "ومتى · مع التثبيت والبحث",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    "documents": {
        "name": "الملفات والطباعة",
        "desc": "مرفقات العقد وقوالب Word وأرشيف ملفات العميل",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    "followup": {
        "name": "المتابعة ومراحل التنفيذ",
        "desc": "مراحل تنفيذ شجرية (رئيسية/فرعية) بعدّاد أيام وأزرار إنهاء/"
                "تخطي — بلا سحب وإفلات · شات داخلي · جرس تنبيهات · "
                "تقرير التأخيرات والاختناقات والمراحل المفقودة",
        "group": "أدوات", "requires": [], "default": True,
    },
    "rep_execution": {
        "name": "تقرير: مراحل التنفيذ",
        "desc": "العقود المتأخرة في مراحلها · القاربة على الانتهاء · "
                "والمراحل التي تخطّاها العقد بلا مرور بها",
        "group": "التقارير", "requires": ["reports"], "default": True,
    },
    "forms_center": {
        "name": "مركز النماذج",
        "desc": "رفع أي نموذج PDF وتحديد حقوله بصريًا واستخدامه مرات "
                "غير محدودة — بديل النماذج المكتوبة بالكود",
        "group": "الشاشات", "requires": [], "default": True,
    },
    "word_forms": {
        "name": "قوالب Word القابلة للتعديل",
        "desc": "رفع ملف Word في مركز النماذج: يُعرض في المصمم البصري "
                "مثل PDF تمامًا لرسم الخانات فوق أماكنها، وحقول "
                "{{...}} المكتوبة داخل الوورد تُكتشف تلقائيًا — والناتج "
                "عند كل تعبئة ملف Word قابل للتعديل (+PDF)",
        "group": "الشاشات", "requires": ["forms_center"], "default": True,
    },
    "visits": {
        "name": "جدول الزيارات اليومي",
        "desc": "مواعيد الزيارات: صفوف الساعات × أعمدة المهندسين، بحث "
                "العملاء بالخانة، ترحيل كمهمة تذكير بالوقت، تذكير واتساب "
                "للمهندس والعميل، وتصدير PDF",
        "group": "الشاشات", "requires": [], "default": True,
    },
    "user_permissions": {
        "name": "صلاحيات الموظفين الدقيقة",
        "desc": "المدير يؤشر لكل موظف ما يراه من الشاشات وما يفعله من "
                "إجراءات — من «صلاحيات الموظف» في إدارة المستخدمين",
        "group": "أدوات", "requires": [], "default": True,
    },
    # ---------- التقارير (كل تقرير مفتاح مستقل) ----------
    # طلب صاحب النظام: يقدر يُظهر أو يُخفي كل تقرير على حدة للعميل،
    # لا مفتاحًا واحدًا للتقارير كلها. الإطفاء الكلي يبقى بـ«التقارير».
    "rep_customers": {
        "name": "تقرير: العملاء والأرصدة",
        "desc": "لكل عميل عقوده وقيمتها والمحصّل والمنصرف والمتبقي",
        "group": "التقارير", "requires": ["reports"], "default": True,
    },
    # ملاحظة: تقارير «مستحقات العملاء» و«المستحقات» دُمجت في
    # «العملاء والأرصدة» (عقود بمتبقٍ + أقساط مستحقة تحت كل عميل).
    # «العقود القاربة» و«أنواع العقود» دُمجت في «تقرير العقود».
    # المفاتيح القديمة متجاهَلة عمدًا حتى لا تظهر في لوحة المزايا.
    "rep_supervision_delay": {
        "name": "تقرير: تأخير الإشراف",
        "desc": "بداية الإشراف والمدة والتمديد والتأخير شهورًا ومبالغ",
        "group": "التقارير", "requires": ["reports", "supervision"],
        "default": True,
    },
    "rep_subcontractors": {
        "name": "تقرير: مقاولو الباطن",
        "desc": "لكل مقاول عقوده وقيمتها والمنصرف له والمتبقي",
        "group": "التقارير", "requires": ["reports", "subcontractors"],
        "default": True,
    },
    "rep_dues_board": {
        "name": "لوحة مستحقات الباطن",
        "desc": "سطور صرف الباطن مع المراحل المحركة",
        "group": "التقارير", "requires": ["reports"],
        "default": True,
    },
    # ملاحظة: "ربحية العقود" دُمجت في "تقرير العقود"
    # (خيار عرض "ربحية العقود" من الفلتر العلوي). المفتاح
    # rep_profitability محتفظ به للتوافق مع الإعدادات القديمة.
    "rep_vouchers": {
        "name": "تقرير: حركة السندات",
        "desc": "كل السندات في الفترة مع فلتر قبض/صرف والصافي",
        "group": "التقارير", "requires": ["reports"], "default": True,
    },
    "rep_journal": {
        "name": "تقرير: دفتر اليومية",
        "desc": "القيود المحاسبية مدين/دائن في الفترة",
        "group": "التقارير", "requires": ["reports"], "default": True,
    },
    "rep_contracts": {
        "name": "تقرير: العقود",
        "desc": "كل العقود بقيمها والمحصّل والمتبقي، مع ملخص الأنواع والعقود القاربة",
        "group": "التقارير", "requires": ["reports"], "default": True,
    },
    "rep_cashflow": {
        "name": "تقرير مالي تفصيلي",
        "desc": "كشف نقدي تفصيلي ثم الصافي ورصيدا البنك والصندوق",
        "group": "التقارير", "requires": ["reports", "cashflow"],
        "default": True,
    },
    "rep_leads": {
        "name": "تقرير: الفرص البيعية",
        "desc": "متابعة العملاء المحتملين ومراحل التفاوض",
        "group": "التقارير", "requires": ["reports"], "default": True,
    },
    # ---------- مالية ----------
    "cashflow": {
        "name": "التقرير المالي",
        "desc": "تقرير الداخل والخارج والرصيد للمدير (يومي/شهري/سنوي)",
        "group": "المالية", "requires": ["reports"], "default": True,
    },
    "bank_fee": {
        "name": "رسوم التحويل البنكي",
        "desc": "سند صرف تلقائي بقيمة الرسوم مع كل سند قبض بتحويل بنكي",
        "group": "المالية", "requires": ["cashflow"], "default": True,
    },
    # ---------- أدوات ----------
    "whatsapp": {
        "name": "إرسال واتساب",
        "desc": "أزرار إرسال السندات والمهام عبر واتساب",
        "group": "أدوات", "requires": [], "default": True,
    },
    "full_backup": {
        "name": "النسخة الاحتياطية الكاملة",
        "desc": "نسخة ZIP دوّارة تضم القاعدة والمرفقات والقوالب",
        "group": "أدوات", "requires": [], "default": True,
    },
    "network_folder": {
        "name": "العمل على مجلد شبكة",
        "desc": "قاعدة بيانات مشتركة بين أكثر من جهاز",
        "group": "أدوات", "requires": [], "default": True,
    },
    "import_old": {
        "name": "استيراد البيانات القديمة",
        "desc": "رفع ملف Excel بالعملاء والعقود والسندات القديمة",
        "group": "أدوات", "requires": [], "default": True,
    },
    # ---------- شاشات جديدة (V3.2–V3.4) ----------
    "payment_gateway": {
        "name": "بوابة الدفع",
        "desc": "شاشة المطابقة والتصفية لبوابات الدفع والبنك",
        "group": "الشاشات", "requires": [], "default": True,
    },
    "custody": {
        "name": "العُهد والتصفيات",
        "desc": "شاشة العهد: التسليم والتصفية والكشف والحسابات",
        "group": "الشاشات", "requires": [], "default": True,
    },
    # ---------- داخل العقد (جديدة) ----------
    "contract_gaps": {
        "name": "عقود بفروقات",
        "desc": "زر الفروقات في مركز العقد: عقود تختلف قيمتها عن "
                "خطتها/بنودها مع الإصلاح",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    "template_plan_mode": {
        "name": "وضع القالب في التعديل",
        "desc": "النوع ذو الشجرة يعرض قالب الدفعات في التعديل بدل "
                "اليدوي (تعطيله = يدوي دائمًا)",
        "group": "داخل العقد", "requires": ["payment_plan"],
        "default": True,
    },
    "amount_guard": {
        "name": "تنبيه المبلغ باتجاهين",
        "desc": "عند الفرق بين المبلغ والدفعات/البنود: تحديث المبلغ أو "
                "توزيع الدفعات أو الحفظ بالفرق (تعطيله = منع صارم)",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    "items_sync": {
        "name": "مزامنة الدفعات من البنود",
        "desc": "زر توحيد قيمة العقد والدفعات من مجموع البنود",
        "group": "داخل العقد", "requires": ["boq_items", "payment_plan"],
        "default": True,
    },
    "mode_banner": {
        "name": "شارة وضع العقد",
        "desc": "سطر الوضع أعلى حوار العقد (مقطوع/بنود/إشراف...)",
        "group": "داخل العقد", "requires": [], "default": True,
    },
    # ---------- مالية (جديدة) ----------
    # V3.13: تقاعد "settlements_report" — حُذف زر التقرير المكرر.
    "settle_edit": {
        "name": "تعديل التصفية (مدير)",
        "desc": "تعديل بنود التصفية وحذفها من مركز العهدة للمدير",
        "group": "المالية", "requires": ["custody"], "default": True,
    },
    # ---------- أدوات (جديدة) ----------
    "notif_cleanup": {
        "name": "تصفية الإشعارات",
        "desc": "زر مسح المقروءة والقديمة في قائمة الجرس",
        "group": "أدوات", "requires": ["followup"], "default": True,
    },
}

# الأساسيات: لا مفاتيح لها ولا يمكن تعطيلها
CORE = ("customers", "contracts", "vouchers", "settings")

_cache: dict[str, bool] | None = None
FORCED_ON = {"followup", "rep_execution"}


def _ensure_table() -> None:
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS feature_flags (
                key     TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1
            )""")


def _raw_flags() -> dict[str, bool]:
    """قراءة المفاتيح كما هي من القاعدة (بلا حساب التبعية)."""
    global _cache
    if _cache is not None:
        return _cache
    _ensure_table()
    flags = {k: bool(v["default"]) for k, v in FEATURES.items()}
    try:
        with get_connection() as conn:
            for row in conn.execute("SELECT key, enabled FROM feature_flags"):
                if row["key"] in flags:
                    flags[row["key"]] = bool(row["enabled"])
    except Exception:
        pass
    _cache = flags
    return flags


def refresh_cache() -> None:
    """إسقاط الذاكرة المؤقتة بعد أي تغيير."""
    global _cache
    _cache = None


def enabled(key: str) -> bool:
    """هل الميزة مفعّلة **مع كل ما تعتمد عليه**؟ (الأشياء المتداخلة)."""
    if key in FORCED_ON:
        return True
    if key in CORE or key not in FEATURES:
        return True
    flags = _raw_flags()
    if not flags.get(key, True):
        return False
    seen = set()
    stack = list(FEATURES[key].get("requires", []))
    while stack:
        parent = stack.pop()
        if parent in seen:
            continue
        seen.add(parent)
        if parent in FEATURES:
            if not flags.get(parent, True):
                return False
            stack.extend(FEATURES[parent].get("requires", []))
    return True


def raw_enabled(key: str) -> bool:
    """قيمة المفتاح نفسه بلا حساب التبعية (لعرضه في شاشة المطور)."""
    if key in FORCED_ON:
        return True
    return _raw_flags().get(key, True)


def dependents(key: str) -> list[str]:
    """المزايا التي تتعطل تلقائيًا لو عُطّلت هذه الميزة."""
    out = []
    for other, spec in FEATURES.items():
        if other == key:
            continue
        chain, stack = set(), list(spec.get("requires", []))
        while stack:
            p = stack.pop()
            if p in chain:
                continue
            chain.add(p)
            if p in FEATURES:
                stack.extend(FEATURES[p].get("requires", []))
        if key in chain:
            out.append(other)
    return out


def set_enabled(key: str, value: bool) -> None:
    if key not in FEATURES or key in FORCED_ON:
        return
    _ensure_table()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO feature_flags (key, enabled) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled",
            (key, 1 if value else 0))
    refresh_cache()


def set_many(values: dict[str, bool]) -> None:
    """حفظ مجموعة مفاتيح دفعة واحدة."""
    _ensure_table()
    with get_connection() as conn:
        for key, value in values.items():
            if key in FEATURES and key not in FORCED_ON:
                conn.execute(
                    "INSERT INTO feature_flags (key, enabled) VALUES (?,?) "
                    "ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled",
                    (key, 1 if value else 0))
    refresh_cache()


def grouped() -> dict[str, list[tuple[str, dict]]]:
    """المزايا مرتبة بمجموعاتها لعرضها في شاشة المطور."""
    out: dict[str, list[tuple[str, dict]]] = {}
    for key, spec in FEATURES.items():
        out.setdefault(spec["group"], []).append((key, spec))
    return out


def disabled_summary() -> str:
    """سطر مختصر بما هو معطّل حاليًا (لتذكير المطور عند التسليم)."""
    off = [FEATURES[k]["name"] for k in FEATURES if not raw_enabled(k)]
    if not off:
        return "كل المزايا مفعّلة"
    return "المعطّل: " + " · ".join(off)
