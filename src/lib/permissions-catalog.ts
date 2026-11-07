/**
 * كتالوج الصلاحيات النقي (بلا اعتماديات خادم) — مواءمة موثقة مع المكتبي
 * auth_service.PERMISSIONS. تستهلكه auth.ts (الخادم) وواجهة القائمة.
 */
// كتالوج الصلاحيات — مواءمة موثقة مع المكتبي auth_service.PERMISSIONS (39 مفتاحًا):
//   • المفاتيح المشتركة تحمل secretary = قيمة المفتاح المكتبية حرفيًا (السكرتير بندًا بندًا).
//   • المفاتيح الويب-فقط (بلا مقابل مكتبي بالاسم) = secretary:true للحفاظ على السلوك الحالي.
//   • الدمج المكتبي: screen_receipts+screen_payments ⇒ screen_vouchers ·
//     action_add_receipt+action_add_payment(سندات) ⇒ action_add_voucher ·
//     rep_leads ⇒ report_prospects · rep_dues_board ⇒ report_stage_dues ·
//     rep_customers ⇒ report_customers_balances · rep_supervision_delay ⇒ report_supervision_delays.
//   • المفاتيح المضافة (16): screen_statement/screen_reports/screen_followup/screen_settings/
//     screen_claims/screen_forms/report_customer_profitability/action_print_statement/
//     action_view_financial/action_whatsapp/action_delete/action_supervision_waive/
//     action_form_design/action_change_status/action_edit_voucher/action_add_subcontractor.
export const PERMISSIONS: { key: string; label: string; group: string; secretary: boolean; desktop?: string }[] = [
  // ---------- الشاشات ----------
  { key: "screen_customers", label: "شاشة العملاء والعقود", group: "الشاشات", secretary: true, desktop: "screen_customers" },
  { key: "screen_contracts", label: "شاشة العقود", group: "الشاشات", secretary: true },
  { key: "screen_vouchers", label: "شاشة السندات (قبض/صرف)", group: "الشاشات", secretary: true, desktop: "screen_receipts + screen_payments" },
  { key: "screen_receipts", label: "شاشة سندات القبض", group: "الشاشات", secretary: true, desktop: "screen_receipts" },
  { key: "screen_payments", label: "شاشة سندات الصرف", group: "الشاشات", secretary: true, desktop: "screen_payments" },
  { key: "screen_subcontractors", label: "شاشة مقاولي الباطن", group: "الشاشات", secretary: true, desktop: "screen_subcontractors" },
  { key: "screen_custody", label: "شاشة العُهد", group: "الشاشات", secretary: true },
  { key: "screen_invoices", label: "شاشة الفواتير", group: "الشاشات", secretary: true },
  { key: "screen_gateway", label: "البوابة المالية", group: "الشاشات", secretary: false, desktop: "screen_gateway" },
  { key: "screen_clearing", label: "شاشة التصفية", group: "الشاشات", secretary: false, desktop: "screen_gateway (التصفية اليومية)" },
  { key: "screen_other_company", label: "الشركة الأخرى", group: "الشاشات", secretary: true },
  { key: "screen_tasks", label: "شاشة المهام", group: "الشاشات", secretary: true },
  { key: "screen_visits", label: "جدول الزيارات", group: "الشاشات", secretary: true, desktop: "screen_visits" },
  { key: "screen_archive", label: "الأرشيف", group: "الشاشات", secretary: true },
  { key: "screen_statement", label: "شاشة كشف الحساب", group: "الشاشات", secretary: true, desktop: "screen_statement" },
  { key: "screen_reports", label: "شاشة التقارير", group: "الشاشات", secretary: true, desktop: "screen_reports" },
  { key: "screen_followup", label: "لوحة المتابعة", group: "الشاشات", secretary: true, desktop: "screen_followup" },
  { key: "screen_forms", label: "شاشة مركز النماذج", group: "الشاشات", secretary: true, desktop: "screen_forms" },
  { key: "screen_settings", label: "شاشة الإعدادات المحدودة", group: "الشاشات", secretary: true, desktop: "screen_settings" },
  { key: "screen_claims", label: "شاشة المطالبات المالية", group: "الشاشات", secretary: true, desktop: "screen_claims" },
  { key: "screen_chart_of_accounts", label: "شاشة دليل الحسابات", group: "الشاشات", secretary: true },
  { key: "screen_journal_entries", label: "شاشة القيود اليومية", group: "الشاشات", secretary: true },
  { key: "screen_ledger", label: "شاشة دفتر الأستاذ والميزان", group: "الشاشات", secretary: true },
  { key: "screen_fiscal_close", label: "شاشة الفترات والإقفال المالي", group: "الشاشات", secretary: true },
  { key: "screen_financial_statements", label: "شاشة القوائم المالية (القرار 44/2016)", group: "الشاشات", secretary: true },
  { key: "screen_bank_recon", label: "شاشة التسوية البنكية وتقرير الفوارق", group: "الشاشات", secretary: true },
  { key: "screen_zakat_xbrl", label: "شاشة الزكاة والتقديم الإلكتروني (XBRL)", group: "الشاشات", secretary: false },
  // ---------- التقارير ----------
  { key: "report_customers_balances", label: "تقرير العملاء والأرصدة", group: "التقارير", secretary: false, desktop: "rep_customers" },
  { key: "report_stage_dues", label: "مستحقات المراحل", group: "التقارير", secretary: true, desktop: "rep_dues_board" },
  { key: "report_supervision_delays", label: "تأخير الإشراف", group: "التقارير", secretary: true, desktop: "rep_supervision_delay" },
  { key: "report_subcontractors", label: "تقرير المقاولين", group: "التقارير", secretary: true, desktop: "rep_subcontractors" },
  { key: "report_customer_profitability", label: "ربحية العميل", group: "التقارير", secretary: false, desktop: "rep_customer_profitability" },
  { key: "report_vouchers", label: "الإيرادات والمصروفات", group: "التقارير", secretary: false, desktop: "rep_vouchers" },
  { key: "report_expenses", label: "تفصيل المصروفات", group: "التقارير", secretary: false, desktop: "rep_expenses" },
  { key: "report_cashflow", label: "التدفق النقدي", group: "التقارير", secretary: false, desktop: "rep_cashflow" },
  { key: "report_contracts", label: "تقارير العقود", group: "التقارير", secretary: true, desktop: "rep_contracts" },
  { key: "report_execution", label: "مراحل التنفيذ", group: "التقارير", secretary: true, desktop: "rep_execution" },
  { key: "report_prospects", label: "الفرص البيعية", group: "التقارير", secretary: true, desktop: "rep_leads" },
  { key: "report_other_company", label: "كشف الشركة الأخرى", group: "التقارير", secretary: true },
  { key: "report_journal", label: "دفتر اليومية", group: "التقارير", secretary: false, desktop: "rep_journal" },
  { key: "report_gateway_summary", label: "ملخص البوابة", group: "التقارير", secretary: false },
  // ---------- الإجراءات ----------
  { key: "action_add_contract", label: "إضافة عقد", group: "الإجراءات", secretary: true },
  { key: "action_edit_contract", label: "تعديل عقد", group: "الإجراءات", secretary: true },
  { key: "action_cancel_contract", label: "إلغاء عقد", group: "الإجراءات", secretary: true },
  { key: "action_add_voucher", label: "إنشاء سندات القبض/الصرف", group: "الإجراءات", secretary: true, desktop: "action_add_receipt + action_add_payment" },
  { key: "action_add_payment", label: "إضافة دفعة (خطة)", group: "الإجراءات", secretary: true },
  { key: "action_edit_payment", label: "تعديل دفعة", group: "الإجراءات", secretary: true },
  { key: "action_edit_voucher", label: "تعديل السندات", group: "الإجراءات", secretary: true, desktop: "action_edit_voucher" },
  { key: "action_cancel_voucher", label: "إلغاء سند", group: "الإجراءات", secretary: false, desktop: "action_cancel_voucher" },
  { key: "action_addendum_approve", label: "اعتماد ملحق", group: "الإجراءات", secretary: true },
  { key: "action_claim_manage", label: "إدارة المطالبات", group: "الإجراءات", secretary: true },
  { key: "action_stage_advance", label: "تخطي/إرجاع مرحلة", group: "الإجراءات", secretary: true },
  { key: "action_edit_voucher_desc", label: "تعديل بيان السند فقط", group: "الإجراءات", secretary: false, desktop: "action_edit_voucher_description" },
  { key: "action_add_subcontractor", label: "إضافة مقاول باطن", group: "الإجراءات", secretary: false, desktop: "action_add_subcontractor" },
  { key: "action_print_statement", label: "طباعة كشف الحساب", group: "الإجراءات", secretary: true, desktop: "action_print_statement" },
  { key: "action_view_financial", label: "رؤية الربحية والتكلفة", group: "الإجراءات", secretary: false, desktop: "action_view_financial" },
  { key: "action_whatsapp", label: "إرسال رسائل واتساب", group: "الإجراءات", secretary: true, desktop: "action_whatsapp" },
  { key: "action_delete", label: "حذف العملاء والعقود", group: "الإجراءات", secretary: false, desktop: "action_delete" },
  { key: "action_supervision_waive", label: "إلغاء أشهر تمديد الإشراف", group: "الإجراءات", secretary: false, desktop: "action_supervision_waive" },
  { key: "action_form_design", label: "تصميم النماذج", group: "الإجراءات", secretary: false, desktop: "action_form_design" },
  { key: "action_change_status", label: "تغيير حالة العقد", group: "الإجراءات", secretary: false, desktop: "action_change_status" },
  { key: "action_backups", label: "النسخ الاحتياطي", group: "الإجراءات", secretary: true },
];

export type PermissionSpec = (typeof PERMISSIONS)[number];

/**
 * الأدوار المحاسبية الجاهزة — Task 112 (خارطة المرحلة 5):
 *  • accountant «محاسب»: يرى الشاشات التشغيلية والقيود والسندات — ينشئ لكن لا يعتمد (الاعتماد للمدير)
 *  • chief_accountant «محاسب رئيسي»: كل الشاشات المحاسبية + إجراءات الاعتماد/الإلغاء/الإقفال
 *    (الإجراءات الإدارية الحساسة تبقى للمدير في الواجهات — الرئيسي هنا شاشات كاملة)
 *  • auditor «مراجع»: قراءة كاملة للشاشات والتقارير المالية بلا إجراءات تعديل
 * تُطبَّق كحزمة مفاتيح على صلاحيات مستخدم عبر شاشة الصلاحيات (زر لكل دور) — وتوفر
 * بنفس آلية user_permissions القائمة بلا أي بنية أدوار جديدة.
 */
export const ACCOUNTING_ROLE_PRESETS: Record<
  "accountant" | "chief_accountant" | "auditor",
  { label: string; desc: string; keys: string[] }
> = {
  accountant: {
    label: "محاسب",
    desc: "إنشاء القيود والسندات والفواتير — بلا اعتماد ولا إقفال",
    keys: [
      "screen_customers", "screen_contracts", "screen_vouchers", "screen_receipts",
      "screen_custody", "screen_invoices", "screen_statement",
      "screen_chart_of_accounts", "screen_journal_entries", "screen_ledger",
      "screen_financial_statements", "screen_bank_recon", "action_add_voucher", "action_edit_voucher",
    ],
  },
  chief_accountant: {
    label: "محاسب رئيسي",
    desc: "كل الشاشات المحاسبية + الاعتماد والإقفال — بلا إدارة المستخدمين",
    keys: [
      "screen_customers", "screen_contracts", "screen_vouchers", "screen_receipts", "screen_payments",
      "screen_custody", "screen_invoices", "screen_statement", "screen_reports",
      "screen_chart_of_accounts", "screen_journal_entries", "screen_ledger",
      "screen_fiscal_close", "screen_financial_statements", "screen_bank_recon", "screen_zakat_xbrl",
      "screen_other_company", "screen_claims",
      "action_add_voucher", "action_edit_voucher", "action_cancel_voucher", "action_add_payment",
    ],
  },
  auditor: {
    label: "مراجع",
    desc: "قراءة كاملة للشاشات والتقارير المالية — بلا أي إجراء تعديل",
    keys: [
      "screen_customers", "screen_contracts", "screen_vouchers", "screen_receipts",
      "screen_custody", "screen_invoices", "screen_statement", "screen_reports",
      "screen_chart_of_accounts", "screen_journal_entries", "screen_ledger",
      "screen_fiscal_close", "screen_financial_statements", "screen_bank_recon", "screen_zakat_xbrl",
      "report_customers_balances", "report_stage_dues", "report_subcontractors",
      "report_cashflow", "report_contracts", "report_journal",
    ],
  },
};

const PERM_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

/** افتراضيات الدور للمفتاح — مرآة role_perm_defaults: المدير والمطور الكل، والسكرتير حسب علم المفتاح المكتبية */
export function roleDefaultAllowed(role: string, permKey: string): boolean {
  if (isSuperRole(role)) return true;
  if (role === "secretary") return PERM_BY_KEY.get(permKey)?.secretary ?? true; // المفتاح المجهول لا يُقيّد (كالمصدر)
  return true;
}

export function isSuperRole(role: string) {
  return role === "admin" || role === "developer";
}
