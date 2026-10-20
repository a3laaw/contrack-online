/**
 * منطق الرئيسية النقي (بند 7 من المرحلة 9) — بلا قاعدة بيانات وقابل للاختبار.
 * مرجعيته المكتبية الحرفية (contrack_v9.15.18):
 *   main_window.py:87-596  DashboardPage — بناء التنبيهات بالترتيب والألوان والنصوص
 *   main_window.py:88-92   ALERTS_PER_PAGE=8 · ALERT_MAX_AGE_DAYS=30 · ACTIVITY_ROWS=8
 *   workflow_service.py:2654 alert_key (sha1 لنص التنبيه) · :2659 dismissed_alert_keys
 *   widgets.py:977-1090    PaginationBar (صفحة 8: الأولية/السابق/التالي/الأخيرة)
 *   ui/tasks.py:178-380    TasksPage(compact=True) — أعمدة المهمة/الموعد/المتبقي
 *   task_service.py:20     format_due_at · :148 _decorate_tasks (overdue/minutes_left)
 *   extras_service.py:12   _label_from_row (تسمية العقد للعميل)
 * ملاحظة نطاق: تنبيهات المكتب الحصرية (💾 مجلد النسخ الاحتياطي · 🗔 مجلدات الشبكة ·
 * 🗄 صحة النسخ الاحتياطي) بلا مقابل في الويب فلا تُبنى هنا — موثقة في worklog.
 */
import { daysBetween, r3 } from "@/lib/contrack-core";

// ===== ثوابت الرئيسية (main_window.py:88-92) =====
export const ALERTS_PER_PAGE = 8;
export const ALERT_MAX_AGE_DAYS = 30;
export const ACTIVITY_ROWS = 8;
export const ACTIVITY_EXPANDED = 25;

export const EMPTY_FEED_TEXT = "✅ لا تنبيهات ولا نشاط بعد · كل شيء على ما يرام";

/** نص بطاقة التنبيهات المخفية (main_window.py:473) */
export function alertHiddenNote(hidden: number): string {
  return `أُخفي ${hidden} تنبيهًا أقدم من ${ALERT_MAX_AGE_DAYS} يومًا — تفاصيلها في التقارير`;
}

/** نصا إخفاء/استعادة التنبيهات — مرآة جرس المكتبي (main_window.py:1749-1768) */
export const DISMISS_CONFIRM_TEXT = "إخفاء كل التنبيهات النظامية الحالية؟\nستعود تلقائيًا إذا تغيّرت بياناتها.";
export const DISMISS_CONFIRM_TITLE = "إخفاء التنبيهات";
export function restoredAlertsMessage(n: number): string {
  return n ? `تمت إعادة إظهار ${n} تنبيهًا.` : "لا توجد تنبيهات مخفية.";
}

// ===== ألوان التنبيهات (style.py:102-119) =====
export type AlertColor = "danger" | "warn" | "info" | "purple" | "amber";

export const ALERT_HEX: Record<AlertColor, string> = {
  danger: "#DC2626", // DANGER
  warn: "#D97706", // WARN
  info: "#4F46E5", // INFO / BRAND_600
  purple: "#7C3AED", // PURPLE
  amber: "#B45309", // AMBER_DEEP
};

/** ألوان صفوف النشاط (main_window.py:496): وارد أخضر · منصرف أحمر · غير ذلك BRAND_600 */
export const ACTIVITY_HEX = {
  in: "#15803D", // MONEY_IN
  out: "#B91C1C", // MONEY_OUT
  neutral: "#4F46E5", // BRAND_600
};

export const EMPTY_FEED_CLASS =
  "text-[#0F7A38] bg-[rgba(22,163,74,0.10)]"; // GREEN_DEEP على tint(GREEN, 0.10)

export interface DashboardAlert {
  /** بصمة sha1 لنص التنبيه — تُملأ خادميًا للإخفاء (alert_key المكتبي) */
  key?: string;
  color: AlertColor;
  text: string;
  /** عمر التنبيه بالأيام — الأقدم من 30 يومًا يُخفى مع عدّاد */
  age: number;
  /** بلا زر «مهمة» (تنبيه مهمة متأخرة أصلاً) */
  noConvert?: boolean;
}

// ===== تنسيقات مساعدة =====

/** {:,.3f} المكتبية — فواصل آلاف و3 خانات عشرية */
export function f3(v: number): string {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** {value:g} المكتبية — إسقاط الأصفار الزائدة بعد الفاصلة */
export function gFormat(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(Number(v).toPrecision(6)));
}

/** {amount:+,.3f} — علامة موجبة إلزامية للقيمة الموجبة (صف النشاط) */
export function fSigned(v: number): string {
  return (v >= 0 ? "+" : "") + f3(v);
}

/** عمر حدث بالأيام من نص تاريخ (مرآة _age_days — يتحمّل الناقص والفارغ) */
export function ageDaysFromDate(value: string | null | undefined, today: string): number {
  const text = String(value || "").trim().replace("T", " ");
  if (!text) return 0;
  const datePart = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return 0;
  const d = daysBetween(datePart, today);
  return Math.max(0, d);
}

// ===== 1) انتهاء العقود (main_window.py:283-285) =====

export interface ExpiringLike {
  contractNumber: string;
  customerName: string;
  remaining: number;
  endDate: string;
}

/** اللون بتدرّج المكتبي: كهرماني غامق ≤ آخر 7 · تحذير ≤ 60 · معلومة غير ذلك */
export function expiringColor(remaining: number): AlertColor {
  if (remaining <= 7) return "amber";
  if (remaining <= 60) return "warn";
  return "info";
}

export function expiringAlert(e: ExpiringLike): DashboardAlert {
  return {
    color: expiringColor(e.remaining),
    text: `⏰ العقد ${e.contractNumber} · ${e.customerName} ينتهي بعد ${e.remaining} يوم (${e.endDate})`,
    age: 0,
  };
}

// ===== 2) دفعات الخطة المتأخرة/المستحقة (main_window.py:287-292) =====

export interface PlanItemLike {
  title: string;
  customerName: string;
  contractNumber: string;
  remaining: number;
  daysDiff: number;
}

export function planItemAlert(p: PlanItemLike): DashboardAlert {
  if (p.daysDiff < 0) {
    return {
      color: "danger",
      text: `📆 دفعة متأخرة: «${p.title}» · ${p.customerName} (العقد ${p.contractNumber}) متبقٍ منه ${f3(p.remaining)} · تأخر ${-p.daysDiff} يوم`,
      age: Math.max(0, -p.daysDiff),
    };
  }
  return {
    color: "warn",
    text: `📆 دفعة تستحق خلال ${p.daysDiff} يوم: «${p.title}» · ${p.customerName} (${f3(p.remaining)})`,
    age: 0,
  };
}

// ===== 3) تعليقات مثبّتة قديمة (main_window.py:295-300) =====

/** اقتطاع المتن: 70 حرفًا ثم «…» (النصوص العربية حرف بحرف) */
export function truncateBody(body: string, max = 70): string {
  const clean = (body || "").replace(/\n/g, " ");
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

export interface StalePinnedLike {
  customerName: string;
  ageDays: number;
  body: string;
}

export function stalePinnedAlert(c: StalePinnedLike): DashboardAlert {
  return {
    color: "warn",
    text: `📌 تعليق مثبّت على ${c.customerName} منذ ${c.ageDays} يومًا بلا متابعة: ${truncateBody(c.body)}`,
    age: Math.max(0, Math.floor(c.ageDays)),
  };
}

// ===== 4) الشيكات المستحقة (main_window.py:303-311) =====

export interface ChequeLike {
  vtype: string; // receipt | payment
  voucherNumber: string;
  party: string;
  amount: number;
  daysLeft: number;
  chequeDueDate: string;
}

export function chequeKind(vtype: string): string {
  return vtype === "receipt" ? "قبض" : "صرف";
}

export function chequeAlert(ch: ChequeLike): DashboardAlert {
  const head = `🏦 شيك ${chequeKind(ch.vtype)} (${ch.voucherNumber}) من ${ch.party} بقيمة ${f3(ch.amount)}`;
  if (ch.daysLeft < 0) {
    return {
      color: "danger",
      text: `${head} · استحق منذ ${-ch.daysLeft} يوم (${ch.chequeDueDate})`,
      age: Math.max(0, -ch.daysLeft),
    };
  }
  if (ch.daysLeft === 0) {
    return { color: "danger", text: `${head} · يستحق اليوم!`, age: 0 };
  }
  return {
    color: "warn",
    text: `${head} · يستحق بعد ${ch.daysLeft} يوم (${ch.chequeDueDate})`,
    age: 0,
  };
}

// ===== 5) إشراف قرب نهاية الأساس (main_window.py:314-322) =====

/** «اليوم!» أو «بعد N يوم» أو «بعد N يومين» (حرفيًا كما المكتبي) */
export function supervisionDaysLeftText(daysLeft: number): string {
  if (daysLeft === 0) return "اليوم!";
  if (daysLeft > 2) return `بعد ${daysLeft} يوم`;
  return `بعد ${daysLeft} يومين`;
}

/** تسمية العقد للعميل — مرآة _label_from_row (extras_service.py:12) */
export function contractLabelFrom(
  contractName: string,
  description: string,
  contractDate: string
): string {
  const cname = ((contractName || description) || "").trim();
  if (cname) return cname.startsWith("عقد") ? cname : `عقد ${cname}`;
  return `العقد المبرم بتاريخ ${contractDate}`;
}

export interface NearBaseEndLike {
  customerName: string;
  label: string;
  daysLeft: number;
  baseEnd: string;
  monthly: number;
}

export function nearBaseEndAlert(s: NearBaseEndLike): DashboardAlert {
  return {
    color: "warn",
    text: `تنبيه إشراف: ${s.customerName} · ${s.label} تنتهي مدته الأساسية ${supervisionDaysLeftText(s.daysLeft)} (${s.baseEnd}) · بعدها يبدأ حساب أشهر التمديد (${f3(s.monthly)} للشهر)`,
    age: 0,
  };
}

// ===== 6) تمديد إشراف (main_window.py:324-334) =====

/** «شهر واحد» / «شهران» / «{N:g} شهر» حرفيًا */
export function extensionMonthsText(m: number): string {
  if (m === 1) return "شهر واحد";
  if (m === 2) return "شهران";
  return `${gFormat(m)} شهر`;
}

export interface ExtensionLike {
  customerName: string;
  label: string;
  baseEnd: string;
  billableExtension: number;
  extensionValue: number;
}

export function extensionAlert(s: ExtensionLike): DashboardAlert {
  return {
    color: "purple",
    text: `تمديد إشراف: ${s.customerName} · ${s.label} انتهت مدته الأساسية (${s.baseEnd}) وعليه ${extensionMonthsText(s.billableExtension)} تمديد بقيمة ${f3(s.extensionValue)} · للمخالصة: سند قبض أو إلغاء مدة من المدير`,
    age: 0,
  };
}

// ===== 7) تسويات البوابة المتأخرة (main_window.py:337-345) =====

export interface LateSettlementLike {
  gateway: string;
  day: string;
  expect: number;
  settleDate: string;
}

export function lateSettlementAlert(r: LateSettlementLike): DashboardAlert {
  return {
    color: "danger",
    text: `🏦 تسوية بوابة متأخرة: ${r.gateway} · يوم ${r.day} (متوقع ${f3(r.expect)} بتاريخ ${r.settleDate}) لم يصل البنك`,
    age: 0,
  };
}

// ===== 8) مراحل التنفيذ (workflow_service.py:5230-5248) =====

export interface ExecutionRowLike {
  contractNumber: string;
  customerName: string;
  stageName: string;
  kind: "overdue" | "near";
  daysIn: number;
  expected: number;
  over?: number;
  left?: number;
}

export function executionAlert(r: ExecutionRowLike): DashboardAlert {
  if (r.kind === "overdue") {
    const over = r.over ?? 0;
    return {
      color: "danger",
      text: `🏗 العقد ${r.contractNumber} · ${r.customerName} متأخر في «${r.stageName}»: ${r.daysIn} يوم من أصل ${r.expected} (تجاوز ${over} يوم)`,
      age: Math.max(0, over),
    };
  }
  const left = r.left ?? 0;
  return {
    color: "warn",
    text: `🏗 العقد ${r.contractNumber} · ${r.customerName} قارب على نهاية «${r.stageName}»: بقي ${left} يوم (${r.daysIn} من ${r.expected})`,
    age: 0,
  };
}

// ===== 9) متابعة التحصيل (main_window.py:372-375) =====

export interface OverdueCollectionLike {
  customerName: string;
  contractNumber: string;
  remaining: number;
  lastReceipt: string;
  daysSince: number;
}

export function overdueCollectionAlert(o: OverdueCollectionLike): DashboardAlert {
  const last = o.lastReceipt ? `آخر تحصيل: ${o.lastReceipt}` : "لم يُحصّل شيء بعد";
  return {
    color: "warn",
    text: `💰 متابعة تحصيل: ${o.customerName} · العقد ${o.contractNumber} عليه ${f3(o.remaining)} متبقية (${last} · منذ ${o.daysSince} يوم)`,
    age: Math.max(0, Math.floor(o.daysSince)),
  };
}

// ===== 10) العقود المتوقفة (main_window.py:377-379) =====

export function pausedAlert(p: { contractNumber: string; name: string }): DashboardAlert {
  return { color: "warn", text: `⏸ العقد ${p.contractNumber} · ${p.name} متوقف`, age: 0 };
}

// ===== 11) المهام المتأخرة (main_window.py:396-400) =====

export function overdueTaskAlert(t: { title: string; dueAt: string }, today: string): DashboardAlert {
  return {
    color: "danger",
    text: `📌 مهمة متأخرة: «${t.title}» · كان موعدها ${t.dueAt}`,
    age: ageDaysFromDate(t.dueAt, today),
    noConvert: true,
  };
}

// ===== بناء القائمة بالترتيب المكتبي والفلترة =====

export interface DashboardAlertsInput {
  expiring: ExpiringLike[];
  planItems: PlanItemLike[];
  stalePinned: StalePinnedLike[];
  cheques: ChequeLike[];
  nearBaseEnd: NearBaseEndLike[];
  extensions: ExtensionLike[];
  lateSettlements: LateSettlementLike[];
  execution: ExecutionRowLike[];
  overdueCollections: OverdueCollectionLike[];
  paused: { contractNumber: string; name: string }[];
  overdueTasks: { title: string; dueAt: string }[];
}

export function buildDashboardAlerts(input: DashboardAlertsInput, today: string): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  for (const e of input.expiring.slice(0, 25)) alerts.push(expiringAlert(e));
  for (const p of input.planItems.slice(0, 25)) alerts.push(planItemAlert(p));
  for (const c of input.stalePinned.slice(0, 10)) alerts.push(stalePinnedAlert(c));
  for (const ch of input.cheques.slice(0, 25)) alerts.push(chequeAlert(ch));
  for (const s of input.nearBaseEnd.slice(0, 25)) alerts.push(nearBaseEndAlert(s));
  for (const s of input.extensions.slice(0, 25)) alerts.push(extensionAlert(s));
  for (const r of input.lateSettlements.slice(0, 10)) alerts.push(lateSettlementAlert(r));
  for (const r of input.execution.slice(0, 25)) alerts.push(executionAlert(r));
  for (const o of input.overdueCollections.slice(0, 25)) alerts.push(overdueCollectionAlert(o));
  for (const p of input.paused.slice(0, 25)) alerts.push(pausedAlert(p));
  for (const t of input.overdueTasks.slice(0, 25)) alerts.push(overdueTaskAlert(t, today));
  return alerts;
}

/**
 * فلترة العرض: الأقدم من 30 يومًا يُخفى (بعدّاد) والمخفاة بمفتاح المستخدم
 * تُسقط صمتًا — مرآة main_window.py:403-415.
 */
export function filterAlerts(
  alerts: DashboardAlert[],
  dismissedKeys: Set<string>
): { fresh: DashboardAlert[]; hiddenCount: number } {
  const fresh: DashboardAlert[] = [];
  let hidden = 0;
  for (const a of alerts) {
    if (Math.floor(a.age || 0) > ALERT_MAX_AGE_DAYS) {
      hidden += 1;
      continue;
    }
    if (dismissedKeys.size > 0 && a.key && dismissedKeys.has(a.key)) continue;
    fresh.push(a);
  }
  return { fresh, hiddenCount: hidden };
}

// ===== صفوف النشاط (recent_activity — main_window.py:521-556) =====

export interface ActivityRow {
  when: string;
  kind: string;
  text: string;
  amount: number;
  sign: number; // 1 وارد | -1 منصرف | 0 حدث
  contractId: number | null;
  customerId: number | null;
  customerName: string;
  contractLabel: string;
}

/** مكان النشاط: اسم العقد ← العميل ← «—» */
export function activityWhere(a: ActivityRow): string {
  return a.contractLabel || a.customerName || "—";
}

export function activityBody(a: ActivityRow): string {
  const where = activityWhere(a);
  return a.text ? `${where} · ${a.text}` : where;
}

export function activityColor(a: ActivityRow): string {
  if (a.sign > 0) return ACTIVITY_HEX.in;
  if (a.sign < 0) return ACTIVITY_HEX.out;
  return ACTIVITY_HEX.neutral;
}

// ===== لوحة المهام المضمّنة (ui/tasks.py compact) =====

/** format_due_at — «DD-MM-YYYY  ·  H:MM ص/م» */
export function taskDueText(dueAt: string): { date: string; time: string; text: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(dueAt || "").trim());
  if (!m) return { date: dueAt || "", time: "", text: dueAt || "" };
  const hour = Number(m[4]);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const period = hour < 12 ? "ص" : "م";
  const dateTxt = `${m[3]}-${m[2]}-${m[1]}`;
  const time = `${h12}:${m[5]} ${period}`;
  return { date: dateTxt, time, text: `${dateTxt}  ·  ${time}` };
}

export interface TaskRowLike {
  title: string;
  dueAt: string; // YYYY-MM-DD HH:mm
  status: string; // مفتوحة | منجزة
  minutesLeft: number;
  overdue: boolean;
  customerName?: string | null;
  contractNumber?: string | null;
}

/** المتبقي — مرآة ui/tasks.py:344-360 حرفيًا */
export function taskLeftText(t: TaskRowLike): string {
  if (t.status === "منجزة") return "—";
  if (t.overdue) {
    const mins = -t.minutesLeft;
    return mins >= 60 ? `متأخرة ${Math.floor(mins / 60)} س ${mins % 60} د` : `متأخرة ${mins} د`;
  }
  const mins = t.minutesLeft;
  if (mins >= 1440) return `بعد ${Math.floor(mins / 1440)} يوم`;
  if (mins >= 60) return `بعد ${Math.floor(mins / 60)} س ${mins % 60} د`;
  return `بعد ${mins} د`;
}

/** عنوان الصف: «العنوان  (العميل · رقم العقد)» بالروابط الموجودة فقط */
export function taskTitleDisplay(t: TaskRowLike): string {
  const bits: string[] = [];
  if (t.customerName) bits.push(t.customerName);
  if (t.contractNumber) bits.push(t.contractNumber);
  return bits.length ? `${t.title}  (${bits.join(" · ")})` : t.title;
}

/** سطر الإجمالي أسفل اللوحة — ثلاث مسافات حول الفاصل كالمكتبي */
export function taskSummaryText(openCount: number, overdueCount: number): string {
  return `مهام مفتوحة: ${openCount}   |   متأخرة: ${overdueCount}`;
}

// ===== تحويل التنبيه إلى مهمة (main_window.py:1537-1548) =====

const ALERT_PREFIXES = ["⏰", "📆", "💰", "🏦", "⏸", "💾", "🗀", "📌"] as const;

/** سطر عنوان المهمة: سطر نص التنبيه بلا بادئته الرمزية */
export function stripAlertPrefix(text: string): string {
  let title = String(text || "").trim();
  for (const prefix of ALERT_PREFIXES) {
    if (title.startsWith(prefix)) {
      title = title.slice(prefix.length).trim();
      break;
    }
  }
  return title;
}

/** «قصير إذا طال»: 80 حرفًا وإلا 77 + «...» */
export function shortenTaskTitle(title: string): string {
  return title.length <= 80 ? title : title.slice(0, 77) + "...";
}

// ===== الترقيم (PaginationBar — widgets.py:977-1090) =====

export interface PageResult<T> {
  chunk: T[];
  page: number;
  pages: number;
  total: number;
  /** نص «صفحة X من Y   (a–b من N)» — فارغ إذا لا ترقيم */
  info: string;
}

export function pageSlice<T>(items: T[], page: number, size = ALERTS_PER_PAGE): PageResult<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.max(0, Math.min(page, pages - 1));
  const start = p * size;
  const chunk = items.slice(start, start + size);
  // الشريط كله يختفي لو النتائج تدخل في صفحة واحدة (widgets.py:1085)
  const info =
    total > size
      ? `صفحة ${p + 1} من ${pages}   (${start + 1}–${start + chunk.length} من ${total})`
      : "";
  return { chunk, page: p, pages, total, info };
}

// ===== إجماليات مساعدة للعدادات =====

/** عدادات الرئيسية — مرآة contract_service.dashboard_stats وui_data.dashboard_counts:
 *  عملاء/عقود/سندات = COUNT(*) الخام بلا أي فلترة حالة. */
export interface DashboardCounts {
  customers: number;
  contracts: number;
  vouchers: number;
  projects: number;
}
