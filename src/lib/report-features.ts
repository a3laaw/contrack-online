/**
 * بوابة المزايا للتقارير (المرحلة 3/ب) — مطابقة المكتبي feature_service.py:
 * كل تقرير مفتاح ميزة مستقل (rep_*) وتعطيله يوقف التقرير خادميًا ويخفي بندَه
 * من القائمة الجانبية — كالشجرة المكتبية.
 *
 * المفاتيح المكتبية العشرة: rep_customers · rep_dues_board · rep_supervision_delay ·
 * rep_subcontractors · rep_vouchers · rep_journal · rep_contracts · rep_cashflow ·
 * rep_leads · rep_execution (مفعّل دائمًا FORCED_ON).
 *
 * استثناء موثق: «تفصيل المصروفات» (expenses) لا مفتاحًا مكتبيًا لها في
 * feature_service (لا rep_expenses) — فلا بوابة ميزة لها، والصلاحية report_expenses تكفي.
 */
export const REPORT_FEATURE: Record<string, string> = {
  "customers-balances": "rep_customers",
  "stage-dues": "rep_dues_board",
  "supervision-delays": "rep_supervision_delay",
  subcontractors: "rep_subcontractors",
  vouchers: "rep_vouchers",
  cashflow: "rep_cashflow",
  contracts: "rep_contracts",
  execution: "rep_execution",
  leads: "rep_leads",
  journal: "rep_journal",
};
