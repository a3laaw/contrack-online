/**
 * purchase-core.ts — النواة النقية لر4 «الموردون وأوامر الشراء» (docs/purchase-design.md §4):
 * دوال خالصة بلا DB ولا React — تُختبَر bun قبل أي ربط (نمط consulting-v1).
 * r3 هنا نسخة نقية محلية (تطابق r3 في warehouses-constants) ليبقى النواة بلا استيراد خادمي.
 */

import {
  PO_CANCEL_BLOCKED_RECEIVED,
  PO_RECEIVE_ENTRY_SOURCE,
  poTransitionAllowed,
} from "./purchase-constants";

/** تقريب 3 منازل عشرية — مطابقة r3 القائمة (مبالغ الكويت د.ك بثلاث) */
export function r3(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

/** سطر أمر شراء كما يحتاجه الحساب النقي (المبالغ أرقام) */
export interface PoLineLike {
  itemId: number;
  qty: number;
  receivedQty: number;
  unitPrice: number;
}

/** كمية الباقي من السطر — لا سالب أبدًا */
export function poLineRemaining(line: PoLineLike): number {
  return Math.max(0, r3(Number(line.qty) - Number(line.receivedQty)));
}

/**
 * حارس الزيادة (د4) — المستلم + الجديد لا يتجاوز المطلوب:
 * يعيد ok أو رسالة عربية تحمل الصنف والمستلم والمطلوب (أسلوب رسائل المخازن).
 */
export function assertReceiptLine(
  line: PoLineLike & { itemName?: string },
  newQty: number
): { ok: true; remainingAfter: number } | { ok: false; error: string } {
  const name = String(line.itemName || `الصنف #${line.itemId}`);
  const qty = Number(line.qty) || 0;
  const received = Number(line.receivedQty) || 0;
  const add = Number(newQty) || 0;
  if (add <= 0) return { ok: false, error: `كمية الاستلام للصنف «${name}» يجب أن تكون أكبر من صفر.` };
  const after = r3(received + add);
  if (after > qty + 1e-9) {
    return {
      ok: false,
      error: `كمية الاستلام تتجاوز المطلوب للصنف «${name}» — المطلوب ${qty} والمستلم سابقًا ${received} والمحاول الآن ${add}.`,
    };
  }
  return { ok: true, remainingAfter: r3(Math.max(0, qty - after)) };
}

/** حالة الأمر اشتقاقيًا بعد استلام (د3): اكتملت كل السطور ⇒ «مستلم» وإلا «جزئي» */
export function poStatusAfterReceipt(lines: PoLineLike[]): "جزئي" | "مستلم" {
  const complete = lines.length > 0 && lines.every((l) => Number(l.receivedQty) + 1e-9 >= Number(l.qty));
  return complete ? "مستلم" : "جزئي";
}

/** مجموع قيمة المستلم على الأمر بعد إضافة كمية استلام جديدة (تجمّد على الرأس — د2 الفلسفة) */
export function poReceivedAmountAfter(lines: PoLineLike[], receipts: { itemId: number; qty: number }[]): number {
  const byItem = new Map<number, number>();
  for (const r of receipts) byItem.set(r.itemId, (byItem.get(r.itemId) || 0) + (Number(r.qty) || 0));
  const total = lines.reduce(
    (s, l) => s + r3(Math.min(Number(l.qty), Number(l.receivedQty) + (byItem.get(l.itemId) || 0)) * Number(l.unitPrice)),
    0
  );
  return r3(total);
}

/** إجمالي الأمر المجمّد — = r3(Σ كمية×سعر) لكل السطور */
export function poTotalAmount(lines: Pick<PoLineLike, "qty" | "unitPrice">[]): number {
  return r3(lines.reduce((s, l) => s + r3(Number(l.qty) * Number(l.unitPrice)), 0));
}

/** هل الإلغاء مسموح على هذا الأمر؟ — مرفوض على المستلم منه جزئيًا أو الكلي (د3/جدول المسارات) */
export function assertCancelAllowed(status: string, receivedAmount: number):
  | { ok: true }
  | { ok: false; error: string } {
  if (r3(Number(receivedAmount) || 0) > 0) return { ok: false, error: PO_CANCEL_BLOCKED_RECEIVED };
  if (!poTransitionAllowed(status, "ملغى")) {
    return { ok: false, error: `انتقال حالة أمر الشراء غير مسموح (من ${status} إلى ملغى).` };
  }
  return { ok: true };
}

/** نوع إذن الإدخال عند الاستلام — ثابت ائتماني (تصدير للخادم بلا سحر نصي G7) */
export const RECEIVE_ENTRY_SOURCE = PO_RECEIVE_ENTRY_SOURCE;

/** تنظيف نص حر (اسم مورد/ملاحظات) — تشذيب بلا سقط، حد 500 حرف */
export function cleanPurchaseText(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 500);
}

/** تحقق التاريخ YYYY-MM-DD (فراغ مسموح للمتوقع؛ orderDate إلزامي يفحص بالخادم) */
export function cleanPurchaseDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** مؤشرات الملخص الاشتقاقية (G9 — بلا جداول عدادات) */
export interface PurchaseSummaryRow {
  status: string;
  totalAmount: number;
  receivedAmount: number;
  supplierId: number;
  active: boolean;
}

export interface PurchaseKpis {
  openCount: number;
  openValue: number;
  receivedValue: number;
  activeSuppliers: number;
}

/** حساب خالص: الأوامر المفتوحة (مسودة/مرسل للمورد/جزئي) بقيمها + قيمة المستلم الكلية + الموردون النشطون */
export function purchaseKpis(rows: PurchaseSummaryRow[]): PurchaseKpis {
  let openCount = 0;
  let openValue = 0;
  let receivedValue = 0;
  const suppliers = new Set<number>();
  for (const r of rows) {
    const total = Number(r.totalAmount) || 0;
    const received = Number(r.receivedAmount) || 0;
    if (r.status === "مسودة" || r.status === "مرسل للمورد" || r.status === "جزئي") {
      openCount += 1;
      openValue += total;
    }
    receivedValue += received;
    if (r.active) suppliers.add(Number(r.supplierId) || 0);
  }
  return {
    openCount,
    openValue: r3(openValue),
    receivedValue: r3(receivedValue),
    activeSuppliers: suppliers.size,
  };
}
