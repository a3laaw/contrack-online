// ============================================================
// field-execution-core.ts — نواة «التنفيذ الميداني — مقايسة التنفيذ» (بند NOVA 5)
// المرجع: docs/field-execution-design.md — القرار الجوهري (درس G9):
// كل عدادات المقايسة **مشتقة من الصفوف لحظيًا لا مخزنة** — الحذف/التعديل آمن
// دائمًا لأن الاشتقاق يعيد الاحتساب من الصفوف (recount مدمج بالتصميم).
// نواة نقية حصرًا (بلا DB ولا server-only ولا استيرادات خادمية) — قابلة للاختبار مباشرة.
// ============================================================

/** تقريب لثلاث خانات عشرية — مرآة r3 في contrack-core (محلية لتبقى النواة بلا استيرادات) */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** مدخلات صف المقايسة الخام (أرقام محوَّلة من القاعدة) */
export interface TakeoffInputRow {
  boqItemId: number;
  qty: number; // كمية البند الفعلية بعد تطبيق الملحقات
  unitPrice: number;
  plannedQty: number;
  changeQty: number; // نصيب البند من الأوامر التغييرية المعتمدة
  executedQty: number; // Σ سجلات التنفيذ
  documentedQty: number; // Σ سجلات التنفيذ الموثقة
  invoicedQty?: number; // ز1 — المفوتر بالبند: Σ كميات أسطر فواتير العميل غير الملغاة المرتبطة بالبند
}

/** صف المقايسة المشتق (G9 — لا حالة مخزنة) */
export interface TakeoffRow {
  boqItemId: number;
  description?: string;
  contractQty: number; // التعاقدي الأصلي = max(0, qty − changeQty)
  changeQty: number; // التغييري
  effectiveQty: number; // كمية البند الفعلية (الأصل + الملحق المنشأ)
  plannedQty: number; // المخطط
  executedQty: number; // المنفذ
  documentedQty: number; // الموثق
  invoicedQty: number; // المفوتر بالبند (ز1 — من أسطر الفواتير المرتبطة بالبند حصرًا)
  unitPrice: number; // سعر الوحدة — لحساب مجاميع المقايسة
  executedAmount: number; // المنفذ × سعر الوحدة
  progressPct: number; // نسبة الإنجاز — قد تتجاوز 100% عند التنفيذ الزائد (إشارة حقيقية لا خطأ)
}

/**
 * اشتقاق صف المقايسة من مدخلاته الخام:
 * - effectiveQty = qty (كمية البند الفعلية بعد تطبيق الملحقات)
 * - contractQty = max(0, qty − changeQty) — التعاقدي الأصلي بأرضية صفر
 * - executedAmount = r3(executedQty × unitPrice)
 * - progressPct = المنفذ/الفعلي بنسبة مئوية بمنزلة واحدة (غير مقصوصة — موثقة بالتصميم)
 */
export function deriveTakeoffRow(row: TakeoffInputRow): TakeoffRow {
  const effectiveQty = r3(row.qty);
  const changeQty = r3(row.changeQty);
  const contractQty = Math.max(0, r3(effectiveQty - changeQty));
  const executedAmount = r3(row.executedQty * row.unitPrice);
  const progressPct = effectiveQty > 0 ? Math.round((row.executedQty / effectiveQty) * 1000) / 10 : 0;
  return {
    boqItemId: row.boqItemId,
    contractQty,
    changeQty,
    effectiveQty,
    plannedQty: r3(row.plannedQty),
    executedQty: r3(row.executedQty),
    documentedQty: r3(row.documentedQty),
    invoicedQty: r3(row.invoicedQty ?? 0),
    unitPrice: r3(row.unitPrice),
    executedAmount,
    progressPct,
  };
}

/** إحداثيات GPS بعشرية 4–8 منازل ودرجة اختيارية سالبة */
export const GPS_RE = /^-?\d{1,3}\.\d{4,8}$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ExecutionInput {
  executionDate?: unknown;
  qty?: unknown;
  gpsLat?: unknown;
  gpsLng?: unknown;
  note?: unknown;
}

export interface ExecutionCheck {
  ok: boolean;
  error?: string;
  value?: { executionDate: string; qty: number; gpsLat: string; gpsLng: string; note: string };
}

/** تحقق إدخال سجل تنفيذ — رسائل عربية تُعرض كما هي في الواجهة والمسار */
export function validateExecutionInput(input: ExecutionInput): ExecutionCheck {
  const executionDate = typeof input.executionDate === "string" ? input.executionDate.trim() : "";
  if (!DATE_RE.test(executionDate)) {
    return { ok: false, error: "تاريخ التنفيذ مطلوب بصيغة YYYY-MM-DD" };
  }
  const qty = typeof input.qty === "string" ? Number(input.qty) : (input.qty as number);
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "كمية التنفيذ يجب أن تكون أكبر من صفر" };
  }
  const normGps = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) return "";
    return GPS_RE.test(s) ? s : null;
  };
  const gpsLat = normGps(input.gpsLat);
  if (gpsLat === null) return { ok: false, error: "إحداثيات GPS غير صالحة" };
  const gpsLng = normGps(input.gpsLng);
  if (gpsLng === null) return { ok: false, error: "إحداثيات GPS غير صالحة" };
  const note = typeof input.note === "string" ? input.note.trim() : "";
  return { ok: true, value: { executionDate, qty: r3(qty), gpsLat, gpsLng, note } };
}

export interface TakeoffTotals {
  contractAmount: number;
  changeAmount: number;
  plannedAmount: number;
  executedAmount: number;
  documentedAmount: number;
  invoicedAmount: number;
  collectedAmount: number;
  progressPct: number;
}

/**
 * مجاميع المقايسة على مستوى العقد:
 * - plannedAmount = Σ plannedQty×unitPrice (المخطط قد يتجاوز الفعلي بقصد — لا يُقص)
 * - progressPct = المنفذ/(التعاقدي + التغييري) بمنزلة واحدة — صفر على قاعدة صفر
 * - المفوتر/المحصّل على مستوى العقد حصرًا (Σ فواتير غير ملغاة) — تُمرَّر كما هي
 */
export function summarizeTakeoff(rows: TakeoffRow[], invoicedAmount: number, collectedAmount: number): TakeoffTotals {
  let contractAmount = 0;
  let changeAmount = 0;
  let plannedAmount = 0;
  let executedAmount = 0;
  let documentedAmount = 0;
  for (const r of rows) {
    contractAmount += r.contractQty * r.unitPrice;
    changeAmount += r.changeQty * r.unitPrice;
    plannedAmount += r.plannedQty * r.unitPrice;
    executedAmount += r.executedAmount;
    documentedAmount += r.documentedQty * r.unitPrice;
  }
  contractAmount = r3(contractAmount);
  changeAmount = r3(changeAmount);
  plannedAmount = r3(plannedAmount);
  executedAmount = r3(executedAmount);
  documentedAmount = r3(documentedAmount);
  const base = r3(contractAmount + changeAmount);
  const progressPct = base > 0 ? Math.round((executedAmount / base) * 1000) / 10 : 0;
  return {
    contractAmount,
    changeAmount,
    plannedAmount,
    executedAmount,
    documentedAmount,
    invoicedAmount: r3(invoicedAmount),
    collectedAmount: r3(collectedAmount),
    progressPct,
  };
}
