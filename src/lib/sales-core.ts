/**
 * sales-core.ts — نواة موديول المبيعات النقية (docs/sales-design.md §4) — نقية 100% بلا Prisma ولا React ولا server-only:
 * • حساب سطر البيع posLineTotal — مرآة محرك الفواتير (qty × price × (1−disc%))
 * • خريطة عرض→فاتورة mapQuotationToInvoiceItems — أول مستدعٍ واجهة لمنطق التحويل (د2)
 * • تحقق البيع validatePosSale — جدول قواعد مغلق (G8): النقدي بلا سداد مرفوض، السطر المخزني بلا صنف صحيح مرفوض
 * • تحذير التكلفة underCostLines — قائمة أسماء للتوست الأصفر غير المانع (د9)
 */

import { isIsoDate, r3 } from "./sales-constants";
import { QUOTATION_STATUSES } from "./quotes-core";

// ===== أنواع مشتركة =====

/** سطر نقاط البيع بعد التطبيع — المخزني يحمل itemId والسطر الحر وصفًا حصرًا */
export interface PosLineInput {
  itemId: number | null; // null = سطر حر (بلا صنف — بلا صرف ولا تكلفة — د4)
  description: string; // إلزامي للسطر الحر؛ للمخزني يُشتق من الصنف عند فراغه
  quantity: number;
  unitPrice: number;
  discountPct: number;
  /** بيانات الصنف كما يعيد تعبئتها الخادم قبل التحقق (للتحقق النقي فقط) */
  itemActive?: boolean;
  itemName?: string;
}

export interface PosPaymentInput {
  payNow: boolean;
  /** وسيلة الدفع — تُمرَّر نصيًا لمحرك السندات (normalizeAccount يحسم صندوق/بنك) */
  payMethod?: string;
  payAccount?: string;
}

export interface PosSaleInput {
  warehouseId: number;
  /** العميل المسمّى — الفراغ ⇒ العميل النقدي المبذور (د6) */
  customerId?: number | null;
  /** هل العميل المحصور هو العميل النقدي؟ (يقرره الخادم بعد البذر — يمنع الآجل على النقدي) */
  isCashCustomer?: boolean;
  vdate: string;
  lines: PosLineInput[];
  payment: PosPaymentInput;
}

// ===== حساب سطر البيع (مرآة محرك الفواتير) =====

/** إجمالي السطر = r3(qty × price × (1 − disc/100)) — نفس معادلة buildInvoiceItems حرفيًا */
export function posLineTotal(quantity: number, unitPrice: number, discountPct: number): number {
  const gross = r3(quantity * unitPrice);
  return r3(gross * (1 - discountPct / 100));
}

/** إجمالي البيع = Σ أسطره (يعرضه الخادم بعد بناء البنود محركًا — هنا للواجهة والاختبارات) */
export function posSaleTotal(lines: PosLineInput[]): number {
  return r3(lines.reduce((s, l) => s + posLineTotal(l.quantity, l.unitPrice, l.discountPct), 0));
}

// ===== تحقق البيع (جدول قواعد مغلق — G8) =====

export const POS_WAREHOUSE_REQUIRED = "مستودع البيع مطلوب";
export const POS_LINES_REQUIRED = "أضف بندًا واحدًا على الأقل للبيع";
export const POS_DATE_REQUIRED = "تاريخ البيع مطلوب بصيغة YYYY-MM-DD";
export const POS_PAY_METHOD_REQUIRED = "الدفع الفوري يتطلب وسيلة دفع صحيحة (نقداً/تحويل بنكي)";
export const POS_CREDIT_REQUIRES_CUSTOMER =
  "البيع الآجل يتطلب عميلًا مسمّى — العميل النقدي (نقاط البيع) يُقبض فورًا";
export const POS_STOCK_LINE_REQUIRES_ITEM = "السطر المخزني يتطلب صنفًا صحيحًا — أعِد اختيار الصنف";
export const POS_ITEM_INACTIVE = "الصنف موقوف — لا بيع عليه";

/**
 * تحقق بيع النقطة — يعيد قائمة أخطاء عربية فارغة عند السلامة:
 * • مستودع + تاريخ + بند واحد على الأقل
 * • الكمية > 0 والسعر ≥ 0 والخصم 0–100 لكل سطر
 * • السطر المخزني يلزم itemId صحيحًا نشطًا؛ السطر الحر يلزم وصفًا
 * • الدفع الفوري يلزم وسيلة دفع؛ البيع الآجل مسموح للعميل المسمّى حصرًا (النقدي بلا سند مرفوض — د3)
 */
export function validatePosSale(sale: PosSaleInput): string[] {
  const errors: string[] = [];
  if (!sale.warehouseId || sale.warehouseId <= 0) errors.push(POS_WAREHOUSE_REQUIRED);
  if (!isIsoDate(String(sale.vdate || ""))) errors.push(POS_DATE_REQUIRED);
  if (!Array.isArray(sale.lines) || sale.lines.length === 0) errors.push(POS_LINES_REQUIRED);

  for (const l of sale.lines) {
    const stockIntent = l.itemId != null; // حقل itemId موجود = نية سطر مخزني (حتى لو 0 معطوبًا)
    const label = stockIntent ? `سطر الصنف «${l.itemName || `#${l.itemId}`}»` : "السطر الحر";
    if (!(l.quantity > 0)) errors.push(`${label}: الكمية يجب أن تكون أكبر من صفر`);
    if (!(l.unitPrice >= 0)) errors.push(`${label}: سعر الوحدة لا يكون سالبًا`);
    if (!(l.discountPct >= 0) || l.discountPct > 100) errors.push(`${label}: نسبة الخصم بين 0 و 100`);
    if (stockIntent) {
      if (!l.itemId || l.itemId <= 0) errors.push(POS_STOCK_LINE_REQUIRES_ITEM);
      else if (l.itemActive === false) errors.push(`${label}: ${POS_ITEM_INACTIVE}`);
    } else if (!l.description.trim()) {
      errors.push("كل بند حر يحتاج وصفًا");
    }
  }

  if (sale.payment.payNow) {
    if (!sale.payment.payMethod || !sale.payment.payMethod.trim()) errors.push(POS_PAY_METHOD_REQUIRED);
  } else if (sale.isCashCustomer) {
    errors.push(POS_CREDIT_REQUIRES_CUSTOMER);
  }
  return errors;
}

// ===== تطبيع أسطر البيع من جسم الطلب (نمط cleanQuotationItems) =====

/**
 * تطبيع أسطر نقاط البيع الواردة من العميل: الصفوف الفارغة تُسقط، الأرقام تقرب لثلاث خانات.
 * نية السطر المخزني محفوظة: حقل itemId موجود (حتى لو 0) يعني سطرًا مخزنيًا معطوبًا
 * ⇒ يبقى 0 ويستقبله جدول التحقق برسالة G8 المغلقة — لا يتحول سطرًا حرًا صامتًا.
 */
export function cleanPosLines(raw: unknown): PosLineInput[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: PosLineInput[] = [];
  for (const item of arr) {
    const rec = (item ?? {}) as Record<string, unknown>;
    const hasItemField = rec.itemId !== undefined && rec.itemId !== null && rec.itemId !== "";
    const n = Number(rec.itemId ?? 0);
    const itemId = hasItemField ? (Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0) : null;
    const description = String(rec.description ?? "").trim();
    const quantity = r3(Number(rec.quantity ?? 0));
    const unitPrice = r3(Number(rec.unitPrice ?? 0));
    const discountPct = r3(Number(rec.discountPct ?? 0));
    if (itemId == null && !description && !(quantity > 0)) continue; // صف فارغ — يُسقط دفاعًا
    out.push({
      itemId,
      description,
      quantity,
      unitPrice,
      discountPct,
      itemName: String(rec.itemName ?? "").trim() || undefined,
      itemActive: rec.itemActive === false ? false : undefined,
    });
  }
  return out;
}

// ===== تحذير التكلفة (د9 — توست أصفر غير مانع) =====

export interface UnderCostRow {
  itemId: number;
  name: string;
  price: number;
  wac: number;
}

/** أسطر المخزني المباعة تحت المتوسط المرجحي الحالي — أسماء تُعرض ولا تمنع (د9) */
export function underCostLines(
  lines: PosLineInput[],
  wacOf: (itemId: number) => number,
  eps = 0.001
): UnderCostRow[] {
  const out: UnderCostRow[] = [];
  for (const l of lines) {
    if (!l.itemId || !(l.quantity > 0)) continue;
    const wac = r3(wacOf(l.itemId));
    if (wac > 0 && l.unitPrice < wac - eps) {
      out.push({ itemId: l.itemId, name: l.itemName || `#${l.itemId}`, price: r3(l.unitPrice), wac });
    }
  }
  return out;
}

// ===== خريطة عرض → فاتورة (د2 — أول مستدعٍ واجهة) =====

/** بند فاتورة جاهز للبناء — مرآة InvoiceItemInputRow مع itemId (السطر الحر دائمًا من العروض) */
export interface QuoteToInvoiceRow {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  lineTotal: number;
}

/**
 * ترجمة بنود العرض إلى أسطر فاتورة بخصم صفري — الإجمالي لكل سطر r3(qty × price).
 * العرض بلا بنود يعيد قائمة فارغة (المستدعي يرفضه — العرض بلا بنود مرفوض).
 */
export function mapQuotationToInvoiceItems(
  items: { description: string; quantity: number; unitPrice: number }[]
): QuoteToInvoiceRow[] {
  const out: QuoteToInvoiceRow[] = [];
  for (const it of items) {
    const description = String(it.description ?? "").trim();
    if (!description) continue;
    const quantity = r3(Number(it.quantity ?? 0));
    const unitPrice = r3(Number(it.unitPrice ?? 0));
    out.push({
      description,
      quantity,
      unitPrice,
      discountPct: 0,
      lineTotal: r3(quantity * unitPrice),
    });
  }
  return out;
}

/** مجموع الأسطر المخططة — يتحقق الخادم أنه > 0 قبل الإصدار (الفاتورة الصفرية مرفوضة بالمحرك) */
export function quoteInvoiceTotal(rows: QuoteToInvoiceRow[]): number {
  return r3(rows.reduce((s, r) => s + r.lineTotal, 0));
}

// ===== قابلية تحويل العرض (د2) =====

/**
 * الحالات القابلة للتحويل إلى فاتورة بيع: «جديد» و«مقبول» حصرًا —
 * «مرسل» بانتظار رد العميل، و«مرفوض» و«منتهي» موقفان نهائيًا (§4).
 */
export function quoteConvertible(status: string): boolean {
  return status === "جديد" || status === "مقبول";
}

/** الحالة ضمن مجموعة العروض المعتمدة (مرآة isQuotationStatus — معاد تصديرها للنواة) */
export function isKnownQuoteStatus(status: string): boolean {
  return (QUOTATION_STATUSES as readonly string[]).includes(status);
}
