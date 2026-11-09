/**
 * maintenance-core.ts — نواة موديول الصيانة والتشغيل النقية (docs/maintenance-design.md §4) — نقية 100% بلا Prisma ولا React ولا server-only:
 * • توليد التواريخ بمعايرة نهاية الشهر (د5) — مولِّد لا تقويم
 * • اشتقاق حالة الحدث من أمره + علم تخطٍّ صريح (د6 — G9: لا عمود حالة مخزن ولا عدادات)
 * • تحقق الخطة والأمر بجدول قواعد مغلق (G8) وبوابات الحالة (د4) وبوابات المستندات (د8/د9 — بلا شلالات خفية)
 * • إعادة التوليد تحفظ المنجز والمتخطى وتعيد المعلق حصرًا من آخر ارتكاز
 * • المؤشرات من القوائم بلا استعلامات موازية + اقتراح فاتورة الزيارة (د9)
 */
import {
  PLAN_INTERVALS,
  PLAN_MAX_OCCURRENCES,
  WO_TRANSITIONS,
  isIsoDate,
  r3,
  type OccurrenceStatus,
  type PlanInterval,
  type WoStatus,
} from "./maintenance-constants";

// ===== التواريخ (د5) =====

/**
 * إضافة أشهر بمعايرة نهاية الشهر: 31 يناير +1 شهر = 28 فبراير (29 في الكبيسة)،
 * 31 يناير +3 = 30 أبريل — واليوم الأصغر يمر كما هو. التاريخ المُدخل يجب أن يكون ISO.
 */
export function addMonthsClamped(dateStr: string, months: number): string {
  if (!isIsoDate(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate(); // آخر يوم بالشهر الهدف
  const nd = Math.min(d, last);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export interface PlanSpec {
  startDate: string; // YYYY-MM-DD — نقطة الارتكاز الأولى
  intervalMonths: number;
  occurrencesCount: number;
}

/** مواعيد الخطة من نقطة ارتكاز (الافتراضي تاريخ البداية) — الموقع الأول على الارتكاز نفسه ثم بمسافة الفاصل */
export function generateOccurrenceDates(spec: PlanSpec, anchor?: string): string[] {
  const base = anchor && isIsoDate(anchor) ? anchor : spec.startDate;
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, spec.occurrencesCount); i++) {
    out.push(addMonthsClamped(base, i * spec.intervalMonths));
  }
  return out;
}

// ===== اشتقاق حالة الحدث (د6 — G9) =====

/** حالة الحدث دالة من علم التخطي وأمره: متخطاة / مجدولة (بلا أمر أو أمره ملغى) / منجزة / مفتوحة */
export function occurrenceStatusOf(
  occ: { skipped: boolean },
  wo: { status: string } | null | undefined
): OccurrenceStatus {
  if (occ.skipped) return "متخطاة";
  if (!wo || wo.status === "ملغاة") return "مجدولة";
  if (wo.status === "منجزة") return "منجزة";
  return "مفتوحة";
}

// ===== تحقق الخطة (د5 — جدول قواعد مغلق) =====

export function validatePlan(input: {
  intervalMonths: number;
  occurrencesCount: number;
  startDate: string;
}): string[] {
  const errors: string[] = [];
  if (!PLAN_INTERVALS.includes(input.intervalMonths as PlanInterval))
    errors.push("الفاصل الزمني يجب أن يكون من {1، 2، 3، 6، 12} شهرًا");
  if (!Number.isInteger(input.occurrencesCount) || input.occurrencesCount < 1 || input.occurrencesCount > PLAN_MAX_OCCURRENCES)
    errors.push(`عدد الزيارات يجب أن يكون بين 1 و ${PLAN_MAX_OCCURRENCES}`);
  if (!isIsoDate(input.startDate)) errors.push("تاريخ بداية الخطة مطلوب بصيغة YYYY-MM-DD");
  return errors;
}

// ===== تحقق أمر العمل (G8 — الإلزامية) =====

export interface WoContractRef {
  id: number;
  status: string; // «نشط» وغيرها — حالات العقود القائمة
  isMaintenance: boolean;
}

export interface WoTechnicianRef {
  id: number;
  active: boolean;
}

export function validateWorkOrder(
  input: {
    title: string;
    scheduledDate: string;
    contractId: number;
    technicianId?: number | null;
  },
  ctx: { contract?: WoContractRef | null; technician?: WoTechnicianRef | null }
): string[] {
  const errors: string[] = [];
  if (!input.title?.trim()) errors.push("عنوان أمر العمل مطلوب");
  if (!input.contractId || input.contractId <= 0) errors.push("أمر العمل يتطلب تحديد عقد الصيانة (G8)");
  if (!isIsoDate(input.scheduledDate)) errors.push("تاريخ الجدولة مطلوب بصيغة YYYY-MM-DD");

  if (input.contractId && input.contractId > 0) {
    if (!ctx.contract) errors.push("عقد الصيانة غير موجود");
    else {
      if (!ctx.contract.isMaintenance)
        errors.push("العقد المحدد ليس عقد صيانة — اختر عقدًا بنوع موسوم «عقد صيانة» (د2)");
      if (ctx.contract.status !== "نشط") errors.push("العقد غير نشط — لا يمكن فتح أوامر عمل عليه");
    }
  }
  if (input.technicianId && input.technicianId > 0) {
    if (!ctx.technician) errors.push("الفني المختار غير موجود");
    else if (!ctx.technician.active) errors.push("الفني المختار معطّل — اختر فنيًا نشطًا");
  }
  return errors;
}

// ===== بوابات آلة الحالة (د4) =====

/** فحص انتقال حالة الأمر — يعيد رسالة عربية عند الانتقال المرفوض، وnull عند السماح */
export function validateTransition(from: WoStatus, to: WoStatus): string | null {
  if (from === to) return "أمر العمل في هذه الحالة أصلًا";
  const allowed = WO_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to))
    return `لا يمكن الانتقال من «${from}» إلى «${to}» — الانتقالات المسموحة: ${allowed.length ? allowed.map((s) => `«${s}»`).join("، ") : "لا شيء (حالة نهائية)"}`;
  return null;
}

/** التعديل وهو «مفتوحة» حصرًا (د4) — null عند السماح */
export function canEditOrder(order: { status: WoStatus }): string | null {
  if (order.status !== "مفتوحة") return "التعديل مسموح وهو «مفتوحة» حصرًا — الأوامر الجارية تُنهى أو تُلغى (د4)";
  return null;
}

// ===== بوابات المستندات (د8/د9 — رفض صريح بلا شلالات خفية) =====

/** صرف المواد: قبل الإنهاء حصرًا، وبإذن واحد لكل أمر — الإضافي من شاشة المخازن على العقد (د8) */
export function canIssueMaterials(order: {
  status: WoStatus;
  materialsDocId?: number | null;
}): string | null {
  if (order.materialsDocId)
    return "لأمر العمل إذن صرف مرتبط بالفعل — الصرف الإضافي من شاشة المخازن على العقد مباشرة (د8)";
  if (order.status === "منجزة" || order.status === "ملغاة")
    return `لا يمكن صرف المواد على أمر «${order.status}» — الصرف قبل الإنهاء حصرًا (د4)`;
  return null;
}

/** فاتورة الزيارة: بعد الإنهاء حصرًا وبفاتورة واحدة (د9) */
export function canInvoiceOrder(order: {
  status: WoStatus;
  invoiceId?: number | null;
}): string | null {
  if (order.invoiceId) return "لأمر العمل فاتورة مرتبطة بالفعل";
  if (order.status !== "منجزة") return "فاتورة الزيارة بعد إنهاء الأمر حصرًا (د9)";
  return null;
}

/** إلغاء الأمر: من مفتوحة/جارية فقط، وذو مستندات مرفوض برسالة تسمّيها — المدير يلغيها من شاشتيها أولًا (د8) */
export function canCancelOrder(order: {
  status: WoStatus;
  materialsDocId?: number | null;
  materialsDocNumber?: string | null;
  materialsDocCancelled?: boolean; // الإذن سُحب من المخازن (ملغى وعُكس قيده) — لم يعد مانعًا (د8)
  invoiceId?: number | null;
  invoiceNumber?: string | null;
}): string | null {
  if (order.status === "منجزة" || order.status === "ملغاة")
    return `لا يمكن إلغاء أمر «${order.status}»`;
  if (order.materialsDocId && !order.materialsDocCancelled)
    return `ألغِ إذن الصرف «${order.materialsDocNumber || "المرتبط"}» من شاشة المخازن أولًا (يعكس قيده تلقائيًا) ثم ألغِ الأمر`;
  if (order.invoiceId)
    return `ألغِ الفاتورة «${order.invoiceNumber || "المرتبطة"}» من شاشة الفواتير أولًا (يسحب قيدها تلقائيًا) ثم ألغِ الأمر`;
  return null;
}

// ===== إعادة التوليد (د5 — المنجز والمتخطى محفوظان والمعلق يُعاد) =====

export interface ExistingOccurrence {
  id: number;
  dueDate: string;
  skipped: boolean;
  workOrderId?: number | null;
  workOrderStatus?: string | null; // حالة الأمر إن وجد (من الخادم)
}

export interface RegenerateResult {
  keepIds: number[];
  removeIds: number[];
  createDates: string[]; // من الارتكاز (آخر تاريخ محفوظ وإلا تاريخ البداية) — بلا تصادم مع المحفوظ
}

/**
 * إعادة توليد المعلق حصرًا: يُبقي ذوي الأوامر (بأي حالة غير ملغاة) والمتخطاة،
 * ويحذف المعلق بلا أوامر، ويولّد الباقي من آخر ارتكاز محفوظ (آخر تاريخ محفوظ،
 * وإلا تاريخ بداية الخطة) — التواريخ المتصادمة مع محفوظ تُسقط (المتخطى يغطي موعده).
 */
export function regeneratePending(
  existing: ExistingOccurrence[],
  spec: PlanSpec
): RegenerateResult {
  const keep = existing.filter(
    (o) => o.skipped || (!!o.workOrderId && o.workOrderStatus !== "ملغاة")
  );
  const remove = existing.filter((o) => !keep.includes(o));
  // الارتكاز: آخر تاريخ محفوظ، وإلا تاريخ بداية الخطة — والتوليد يبدأ من الارتكاز نفسه
  // إن لم يُحفظ شيء (أول توليد)، ومن بعده إن وُجد محفوظ (الارتكاز استهلك موعده).
  const anchor =
    keep.length > 0 ? keep.map((o) => o.dueDate).sort().at(-1)! : spec.startDate;
  const startIdx = keep.length > 0 ? 1 : 0;
  const remaining = Math.max(0, spec.occurrencesCount - keep.length);
  const keptDates = new Set(keep.map((o) => o.dueDate));
  const createDates: string[] = [];
  for (let i = startIdx; i < remaining + startIdx; i++) {
    const d = addMonthsClamped(anchor, i * spec.intervalMonths);
    if (keptDates.has(d)) continue; // المتخطى يغطي موعده — لا تصادم فريد
    createDates.push(d);
  }
  return {
    keepIds: keep.map((o) => o.id),
    removeIds: remove.map((o) => o.id),
    createDates,
  };
}

// ===== المؤشرات (د12 — من القوائم بلا استعلامات موازية) =====

export interface KpiOccurrenceRef {
  dueDate: string;
  skipped: boolean;
  planActive: boolean;
  woStatus: string | null; // حالة الأمر إن وجد
}

export interface MaintenanceKpis {
  openOrders: number; // مفتوحة + جارية
  dueThisMonth: number; // أحداث مجدولة بشهر اليوم
  overdue: number; // مجدولة تجاوز تاريخها وخطة نشطة
  activeContracts: number;
  nextDue: string | null; // أقرب حدث مجدول قادم
}

export function maintenanceKpis(input: {
  orders: { status: WoStatus }[];
  occurrences: KpiOccurrenceRef[];
  maintenanceContractsActive: number;
  today: string; // YYYY-MM-DD
}): MaintenanceKpis {
  const pending = (o: KpiOccurrenceRef) =>
    !o.skipped && o.planActive && (!o.woStatus || o.woStatus === "ملغاة");
  const openOrders = input.orders.filter(
    (o) => o.status === "مفتوحة" || o.status === "جارية"
  ).length;
  const month = input.today.slice(0, 7);
  const dueThisMonth = input.occurrences.filter(
    (o) => pending(o) && o.dueDate.slice(0, 7) === month
  ).length;
  const overdue = input.occurrences.filter(
    (o) => pending(o) && o.dueDate < input.today
  ).length;
  let nextDue: string | null = null;
  for (const o of input.occurrences) {
    if (!pending(o) || o.dueDate < input.today) continue;
    if (nextDue === null || o.dueDate < nextDue) nextDue = o.dueDate;
  }
  return {
    openOrders,
    dueThisMonth,
    overdue,
    activeContracts: input.maintenanceContractsActive,
    nextDue,
  };
}

// ===== اقتراح فاتورة الزيارة (د9) =====

/** المقترح = قيمة العقد ÷ عدد زيارات الخطة (ويُحسب من واحد إن لم تخطط) — قابل للتعديل دائمًا */
export function suggestInvoiceAmount(contractAmount: number, planCount: number | null | undefined): number {
  const n = planCount && planCount > 0 ? planCount : 1;
  return r3(contractAmount / n);
}
