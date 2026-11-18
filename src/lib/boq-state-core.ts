// ============================================================
// boq-state-core.ts — نواة ز3 النقية (بلا I/O)
// ------------------------------------------------------------
// docs/boq-state-timeline-design.md §4 — محرك الحالة الزمنية لـ BOQ:
//  • السابق = Σ كميات أسطر المستخلصات المعتمدة (approveAt ≤ asOf في الوضع التاريخي)
//  • الحالي = Σ كميات أسطر المسودات/المقدم المنشأة ≤ asOf + المعتمد بعد asOf
//    (كان «حاليًا» عند التاريخ ثم أغلقته اعتمادات أحدث = «ساق»)
//  • بنية as-of: بند يظهر ⟺ لم يُحذف بملحق معتمد approvedDate ≤ asOf،
//    والمضاف بملحق معتمد ≤ asOf يدخل (deletedAddendumId يُفك إلى تاريخ اعتماد ملحقه)
//  • النسبة الكلية قد تتجاوز 100٪ (تنفيذ زائد — إشارة حقيقية لا تُخفى، نمط field-execution §4)
// قرار الحساب: السابق مجموع كميات الأسطر (مطابق لعداد takeoff وinvoice-server حرفيًا —
// لا مجاميع لقطات cumulativeQty التي تتضاعف عبر فواتير متعددة)، واللقطات تبقى
// إثبات اللحظة والعرض لا مصدر الاشتقاق.
// حدود v1 معلنة (§7): التواريخ نصوص YYYY-MM-DD مقارنة نصية آمنة · الحذف اليدوي
// (deleted=true بلا ملحق) خارج الاسترجاع الزمني · الاستيراد بلا حدث مؤرخ في القاعدة
// فلا يظهر في التايملاين — كلها حدود موثقة لا فجوات خفية.
// كل الدوال نقية قابلة للاختبار المباشر (نمط *-core.ts الموحد)
// ============================================================

import { r3 } from "./contrack-core";
import { INV_STATE_APPROVED, INV_STATE_DRAFT, INV_STATE_SUBMITTED } from "./invoice-state-core";

// ==================== مدخلات — مرآة ما يجلبهم المسار من القاعدة ====================

export interface BoqStateItemInput {
  id: number;
  itemNo: string;
  divisionCode: string;
  divisionName: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
  deleted: boolean;
  deletedAddendumId: number;
}

export interface BoqStateAddendumInput {
  id: number;
  addendumNumber: string;
  /** YYYY-MM-DD — الفراغ = ملحق غير معتمد (لا يؤثر على البنية الزمنية) */
  approvedDate: string;
}

export interface BoqStateAddendumItemInput {
  addendumId: number;
  /** add|delete|unlink */
  action: string;
  /** البند المُنشأ بملحق add */
  createdItemId: number;
  /** البند المستهدف بحذف/استرجاع */
  boqItemId: number | null;
  /** إن كان هذا السطر استرجاعًا لعميل محذوف: رقم ملحق الحذف المُسترجَع */
  restoreDeletedBy: number;
}

export interface BoqStateInvoiceInput {
  id: number;
  invoiceNumber: string;
  /** YYYY-MM-DD — تاريخ المنشأة (مرآة الواقع التجاري — حد §7.2 للمسودات: قيمها الراهنة) */
  invoiceDate: string;
  state: string;
  /** void مستبعدة من كل الاشتقاقات */
  status: string;
  /** YYYY-MM-DD (ز2 يخزن toISOString().slice(0,10)) */
  submitAt: string;
  approveAt: string;
  total: number;
}

export interface BoqStateLineInput {
  invoiceId: number;
  boqItemId: number | null;
  quantity: number;
}

// ==================== مخرجات ====================

export interface BoqStateRow {
  id: number;
  itemNo: string;
  divisionCode: string;
  divisionName: string;
  description: string;
  unit: string;
  /** التعاقدي الظاهر عند asOf (البنية الزمنية) — القيم الحالية للبند نفسه (حد §7) */
  qty: number;
  unitPrice: number;
  amount: number;
  visible: boolean;
  priorQty: number;
  currentQty: number;
  /** التعاقدي − السابق (المسودة لا تحجز — نفس دلالة حارس الفواتير القائم) */
  availableQty: number;
  /** (سابق+حالي) ÷ تعاقدي × 100 — قد تتجاوز 100 */
  totalPct: number;
  priorAmount: number;
  currentAmount: number;
}

export interface BoqStateDivisionRow {
  divisionCode: string;
  divisionName: string;
  itemsCount: number;
  contractAmount: number;
  priorAmount: number;
  currentAmount: number;
  pct: number;
}

export interface BoqStateTotals {
  contractAmount: number;
  priorAmount: number;
  currentAmount: number;
  pct: number;
}

/** دور المستخلص عند asOf — وقود شارة «ساق» في الوضع التاريخي */
export interface BoqStateInvoiceRow {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  /** الولاية الراهنة المخزنة (وليست ولاته التاريخية — التاريخية يعبئها role) */
  state: string;
  approveAt: string;
  total: number;
  /** سابق = معتمد ≤ asOf · حالي = موجود ≤ asOf ولم يُعتمد بعد · لاحق = منشأ بعد asOf */
  role: "سابق" | "حالي" | "لاحق";
  /** كان «حاليًا» عند asOf ثم أغلقته اعتمادات أحدث — «أصبح ساقًا» */
  sakat: boolean;
}

export interface DeriveBoqStateResult {
  asOf: string | null;
  items: BoqStateRow[];
  divisions: BoqStateDivisionRow[];
  totals: BoqStateTotals;
  invoices: BoqStateInvoiceRow[];
}

// ==================== أدوات التاريخ والبنية ====================

/** الجزء التاريخي من أي نص مخزن — المقارنات النصية آمنة على المفردة الموحدة YYYY-MM-DD */
export function datePart10(s: string): string {
  return (s || "").slice(0, 10);
}

/** بنية البند الزمنية المشتقة من الملاحق المعتمدة */
export interface BoqItemStructure {
  /** تاريخ اعتماد ملحق الإنشاء — null = بند أساسي موجود منذ البداية */
  createdDate: string | null;
  /** تاريخ اعتماد ملحق الحذف — null = غير محذوف بملحق */
  deletedDate: string | null;
  /** تاريخ اعتماد ملحق الاسترجاع — null = لم يُسترجَع */
  restoreDate: string | null;
}

/**
 * خريطة بنية البنود من الملاحق المعتمدة حصرًا (approvedDate غير فارغ):
 *  • الإنشاء: AddendumItem.action=add && createdItemId>0
 *  • الحذف: BoqItem.deletedAddendumId (يُفك إلى تاريخ اعتماد ملحقه — §4)
 *  • الاسترجاع: AddendumItem.restoreDeletedBy>0 على البند المستهدف
 */
export function deriveBoqItemStructure(
  items: BoqStateItemInput[],
  addendums: BoqStateAddendumInput[],
  addendumItems: BoqStateAddendumItemInput[]
): Map<number, BoqItemStructure> {
  const approvedDateById = new Map<number, string>();
  for (const a of addendums) {
    if (a.approvedDate) approvedDateById.set(a.id, datePart10(a.approvedDate));
  }
  const struct = new Map<number, BoqItemStructure>();
  for (const it of items) struct.set(it.id, { createdDate: null, deletedDate: null, restoreDate: null });

  for (const ai of addendumItems) {
    const approved = approvedDateById.get(ai.addendumId);
    if (!approved) continue; // ملحق غير معتمد — لا أثر زمني
    if (ai.action === "add" && ai.createdItemId > 0) {
      const s = struct.get(ai.createdItemId);
      // أول اعتماد إنشاء هو الفعّال (الملاحق لا تعيد إنشاء البند نفسه — الحارس القائم يمنعه)
      if (s && (s.createdDate === null || approved < s.createdDate)) s.createdDate = approved;
    }
    if (ai.restoreDeletedBy > 0 && ai.boqItemId != null && ai.boqItemId > 0) {
      const s = struct.get(ai.boqItemId);
      if (s && (s.restoreDate === null || approved < s.restoreDate)) s.restoreDate = approved;
    }
  }
  for (const it of items) {
    if (it.deletedAddendumId > 0) {
      const s = struct.get(it.id);
      const d = approvedDateById.get(it.deletedAddendumId);
      if (s && d) s.deletedDate = d;
    }
  }
  return struct;
}

/** ظهور البند عند asOf (null = الحاضر — مطابق لفلتر GET /boq الحرفي: غير المحذوف ناعمًا) */
export function boqItemVisibleAt(
  struct: BoqItemStructure | undefined,
  item: Pick<BoqStateItemInput, "deleted" | "deletedAddendumId">,
  asOf: string | null
): boolean {
  if (asOf === null) return !item.deleted;
  // تاريخي: الحذف اليدوي بلا ملحق بلا تاريخ يُفكَّ — خارج الاسترجاع (حد v1 موثق)
  if (item.deleted && item.deletedAddendumId === 0) return false;
  if (struct?.createdDate && struct.createdDate > asOf) return false; // لم يُضف بعد
  if (struct?.deletedDate && struct.deletedDate <= asOf) {
    // الحذف نافذ عند التاريخ — يظهر فقط إن سبقه استرجاع معتمد ≤ asOf
    if (!(struct.restoreDate && struct.restoreDate <= asOf)) return false;
  }
  return true;
}

// ==================== المحرك الرئيس ====================

/** نسبة بأرضية صفر ومنزلة عشرية واحدة — قد تتجاوز 100 عمدًا (تنفيذ زائد) */
export function pctOf(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * محرك الحالة الزمنية الكاملة (§4) — بنية as-of + سابق/حالي/نسبة/متاح لكل بند
 * + إجماليات القسم والعقد + أدوار المستخلصات عند التاريخ (شارات ساق).
 */
export function deriveBoqState(input: {
  asOf: string | null;
  items: BoqStateItemInput[];
  addendums: BoqStateAddendumInput[];
  addendumItems: BoqStateAddendumItemInput[];
  invoices: BoqStateInvoiceInput[];
  lines: BoqStateLineInput[];
}): DeriveBoqStateResult {
  const { asOf } = input;
  const struct = deriveBoqItemStructure(input.items, input.addendums, input.addendumItems);

  // أدوار المستخلصات عند التاريخ + رصيد «ساق»
  const invoices: BoqStateInvoiceRow[] = input.invoices
    .filter((inv) => inv.status !== "void")
    .map((inv) => {
      const approved = inv.state === INV_STATE_APPROVED;
      const inFlight = inv.state === INV_STATE_DRAFT || inv.state === INV_STATE_SUBMITTED;
      const invDate = datePart10(inv.invoiceDate);
      // ز2: الإنشاء الفوري (بلا مسودة) معتمد بنشر قيده لحظة الإصدار — لحظة اعتماده الفعلية =
      // تاريخ الفاتورة نفسها (approveAt فارغ لأن التأشيرة تُكتب بمسار الاعتماد حصرًا)
      const approveDate =
        datePart10(inv.approveAt) || (approved ? datePart10(inv.invoiceDate) : "");
      if (asOf === null) {
        return { ...inv, role: approved ? ("سابق" as const) : ("حالي" as const), sakat: false };
      }
      if (approved && approveDate && approveDate <= asOf) {
        return { ...inv, role: "سابق" as const, sakat: false };
      }
      if (invDate > asOf) {
        return { ...inv, role: "لاحق" as const, sakat: false };
      }
      // موجود عند التاريخ ولم يُعتمد بعد (مسودة/مقدم) أو اعتماده لاحق للتاريخ (ساق)
      return { ...inv, role: "حالي" as const, sakat: approved };
    });

  // تجميع السابق/الحالي لكل بند من أسطر المستخلصات حسب الدور
  const priorByItem = new Map<number, number>();
  const currentByItem = new Map<number, number>();
  const roleById = new Map(invoices.map((inv) => [inv.id, inv.role]));
  for (const l of input.lines) {
    if (l.boqItemId == null || l.boqItemId <= 0) continue; // سطر حر
    if (!(l.quantity > 0)) continue;
    const role = roleById.get(l.invoiceId);
    if (role === "سابق") priorByItem.set(l.boqItemId, r3((priorByItem.get(l.boqItemId) || 0) + Number(l.quantity)));
    if (role === "حالي") currentByItem.set(l.boqItemId, r3((currentByItem.get(l.boqItemId) || 0) + Number(l.quantity)));
  }

  const rows: BoqStateRow[] = input.items.map((it) => {
    const visible = boqItemVisibleAt(struct.get(it.id), it, asOf);
    const prior = priorByItem.get(it.id) || 0;
    const current = currentByItem.get(it.id) || 0;
    const qty = Math.max(0, Number(it.qty) || 0);
    const price = Math.max(0, Number(it.unitPrice) || 0);
    return {
      id: it.id,
      itemNo: it.itemNo,
      divisionCode: it.divisionCode,
      divisionName: it.divisionName,
      description: it.description,
      unit: it.unit,
      qty,
      unitPrice: price,
      amount: r3(qty * price),
      visible,
      priorQty: r3(prior),
      currentQty: r3(current),
      availableQty: r3(Math.max(0, qty - prior)),
      totalPct: pctOf(prior + current, qty),
      priorAmount: r3(prior * price),
      currentAmount: r3(current * price),
    };
  });

  // إجماليات الأقسام (البنود الظاهرة حصرًا) — التجميع بالكود، والاسم أول ظهور
  const divisions = new Map<string, BoqStateDivisionRow>();
  for (const r of rows) {
    if (!r.visible) continue;
    const key = r.divisionCode || "—";
    let d = divisions.get(key);
    if (!d) {
      d = {
        divisionCode: r.divisionCode,
        divisionName: r.divisionName,
        itemsCount: 0,
        contractAmount: 0,
        priorAmount: 0,
        currentAmount: 0,
        pct: 0,
      };
      divisions.set(key, d);
    }
    d.itemsCount += 1;
    d.contractAmount = r3(d.contractAmount + r.amount);
    d.priorAmount = r3(d.priorAmount + r.priorAmount);
    d.currentAmount = r3(d.currentAmount + r.currentAmount);
  }
  for (const d of divisions.values()) d.pct = pctOf(d.priorAmount + d.currentAmount, d.contractAmount);

  const visibleRows = rows.filter((r) => r.visible);
  const totals: BoqStateTotals = {
    contractAmount: r3(visibleRows.reduce((s, r) => s + r.amount, 0)),
    priorAmount: r3(visibleRows.reduce((s, r) => s + r.priorAmount, 0)),
    currentAmount: r3(visibleRows.reduce((s, r) => s + r.currentAmount, 0)),
    pct: 0,
  };
  totals.pct = pctOf(totals.priorAmount + totals.currentAmount, totals.contractAmount);

  return { asOf, items: rows, divisions: Array.from(divisions.values()), totals, invoices };
}

// ==================== التايملاين (§5 — وقود شريط الزمن) ====================

export type BoqTimelineKind = "ملحق معتمد" | "فتح مستخلص" | "تقديم مستخلص" | "اعتماد مستخلص" | "إلغاء مستخلص";

export interface BoqTimelineEvent {
  /** YYYY-MM-DD — مفتاح «افتح كما كان في» عند الضغط */
  date: string;
  kind: BoqTimelineKind;
  label: string;
  invoiceNumber?: string;
  invoiceId?: number;
  amount?: number;
}

/** ترتيب أنواع الأحداث داخل اليوم الواحد: البنية ← الفتح ← التقديم ← الاعتماد ← الإلغاء */
const KIND_ORDER: Record<BoqTimelineKind, number> = {
  "ملحق معتمد": 0,
  "فتح مستخلص": 1,
  "تقديم مستخلص": 2,
  "اعتماد مستخلص": 3,
  "إلغاء مستخلص": 4,
};

/**
 * الأحداث المؤرخة لتاريخ كل مستخلص/ملحق معتمد — ناقصًا ما لا مصدر له بلا تاريخ
 * (الاستيراد: لا حدث مؤرخ في القاعدة — حد v1 موثق). الإلغاء من أحداث ContractEvent
 * («إلغاء فاتورة») بمطابقة رقم المستخلص في الوصف، ووصف بلا مطابقة يمر عامًا.
 */
export function deriveBoqTimeline(input: {
  invoices: Pick<BoqStateInvoiceInput, "id" | "invoiceNumber" | "invoiceDate" | "status" | "submitAt" | "approveAt" | "total">[];
  addendums: { addendumNumber: string; approvedDate: string; description: string }[];
  voidEvents: { eventTime: string; description: string }[];
}): BoqTimelineEvent[] {
  const events: BoqTimelineEvent[] = [];

  for (const inv of input.invoices) {
    const openDate = datePart10(inv.invoiceDate);
    if (openDate) {
      events.push({
        date: openDate,
        kind: "فتح مستخلص",
        label: `فتح المستخلص ${inv.invoiceNumber} بمبلغ ${inv.total}`,
        invoiceNumber: inv.invoiceNumber,
        invoiceId: inv.id,
        amount: inv.total,
      });
    }
    const submitDate = datePart10(inv.submitAt);
    if (submitDate && inv.status !== "void") {
      events.push({
        date: submitDate,
        kind: "تقديم مستخلص",
        label: `تقديم المستخلص ${inv.invoiceNumber}`,
        invoiceNumber: inv.invoiceNumber,
        invoiceId: inv.id,
      });
    }
    const approveDate = datePart10(inv.approveAt);
    if (approveDate && inv.status !== "void") {
      events.push({
        date: approveDate,
        kind: "اعتماد مستخلص",
        label: `اعتماد المستخلص ${inv.invoiceNumber} — تُجمِّد «الحالي» في «السابق»`,
        invoiceNumber: inv.invoiceNumber,
        invoiceId: inv.id,
      });
    }
  }

  for (const a of input.addendums) {
    const d = datePart10(a.approvedDate);
    if (!d) continue;
    events.push({
      date: d,
      kind: "ملحق معتمد",
      label: `اعتماد الملحق ${a.addendumNumber}${a.description ? ` — ${a.description.slice(0, 60)}` : ""}`,
    });
  }

  for (const ev of input.voidEvents) {
    const d = datePart10(ev.eventTime);
    if (!d) continue;
    // مطابقة رقم المستخلص من الوصف: «إلغاء الفاتورة INV-0002 بمبلغ …»
    const m = /إلغاء الفاتورة\s+(\S+)/.exec(ev.description || "");
    const num = m?.[1] || "";
    const inv = num ? input.invoices.find((i) => i.invoiceNumber === num) : undefined;
    events.push({
      date: d,
      kind: "إلغاء مستخلص",
      label: (ev.description || "إلغاء مستخلص").slice(0, 90),
      invoiceNumber: num || undefined,
      invoiceId: inv?.id,
    });
  }

  // تصاعدي (الأقدم أولًا) — شريط الزمن يُقرأ من البداية؛ التسوية داخل اليوم بنوع الحدث
  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label)
  );
}
