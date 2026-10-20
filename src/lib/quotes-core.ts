/**
 * عروض الأسعار — بند 12 من المرحلة 9 (منطق نقي قابل للاختبار).
 * المصدر المكتبي: app/services/lifecycle_service.py:4774-4884
 *   (add_quotation/list_quotations/get_quotation/set_quotation_status/
 *    convert_quotation_to_contract) + next_quote_number (:96)
 *   + database_schema_postgresql.sql §49-50.
 *
 * اكتشاف النطاق الموثق: لا شاشة ولا حوار لإدارة عروض الأسعار في واجهة المكتبي —
 * الدوال بلا مستدعٍ واجهة (الاختبارات فقط)، والموضعان الوحيدان في الواجهة:
 * مركز نماذج Word يختار عرضًا كمصدر تعبئة (word_forms_center.py:481/1299
 * — بند 9 لاحقًا) ولا يديرها. لذلك: حوار إدارة خفيف داخل شاشة العملاء (الحاضنة)
 * + دورة الحالة، وبوابة screen_customers (لا مدخل لعروض الأسعار في PAGE_PERMS).
 *
 * دورة الحالة المكتبية: set_quotation_status (:4845) بلا مصفوفة انتقالات —
 * أي حالة من المجموعة تصلح لأي أخرى، وغير ذلك ⇒ «حالة عرض السعر غير صحيحة.»
 * و«مقبول» بلا أي أثر جانبي (لا سند ولا عقد — لا شيء في تدفق العروض ينشئ سندات
 * إطلاقًا؛ التحويل دالة صريحة convert_quotation_to_contract بلا مستدعٍ واجهة
 * وبلا عمود contract_id في المخطط المرجعي فخارج نطاق الويب).
 *
 * الترقيم المكتبي: next_quote_number() = _next_number("quotations",
 * "quote_number", "QUO") ⇒ QUO-%04d (lifecycle_service.py:96).
 */

import { round3 } from "@/lib/format";

/** بادئة رقم العرض المكتبية (next_quote_number — QUO-%04d) */
export const QUOTATION_NUMBER_PREFIX = "QUO";

/**
 * الترقيم الآلي (QUO-%04d): يقرأ أعلى رقم موجود ويزيد 1؛
 * بلا سابق أو بصيغة تالفة ⇒ QUO-0001.
 */
export function nextQuotationNumber(last?: string | null): string {
  let n = 1;
  if (last) {
    const m = last.match(/QUO-(\d+)/);
    if (m) {
      const parsed = parseInt(m[1], 10);
      if (Number.isFinite(parsed)) n = parsed + 1;
    }
  }
  return `QUO-${String(n).padStart(4, "0")}`;
}

/** الافتراضي من المخطط المرجعي: status VARCHAR(20) DEFAULT 'جديد' */
export const QUOTATION_STATUS_DEFAULT = "جديد";

/**
 * حالات عرض السعر — قيم المخطط المرجعي §49 (مرجع الويب) حرفيًا:
 * «جديد','مرسل','مقبول','مرفوض','منتهي». (المكتبي SQLite بسبع حالات
 * QUOTE_STATUSES بافتراضي «مسودة» — المواءمة للمخطط المرجعي كما في بند المشاريع.)
 */
export const QUOTATION_STATUSES = ["جديد", "مرسل", "مقبول", "مرفوض", "منتهي"] as const;

/** رسالة الحالة غير الشرعية الحرفية من set_quotation_status (lifecycle_service.py:4847) */
export const QUOTATION_INVALID_STATUS = "حالة عرض السعر غير صحيحة.";

/** رسالة إلزامية العميل الحرفية من add_quotation (lifecycle_service.py:4781) */
export const QUOTATION_CUSTOMER_REQUIRED = "يجب اختيار العميل.";

/** رسالة إلزامية البنود الحرفية من add_quotation (lifecycle_service.py:4782) */
export const QUOTATION_ITEMS_REQUIRED = "يجب إضافة بند واحد على الأقل لعرض السعر.";

/** هل الحالة من مجموعة العروض المعتمدة؟ (مرآة تحقق set_quotation_status) */
export function isQuotationStatus(status: unknown): status is (typeof QUOTATION_STATUSES)[number] {
  return (QUOTATION_STATUSES as readonly string[]).includes(String(status));
}

/**
 * الانتقال الشرعي — المكتبي بلا مصفوفة: أي حالة من المجموعة تصلح لأي أخرى.
 * غير الشرعي = الحالة الهدف خارج المجموعة إطلاقًا (والرسالة الحرفية أعلاه).
 */
export function quotationTransitionAllowed(from: string, to: string): boolean {
  return isQuotationStatus(to);
}

/** ألوان الشارات — مفردات STATUS_COLORS المكتبية (منتهي بنفسجي · مرفوض أحمر · مرسل أزرق · جديد رمادي) */
export const QUOTATION_STATUS_FALLBACK_CLASS = "bg-secondary text-secondary-foreground";

export function quotationStatusBadgeClass(status: string): string {
  switch (status) {
    case "مرسل":
      return "bg-status-info-bg text-status-info";
    case "مقبول":
    case "منتهي":
      return "bg-status-done-bg text-status-done";
    case "مرفوض":
      return "bg-status-danger-bg text-status-danger";
    default:
      return QUOTATION_STATUS_FALLBACK_CLASS; // «جديد» وغير المعروف رمادي كالمكتبي
  }
}

/** تنظيف وصف العرض/ملاحظاته (TEXT): تشذيب فقط بلا سقط */
export function cleanQuotationText(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** تاريخ YYYY-MM-DD أو "" — نمط parseDay الموحد (valid_until DATE) */
export function cleanQuotationDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? "" : s;
}

/** معرف العميل: رقم صحيح موجب (customer_id NOT NULL مع RESTRICT في المخطط المرجعي) */
export function cleanQuotationCustomerId(raw: unknown): number | null {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** معرف المشروع: رقم صحيح موجب أو null (project_id اختياري مع SET NULL) */
export function cleanQuotationProjectId(raw: unknown): number | null {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** كمية/سعر: رقم غير سالب مقرَّب لثلاث خانات (DECIMAL(15,3) — عتبة 0.001) */
export function cleanQuotationAmount(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round3(n);
}

/** بند عرض السعر بعد التطبيع (مرآة quotation_items: وصف · وحدة · كمية · سعر · إجمالي · ترتيب) */
export interface QuotationItemInput {
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sortOrder: number;
}

/**
 * تطبيع بنود العرض: الوصف إلزامي للبند (الصفوف الفارغة تُسقط دفاعًا —
 * الواجهة لا تُرسلها)، والوحدة نص حر، والكمية/السعر غير سالبة بثلاث خانات،
 * وإجمالي البند = كمية × سعر (العمود المولَّد GENERATED STORED في §50).
 */
export function cleanQuotationItems(raw: unknown): QuotationItemInput[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: QuotationItemInput[] = [];
  for (const item of arr) {
    const rec = (item ?? {}) as Record<string, unknown>;
    const description = String(rec.description ?? "").trim();
    if (!description) continue;
    const quantity = cleanQuotationAmount(rec.quantity);
    const unitPrice = cleanQuotationAmount(rec.unitPrice);
    out.push({
      description,
      unit: String(rec.unit ?? "").trim(),
      quantity,
      unitPrice,
      totalPrice: round3(quantity * unitPrice),
      sortOrder: out.length,
    });
  }
  return out;
}

/**
 * إجمالي العرض = مجموع بنوده (مطابق لحساب subtotal في list_quotations/
 * get_quotation والعلم GENERATED في §50) — دون خصم أو ضريبة (لا حقول لهما
 * في المخطط المرجعي §49 بخلاف SQLite المكتبية).
 */
export function computeItemsTotal(items: QuotationItemInput[]): number {
  return round3(items.reduce((sum, it) => sum + it.totalPrice, 0));
}

/** مطابقة الإجمالي بعتبة النظام الموحدة 0.001 */
export function itemsMatchTotal(total: number, items: QuotationItemInput[]): boolean {
  return Math.abs(total - computeItemsTotal(items)) < 0.001;
}

/** صف عرض السعر كما يعيده الـAPI (التواريخ نصوص والأموال أرقام) */
export interface QuotationItemRow {
  id: number;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sortOrder: number;
}

export interface QuotationRow {
  id: number;
  quotationNumber: string;
  customerId: number;
  customerName: string;
  projectId: number | null;
  projectName: string;
  description: string;
  totalAmount: number;
  status: string;
  validUntil: string;
  notes: string;
  createdBy: number | null;
  createdByName: string;
  itemsCount: number;
  items?: QuotationItemRow[];
  createdAt?: string;
  updatedAt?: string;
}

/** ترتيب القائمة المكتبية: ORDER BY q.id DESC (lifecycle_service.list_quotations) */
export function sortQuotationsDesc(rows: QuotationRow[]): QuotationRow[] {
  return [...rows].sort((a, b) => b.id - a.id);
}
