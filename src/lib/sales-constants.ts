/**
 * sales-constants.ts — ثوابت موديول المبيعات (docs/sales-design.md §4) — نقي 100% بلا DB ولا React:
 * • حساب 5116 «تكلفة المبيعات» للبذر المؤجل (شقيق 5110 — د4)
 * • تسمية العميل النقدي المبذور مؤجلًا (د6) وعلامة التحويل بالملاحظات (د2)
 * • وسائل الدفع الفوري للنقطة (ترمي على الحسابات النصية للسندات — صندوق/بنك — د7)
 */

/** تقريب مالي موحد — د.ك ثلاثي العشرة (نفس r3 في بقية الثوابت) */
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** حسابات البذر المؤجل للمبيعات (د4 — نمط ensureOne في hr-server وwarehouses-server) */
export const SALES_ACCOUNTS = {
  salesCost: { code: "5116", name: "تكلفة المبيعات", type: "expense", xbrl: "kw:CostOfSales" },
} as const;

/** العميل النقدي المبذور عند أول بيع بلا عميل مسمّى (د6) */
export const CASH_CUSTOMER_NAME = "عميل نقدي — نقاط البيع";
/** علامة التمييز في ملاحظات العميل (نمط المفاتيح الثابتة) */
export const CASH_CUSTOMER_NOTE = "بذر آلي — موديول المبيعات (عميل نقدي نقاط البيع — د6)";

/** علامة التحويل في ملاحظات العرض — تمنع التحويل المزدوج (د2) */
export const QUOTE_CONVERT_MARKER = "تحويل إلى الفاتورة";

/** وسائل الدفع الفوري للنقطة — تُمرَّر نصيًا لمحرك السندات (normalizeAccount يحسم صندوق/بنك) */
export const POS_PAY_METHODS = ["نقداً", "تحويل بنكي"] as const;
export type PosPayMethod = (typeof POS_PAY_METHODS)[number];

/** التسميات العربية لوسائل الدفع في الواجهة — القيمة نفسها تُرسل للسند */
export const POS_PAY_METHOD_LABELS: Record<PosPayMethod, string> = {
  "نقداً": "نقداً (صندوق)",
  "تحويل بنكي": "تحويل بنكي (بنك)",
};

/** وسائل الدفع التي تُدرج تاريخ استحقاق الشيك — غير مستخدمة في النقطة v1 */
export function isPosPayMethod(v: unknown): v is PosPayMethod {
  return (POS_PAY_METHODS as readonly string[]).includes(String(v));
}

/** قيم حالة بيع النقطة للعرض في شريط اليوم — موحدة مع حالات الفواتير القائمة */
export const POS_INVOICE_DESCRIPTION = "بيع نقاط البيع";

/** تسميات حالات الفاتورة كما تظهر في شريط مبيعات اليوم (مرآة INVOICE_STATUS_LABELS) */
export const POS_STATUS_LABELS: Record<string, string> = {
  unpaid: "غير مسددة",
  partial: "مسددة جزئيًا",
  paid: "مسددة",
  void: "ملغاة",
};

// ===== منسقات عرض =====
/** منسق الكميات — حتى 3 خانات وإزالة الأصفار الزائدة (0.500 ⇒ «0.5») */
export function fmtQty(n: number): string {
  const v = r3(n);
  if (Object.is(v, -0)) return "0";
  return String(v);
}

/** فحص تاريخ ISO بسيط (YYYY-MM-DD) — الأنماط القائمة كلها تاريخ نصي */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
