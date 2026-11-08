/**
 * warehouses-core.ts — نواة موديول المخازن النقية (docs/warehouses-design.md §4) — نقية 100% بلا Prisma ولا React ولا server-only:
 * • الحركة الموحدة: كل سطر إذن يُترجم لحركة (صنف، مستودع، تاريخ، كمية±، قيمة±) — G9: الأرصدة اشتقاقية حصرًا بلا أي جدول مخزن
 * • المتوسط المرجح الاشتقاقي + لقطات مجففة على السطر (د2)
 * • منع السالب برسالة منظمة تسمّي الصنف والمستودع (د4) و تحقق المستند بجدول قواعد مغلق (G8)
 * • فروق الجرد وتقرير انحراف بنود BOQ (النقيض الحرفي لفجوة G1) وتكلفة عقد من الأسطر المجففة (د8)
 */
import {
  DOC_KINDS,
  ENTRY_SOURCES,
  isIsoDate,
  r3,
  type DocKind,
  type DocStatus,
  type EntrySource,
} from "./warehouses-constants";

// ===== الأنواع المشتركة =====

/** حركة مخزنية موحدة بالتوقيع: موجب = داخل المخزن، سالب = خارج منه */
export interface MovementInput {
  itemId: number;
  warehouseId: number;
  date: string; // YYYY-MM-DD
  qty: number; // بالتوقيع
  value: number; // قيمة الحركة بالتوقيع نفسه (أسطر مجففة)
}

/** رأس إذن كما يمر للنواة (من الخادم بعد القراءة أو قبل الكتابة) */
export interface DocHeadInput {
  kind: DocKind;
  entrySource: EntrySource | "";
  vdate: string;
  warehouseId: number;
  targetWarehouseId?: number | null;
  contractId?: number | null;
  payAccountId?: number | null;
  /** اسم المورد (الآجل يتطلبه — د11) — للتحقق النقي فقط */
  party?: string;
  status?: DocStatus;
}

export interface DocLineInput {
  itemId: number;
  boqItemId?: number | null;
  qty: number;
  countedQty?: number; // الجرد: المفحوص
  snapUnitCost: number;
  note?: string;
}

export interface StockBalance {
  itemId: number;
  warehouseId: number;
  qty: number;
  value: number;
  wac: number; // متوسط مرجح اشتقاقي — 0 عند عدم توفر كمية
}

// ===== الحركة الموحدة (§4) =====

/**
 * يترجم إذنًا بأسرته إلى حركات مخزنية بالتوقيع:
 * • إدخال (شراء/آجل/مرتجع موقع): داخل موجب بالمستودع
 * • صرف: خارج سالب بالمستودع
 * • تحويل: زوج — خارج بالمصدر وداخل بالمستهدف بنفس اللقطة (بلا قيد محاسبي)
 * • جرد: ± بالفرق المقيّد
 */
export function docMovements(doc: DocHeadInput, lines: DocLineInput[]): MovementInput[] {
  if (doc.status === "cancelled") return []; // الملغاة شفافة — الحركة تختفي تلقائيًا عند الإلغاء
  const out: MovementInput[] = [];
  for (const l of lines) {
    const value = r3(l.qty * l.snapUnitCost);
    if (doc.kind === "entry") {
      out.push({ itemId: l.itemId, warehouseId: doc.warehouseId, date: doc.vdate, qty: l.qty, value });
    } else if (doc.kind === "issue") {
      out.push({ itemId: l.itemId, warehouseId: doc.warehouseId, date: doc.vdate, qty: -l.qty, value: -value });
    } else if (doc.kind === "transfer") {
      const target = doc.targetWarehouseId ?? 0;
      out.push({ itemId: l.itemId, warehouseId: doc.warehouseId, date: doc.vdate, qty: -l.qty, value: -value });
      out.push({ itemId: l.itemId, warehouseId: target, date: doc.vdate, qty: l.qty, value });
    } else if (doc.kind === "count") {
      out.push({ itemId: l.itemId, warehouseId: doc.warehouseId, date: doc.vdate, qty: l.qty, value });
    }
  }
  return out;
}

// ===== الأرصدة الاشتقاقية (د2 — جوهر درس G9) =====

/** رصيد كل صنف×مستودع من الحركات: qty وvalue تجميع، والمتوسط المرجح اشتقاق = value ÷ qty عند qty > 0 */
export function computeBalances(movements: MovementInput[], asOf?: string): StockBalance[] {
  const map = new Map<string, { itemId: number; warehouseId: number; qty: number; value: number }>();
  for (const m of movements) {
    if (asOf && m.date > asOf) continue; // مقارنة نصية سليمة لصيغة YYYY-MM-DD
    const key = `${m.itemId}:${m.warehouseId}`;
    const acc = map.get(key) ?? { itemId: m.itemId, warehouseId: m.warehouseId, qty: 0, value: 0 };
    acc.qty = r3(acc.qty + m.qty);
    acc.value = r3(acc.value + m.value);
    map.set(key, acc);
  }
  const rows: StockBalance[] = [];
  for (const acc of map.values()) {
    rows.push({
      itemId: acc.itemId,
      warehouseId: acc.warehouseId,
      qty: acc.qty,
      value: acc.value,
      wac: acc.qty > 0 ? r3(acc.value / acc.qty) : 0,
    });
  }
  return rows.sort((a, b) => a.itemId - b.itemId || a.warehouseId - b.warehouseId);
}

/** رصيد صنف بمستودع حتى تاريخ (اشتقاقي لحظي — يستهلكه فحص السالب وشارة الحد الأدنى) */
export function balanceOf(balances: StockBalance[], itemId: number, warehouseId: number): StockBalance | undefined {
  return balances.find((b) => b.itemId === itemId && b.warehouseId === warehouseId);
}

// ===== منع السالب (د4) =====

export interface AvailabilityViolation {
  itemId: number;
  warehouseId: number;
  available: number; // الرصيد المتاح حتى تاريخ الإذن
  required: number; // الكمية المطلوبة بالحركة الجديدة
}

/**
 * فحص أن حركة جديدة لا تجعل الرصيد سالبًا في **أي نقطة من الخط الزمني** (درس G9 بحقه):
 * نعيد تشغيل الحركات (القائمة + الواردة) مرتبةً بالتاريخ — التراكمي بعد كل مجموعة يوم يجب ألا ينزل تحت الصفر.
 * هذا يرفض الصرف المتجاوز والإذن المؤرّخ قبل نقطة النفاد معًا.
 * «المتاح» في المخالفة = رصيد القائم حتى تاريخ الإذن الجديد (الرقم الذي يفهمه المستخدم).
 */
export function validateAvailability(
  existing: MovementInput[],
  incoming: MovementInput[]
): AvailabilityViolation[] {
  const violations: AvailabilityViolation[] = [];
  const keys = new Set(incoming.map((m) => `${m.itemId}:${m.warehouseId}`));
  for (const key of keys) {
    const [itemIdStr, warehouseIdStr] = key.split(":");
    const itemId = Number(itemIdStr);
    const warehouseId = Number(warehouseIdStr);
    const scoped = existing.filter((m) => m.itemId === itemId && m.warehouseId === warehouseId);
    const incomingScoped = incoming.filter((m) => m.itemId === itemId && m.warehouseId === warehouseId);
    const vdate = incomingScoped[0].date;

    // إعادة تشغيل الخط الزمني: تجميع باليوم ثم تراكم تصاعديًا
    const byDate = new Map<string, number>();
    for (const m of [...scoped, ...incomingScoped]) {
      byDate.set(m.date, r3((byDate.get(m.date) ?? 0) + m.qty));
    }
    let cum = 0;
    let min = 0;
    for (const d of [...byDate.keys()].sort()) {
      cum = r3(cum + byDate.get(d)!);
      if (cum < min) min = cum;
    }

    if (min < 0) {
      const available = r3(scoped.filter((m) => m.date <= vdate).reduce((s, m) => s + m.qty, 0));
      const required = r3(Math.abs(incomingScoped.reduce((s, m) => s + m.qty, 0)));
      violations.push({ itemId, warehouseId, available, required });
    }
  }
  return violations;
}

// ===== تحقق المستند (جدول قواعد مغلق — G8 الإلزامية) =====

/** يتحقق من رأس وأسطر إذن جديد — يعيد قائمة أخطاء عربية فارغة عند السلامة (الكمية المطلقة والحسابات يعيد الخادم) */
export function validateStockDoc(
  doc: DocHeadInput,
  lines: DocLineInput[]
): string[] {
  const errors: string[] = [];
  if (!DOC_KINDS.includes(doc.kind)) errors.push("نوع الإذن غير معروف");
  if (!isIsoDate(doc.vdate)) errors.push("تاريخ الإذن مطلوب بصيغة YYYY-MM-DD");
  if (!doc.warehouseId || doc.warehouseId <= 0) errors.push("المستودع مطلوب");
  if (lines.length === 0) errors.push("الإذن بلا أسطر — أضف صنفًا واحدًا على الأقل");

  const seenItems = new Set<number>();
  for (const l of lines) {
    const label = `سطر الصنف #${l.itemId}`;
    if (!l.itemId || l.itemId <= 0) errors.push(`${label}: الصنف مطلوب`);
    if (seenItems.has(l.itemId)) errors.push(`${label}: الصنف مكرر داخل الإذن — ادمج الأسطر`);
    seenItems.add(l.itemId);

    if (doc.kind === "count") {
      if (l.countedQty == null || l.countedQty < 0) errors.push(`${label}: الكمية المفحوصة يجب أن تكون صفرًا أو أكثر`);
    } else if (!(l.qty > 0)) {
      errors.push(`${label}: الكمية يجب أن تكون أكبر من صفر`);
    }
    if (!(l.snapUnitCost >= 0)) errors.push(`${label}: سعر الوحدة لا يقبل السالب`);
    if (!Number.isFinite(l.snapUnitCost)) errors.push(`${label}: سعر الوحدة غير صالح`);
  }

  if (doc.kind === "entry") {
    if (!ENTRY_SOURCES.includes(doc.entrySource as EntrySource)) errors.push("مصدر الإدخال مطلوب (نقدي/آجل/مرتجع موقع)");
    if (doc.entrySource === "cash" && (!doc.payAccountId || doc.payAccountId <= 0))
      errors.push("الإدخال النقدي يتطلب اختيار حساب الصندوق/البنك");
    if (doc.entrySource === "return" && (!doc.contractId || doc.contractId <= 0))
      errors.push("مرتجع الموقع يتطلب تحديد العقد");
    if (doc.entrySource === "credit" && !doc.party?.trim())
      errors.push("الشراء الآجل يتطلب اسم المورد");
  }
  if (doc.kind === "issue" && (!doc.contractId || doc.contractId <= 0))
    errors.push("إذن الصرف يتطلب تحديد العقد (الصرف على العقود حصرًا — د7)");
  if (doc.kind === "transfer") {
    if (!doc.targetWarehouseId || doc.targetWarehouseId <= 0) errors.push("التحويل يتطلب المستودع المستهدف");
    if (doc.targetWarehouseId && doc.targetWarehouseId === doc.warehouseId)
      errors.push("المستودع المستهدف يجب أن يختلف عن المصدر");
  }
  return errors;
}

// ===== فروق الجرد (د10) =====

export interface CountedInput {
  itemId: number;
  countedQty: number;
}

export interface CountDelta {
  itemId: number;
  delta: number; // مفحوص − مسجل (±)
  unitCost: number; // لقطة المتوسط الحالي (0 عند رصيد صفري)
  amount: number; // r3(delta × unitCost) — بتوقيع الفرق
}

/** فرق الجرد لكل صنف مفحوص — يتصفّر التطابق ويحفظ سعر اللقطة الحالي؛ إدخال الأرصدة يجب أن يكون لمستودع واحد */
export function computeCountDeltas(balances: StockBalance[], counted: CountedInput[]): CountDelta[] {
  const out: CountDelta[] = [];
  for (const c of counted) {
    const b = balances.find((x) => x.itemId === c.itemId);
    const delta = r3(c.countedQty - (b?.qty ?? 0));
    if (delta === 0) continue; // التطابق لا سطر له
    const unitCost = b && b.qty > 0 ? b.wac : 0;
    out.push({ itemId: c.itemId, delta, unitCost, amount: r3(delta * unitCost) });
  }
  return out;
}

// ===== انحراف المواد على بنود العقد (د7 — النقيض الحرفي لفجوة G1) =====

export interface BoqRef {
  id: number;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
  unit?: string;
}

/** المنصرف من المخازن على بند BOQ: كميات وقيم من أسطر الصرف المرتبطة به (سالب عند المرتجعات) */
export interface BoqIssued {
  boqItemId: number;
  qty: number;
  value: number;
}

export interface BoqDeviationRow {
  boqItemId: number;
  description: string;
  unit: string;
  contractQty: number;
  contractValue: number;
  issuedQty: number;
  issuedValue: number;
  remainingQty: number; // التعاقدي − المنصرف (سالب = تجاوز)
  overQty: number; // التجاوز إن وجد (0 غير ذلك)
}

export function deviationOfBoq(boqItems: BoqRef[], issued: BoqIssued[]): BoqDeviationRow[] {
  const byId = new Map(issued.map((i) => [i.boqItemId, i]));
  return boqItems.map((b) => {
    const i = byId.get(b.id);
    const issuedQty = i ? r3(i.qty) : 0;
    const issuedValue = i ? r3(i.value) : 0;
    const remainingQty = r3(b.qty - issuedQty);
    return {
      boqItemId: b.id,
      description: b.description,
      unit: b.unit ?? "",
      contractQty: r3(b.qty),
      contractValue: r3(b.amount),
      issuedQty,
      issuedValue,
      remainingQty,
      overQty: remainingQty < 0 ? r3(-remainingQty) : 0,
    };
  });
}

// ===== تكلفة العقد من الأسطر المجففة (د8 — تستهلكها الربحية والنظرة حصرًا) =====

export interface DocCostRow {
  kind: DocKind;
  entrySource?: EntrySource | "";
  contractId?: number | null;
  status?: DocStatus;
  totalAmount: number; // مجمد على الرأس = Σ |أسطر|
}

/**
 * تكلفة المواد المخزنية على عقد = Σ إذون الصرف − Σ أذون المرتجع الموقعي —
 * من أذون posted حصرًا (الملغاة شفافة — د8). تُقرأ من رؤوس الأذون المجففة لا من حسابات الأستاذ
 * (النمط نفسه لـlaborAllocation في HR-3: لقطات لا أرصدة).
 */
export function materialsCostOfContract(docs: DocCostRow[], contractId: number): number {
  let cost = 0;
  for (const d of docs) {
    if (d.status === "cancelled" || d.contractId !== contractId) continue;
    if (d.kind === "issue") cost = r3(cost + d.totalAmount);
    else if (d.kind === "entry" && d.entrySource === "return") cost = r3(cost - d.totalAmount);
  }
  return cost;
}
