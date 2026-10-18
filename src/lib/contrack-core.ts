/**
 * المكتبة المالية الجوهرية — انسخ حرفيًا من القواعد المستخلصة من المصدر
 * المرجع: research/spec-core.md (الأقسام A-F) وBUSINESS_LOGIC_SPEC.md
 * القاعدة: كل الأرصدة تُحسب لحظيًا ولا تُخزَّن.
 */

export const EPS = 0.001;
export const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ===== أدوات تواريخ نصية YYYY-MM-DD =====
export const todayStr = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const parseDay = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00Z`);

export const daysBetween = (a: string, b: string): number =>
  Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);

/** إضافة شهور مع تقصير نهاية الشهر (كالمصدر _add_months) */
export function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return "";
  const d = parseDay(dateStr);
  const target = new Date(d);
  target.setUTCMonth(target.getUTCMonth() + months);
  if (target.getUTCDate() !== d.getUTCDate()) {
    target.setUTCDate(0); // نهاية الشهر السابق
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${target.getUTCFullYear()}-${p(target.getUTCMonth() + 1)}-${p(target.getUTCDate())}`;
}

// ===== أنواع الإدخال =====
export interface SupContract {
  supStartDate: string;
  supMonths: number;
  supMonthly: number | string;
  supDiscount: number | string;
  supWaivedMonths: number | string;
}

export interface PlanLine {
  id: number;
  title: string;
  dueDate: string;
  amount: number | string;
  sortOrder: number;
  stageId: number | null;
  triggeredAt: string;
  notes: string;
  stage?: { isSkipped: boolean; endDate: string } | null;
}

export interface ReceiptLike {
  id: number;
  voucherNumber: string;
  vdate: string;
  amount: number | string;
  allocation: string;
  advanceAmount: number | string;
  cancelled?: boolean;
}

export interface LinkRow {
  voucherId: number;
  lineId: number;
  amount: number | string;
}

// ===== A) الإشراف الهندسي (spec-core F) =====
export function isSupervision(c: Partial<SupContract>): boolean {
  return Boolean(c.supStartDate) && Number(c.supMonths || 0) > 0 && Number(c.supMonthly || 0) > 0;
}

export function supervisionStatus(
  c: SupContract & { id?: number },
  receipts: ReceiptLike[] = [],
  actualEnd: string = ""
) {
  const monthly = Number(c.supMonthly || 0);
  const months = Number(c.supMonths || 0);
  const gross = r3(months * monthly);
  const base = r3(Math.max(0, gross - Number(c.supDiscount || 0)));
  const baseEnd = c.supStartDate ? addMonths(c.supStartDate, months) : "";
  const stop = actualEnd || "";
  const today = todayStr();

  let extMonths = 0;
  if (baseEnd && monthly > 0) {
    let cursor = baseEnd;
    const until = stop && daysBetween(stop, today) >= 0 ? stop : today;
    while (cursor && daysBetween(cursor, until) >= 0) {
      extMonths += 1;
      cursor = addMonths(cursor, 1);
    }
  }
  const billableExt = r3(Math.max(0, extMonths - Number(c.supWaivedMonths || 0)));
  const extensionValue = r3(billableExt * monthly);
  const totalDue = r3(base + extensionValue);
  const collected = r3(
    receipts.filter((v) => !v.cancelled).reduce((s, v) => s + Number(v.amount || 0), 0)
  );
  const remaining = r3(totalDue - collected);
  // مدفوع من التمديد = أدنى(قيمة التمديد، المحصل − الأساس)
  const paidExt = r3(Math.max(0, Math.min(extensionValue, collected - base)));
  const paidExtMonths = monthly > 0 ? Math.floor(paidExt / monthly + EPS) : 0;
  const settledExtMonths = paidExtMonths + Number(c.supWaivedMonths || 0);
  const fullEnd = c.supStartDate ? addMonths(c.supStartDate, months + Math.floor(settledExtMonths)) : "";
  let delayMonths = 0;
  if (fullEnd && monthly > 0) {
    let cursor = fullEnd;
    const until = stop && daysBetween(stop, today) >= 0 ? stop : today;
    while (cursor && daysBetween(cursor, until) >= 0) {
      delayMonths += 1;
      cursor = addMonths(cursor, 1);
    }
  }
  return {
    grossValue: gross,
    baseValue: base,
    baseEnd,
    extensionMonths: extMonths,
    billableExtMonths: billableExt,
    extensionValue,
    totalDue,
    collected,
    remaining,
    fullEnd,
    delayMonths,
    delayValue: r3(delayMonths * monthly),
    unpaidExtMonths: r3(Math.max(0, extMonths - settledExtMonths)),
  };
}

// ===== A) القيمة الحالية للعقد =====
export interface AddendumLike {
  status: string;
  amountAdd: number | string;
  amountDeduct: number | string;
}

export function supervisionExtension(c: SupContract & { id?: number }, actualEnd = ""): number {
  if (!isSupervision(c)) return 0;
  return supervisionStatus(c, [], actualEnd).extensionValue;
}

export function contractCurrentValue(
  amount: number | string,
  addendums: AddendumLike[] = [],
  supExt = 0
): number {
  const net = addendums
    .filter((a) => a.status === "معتمد")
    .reduce((s, a) => s + Number(a.amountAdd || 0) - Number(a.amountDeduct || 0), 0);
  return r3(Number(amount || 0) + net + supExt);
}

// ===== B) خطة الدفعات مع التغطية FIFO (spec-core B + D) =====
export interface ComputedPlanLine extends PlanLine {
  amountN: number;
  covered: number;
  explicit: number;
  remaining: number;
  state:
    | "skipped"
    | "awaiting_stage"
    | "paid"
    | "partial"
    | "overdue"
    | "due"
    | "upcoming";
  daysDiff: number;
  stateLabel: string;
}

/** حساب خطة دفعات العقد — التغطية قراءةً: بركة القبض بترتيب (dueDate, sortOrder) + روابط صريحة */
export function computeContractPaymentPlan(
  plan: PlanLine[],
  receipts: ReceiptLike[],
  links: LinkRow[],
  opts: { today?: string } = {}
): { lines: ComputedPlanLine[]; collected: number; currentCoverage: number } {
  const today = opts.today || todayStr();
  const sorted = [...plan].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
  // بركة القبض: سندات قبض سارية بلا تخصيص لأمر تغييري
  const collected = r3(
    receipts
      .filter((v) => !v.cancelled && !(v.allocation || "").trim())
      .reduce((s, v) => s + Number(v.amount || 0), 0)
  );
  // الروابط الصريحة من سندات سارية بلا تخصيص
  const validVoucherIds = new Set(
    receipts.filter((v) => !v.cancelled && !(v.allocation || "").trim()).map((v) => v.id)
  );
  const linksByLine = new Map<number, number>();
  for (const l of links) {
    if (!validVoucherIds.has(l.voucherId)) continue;
    linksByLine.set(l.lineId, r3((linksByLine.get(l.lineId) || 0) + Number(l.amount || 0)));
  }
  const totalLinks = r3([...linksByLine.values()].reduce((s, v) => s + v, 0));
  let pool = Math.max(0, collected - totalLinks);

  const lines: ComputedPlanLine[] = sorted.map((p) => {
    const amountN = Number(p.amount || 0);
    const isSkipped = Boolean(p.stage?.isSkipped);
    // 1) التغطية من البركة FIFO
    let covered = Math.min(pool, amountN);
    pool = r3(pool - covered);
    // 2) الروابط الصريحة
    const link = linksByLine.get(p.id) || 0;
    const explicit = Math.min(link, r3(amountN - covered));
    covered = r3(covered + explicit);
    const remaining = r3(amountN - covered);
    return { ...p, amountN, covered: r3(covered), explicit: r3(explicit), remaining } as ComputedPlanLine;
  });

  // الحالة الثمانية بالترتيب الحرفي (spec-core D)
  const labelled = lines.map((l) => {
    let state: ComputedPlanLine["state"];
    let daysDiff = l.dueDate ? daysBetween(today, l.dueDate) : 999999;
    const hasStage = l.stageId != null;
    if (hasStage && l.stage?.isSkipped) {
      state = "skipped";
    } else if (hasStage && !l.triggeredAt && l.remaining > EPS) {
      state = "awaiting_stage";
      daysDiff = 999999;
    } else if (l.remaining <= EPS) {
      state = "paid";
    } else if (l.covered > EPS) {
      state = daysDiff >= 0 ? "partial" : "overdue";
    } else if (daysDiff < 0) {
      state = "overdue";
    } else if (l.triggeredAt) {
      state = "due";
    } else if (daysDiff <= 7) {
      state = "upcoming";
    } else {
      state = "upcoming";
    }
    const stateLabel: Record<string, string> = {
      skipped: "مرحلة متخطاة",
      awaiting_stage: "بانتظار إنجاز المرحلة",
      paid: "مدفوع",
      partial: daysDiff >= 0 ? "جزئي" : "متأخر",
      overdue: "متأخر",
      due: "مستحقة",
      upcoming: daysDiff <= 7 ? "مستحق قريبًا" : "لم يحل أجله",
    };
    return { ...l, state, daysDiff, stateLabel: stateLabel[state] };
  });

  return { lines: labelled, collected, currentCoverage: r3(collected - pool) };
}

/** المستحق الآن (strict) — متأخرة/مستحقة فقط، تستبعد المغلق والملغى */
export function dueNowStrict(lines: ComputedPlanLine[]): number {
  return r3(
    lines
      .filter(
        (l) =>
          l.remaining > EPS &&
          l.state !== "skipped" &&
          l.state !== "awaiting_stage" &&
          l.state !== "paid" &&
          l.state !== "upcoming" &&
          l.daysDiff <= 0
      )
      .reduce((s, l) => s + l.remaining, 0)
  );
}

/** الدفعات القابلة للربط بسند قبض (_REACHED) — متأخر/جزئي/مستحقة/قريبة(مثارة) */
export function reachableLines(lines: ComputedPlanLine[]): ComputedPlanLine[] {
  return lines.filter(
    (l) =>
      l.remaining > EPS &&
      (l.state === "overdue" ||
        l.state === "partial" ||
        l.state === "due" ||
        (l.state === "upcoming" && Boolean(l.triggeredAt)))
  );
}

/** مساحة الربط لخط: القيمة − روابط سندات سارية أخرى */
export function roomFor(line: { amount: number; covered: number }): number {
  return r3(Math.max(0, line.amount - line.covered));
}

/** فحص سقف القبض التحذيري — يعيد {over: boolean, remaining} */
export function checkReceiptCap(
  amount: number,
  dueValue: number,
  collectedSoFar: number
): { over: boolean; remaining: number } {
  const remaining = r3(dueValue - collectedSoFar);
  return { over: amount > remaining + 1e-9, remaining };
}

// ===== J) الرسوم البنكية لسند القبض =====
export function receiptBankFee(
  method: string,
  amount: number,
  methods: { name: string; feeType: string; feeValue: number; isActive?: boolean }[],
  settings: { bankFeeAmount: number; bankFeeMethod: string; bankFeeEnabled: boolean }
): number {
  if (!settings.bankFeeEnabled) return 0;
  const m = methods.find((x) => x.name === method && x.isActive);
  if (m) {
    if (m.feeType === "percent") return r3((amount * Number(m.feeValue)) / 100);
    if (m.feeType === "amount") return r3(Number(m.feeValue));
    return 0;
  }
  if (method === settings.bankFeeMethod) return r3(Number(settings.bankFeeAmount || 0));
  return 0;
}
