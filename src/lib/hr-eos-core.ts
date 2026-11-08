// ============================================================
// ConTrack Online — HR-2: نواة حاسبة نهاية الخدمة النقية (bun test فقط)
// قانون العمل الكويتي رقم 6 لسنة 2010: م53 (كامل) · م51 (استقالة سلالم + زواج/ولادة)
// · م41 (فصل لسبب قانوني = بلا مكافأة) · م44 (انصراف مشروع = كامل) — docs/hr-2-design.md §6
// د4 المعتمد: نصف أجر شهر عن كل سنة من الخمس الأولى + أجر شهر كامل عن كل سنة تالية
// + كسر السنة بنسبته + سقف 18 شهرًا — على آخر أجر أساسي حرفًا من نص القانون.
// ============================================================

import { r3, LEAVE_DAY_DIVISOR } from "./hr-constants";

export { LEAVE_DAY_DIVISOR };

/** سقف المكافأة: أجر سنة ونصف (م53 الفقرة الأخيرة) */
export const EOS_CAP_MONTHS = 18;

export type EosRule = "full" | "resignation" | "none" | "agreement";

export interface EosScenario {
  value: string;
  label: string;
  rule: EosRule;
  note: string;
}

/** السيناريوهات الثمانية المعتمدة — القيم عربية كما تُخزن في EmployeeTermination.scenario */
export const EOS_SCENARIOS: EosScenario[] = [
  { value: "انتهاء عقد", label: "انتهاء عقد", rule: "full", note: "م53 — كامل المكافأة" },
  { value: "استقالة", label: "استقالة", rule: "resignation", note: "م51 — سلالم السنوات" },
  { value: "فصل (م41)", label: "فصل لسبب من م41", rule: "none", note: "الفصل للسبب القانوني يحرم المكافأة" },
  { value: "انصراف (م44)", label: "انصراف لسبب من م44", rule: "full", note: "الانصراف مشروع — كامل المكافأة" },
  { value: "وفاة", label: "وفاة", rule: "full", note: "كامل المكافأة للورثة" },
  { value: "زواج", label: "زواج (خلال 6 أشهر)", rule: "full", note: "م51 — العاملة تستحق كامل المكافأة" },
  { value: "ولادة", label: "ولادة (خلال 3 أشهر)", rule: "full", note: "م51 — العاملة تستحق كامل المكافأة" },
  { value: "اتفاق الطرفين", label: "اتفاق الطرفين", rule: "agreement", note: "كامل كافتراضي — المبلغ قابل للتعديل قبل الاستقرار" },
];

export function eosScenarioByValue(value: string): EosScenario | undefined {
  return EOS_SCENARIOS.find((s) => s.value === value);
}

/**
 * سنوات الخدمة: سنوات كاملة + كسر السنة (الأيام المتبقية ÷ 365) — r3.
 * تاريخ غير صالح أو نهاية قبل البداية ⇒ 0 (الأمان — الواجهة تحقق أولًا).
 */
export function eosServiceYears(hireDate: string, endDate: string): number {
  const h = new Date(`${hireDate}T00:00:00Z`);
  const e = new Date(`${endDate}T00:00:00Z`);
  if (!hireDate || !endDate || !Number.isFinite(h.getTime()) || !Number.isFinite(e.getTime()) || e < h) return 0;
  const days = (e.getTime() - h.getTime()) / 86_400_000;
  const whole = Math.floor(days / 365);
  const fraction = (days - whole * 365) / 365;
  return r3(whole + fraction);
}

/**
 * المكافأة الكاملة (م53) بكسر السنة بالنسبة + سقف 18 شهرًا:
 * أول 5 سنوات: نصف شهر لكل سنة · ما بعدها: شهر كامل لكل سنة.
 * wage = آخر أجر أساسي شهري.
 */
export function eosFullGratuity(wage: number, years: number): number {
  const w = Math.max(0, wage || 0);
  const y = Math.max(0, years || 0);
  const firstPart = Math.min(y, 5) * 0.5 * w;
  const restPart = Math.max(0, y - 5) * 1.0 * w;
  const raw = firstPart + restPart;
  const cap = EOS_CAP_MONTHS * w;
  return r3(Math.min(raw, cap));
}

/** هل ضُرب سقف 18 شهرًا؟ — للتقرير المطبوع */
export function eosCapApplied(wage: number, years: number): boolean {
  const w = Math.max(0, wage || 0);
  const y = Math.max(0, years || 0);
  const raw = Math.min(y, 5) * 0.5 * w + Math.max(0, y - 5) * 1.0 * w;
  return w > 0 && raw > EOS_CAP_MONTHS * w + 1e-9;
}

/**
 * نسبة الاستقالة (م51): <3 سنوات ⇒ 0 · 3–5 ⇒ الثلث · 5–10 ⇒ الثلثان · ≥10 ⇒ الكامل.
 */
export function resignationFraction(years: number): number {
  const y = Math.max(0, years || 0);
  if (y < 3) return 0;
  if (y < 5) return 1 / 3;
  if (y < 10) return 2 / 3;
  return 1;
}

export interface EosInput {
  wage: number; // آخر أجر أساسي شهري (Employee.salary)
  hireDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  scenario: string; // إحدى EOS_SCENARIOS
  leaveBalanceDays: number; // رصيد السنوي المعاد حسابه لحظة النهاية (recountAnnualBalance)
  agreementAmount?: number | null; // لسيناريو اتفاق الطرفين — يُستبدل به الكامل قبل السقف
}

export interface EosResult {
  years: number; // سنوات الخدمة (لقطة)
  fullGratuity: number; // المكافأة الكاملة م53 (بعد السقف) — تظهر بالتقرير دائمًا
  capped: boolean; // هل ضُرب السقف؟
  fractionApplied: number; // النسبة المطبقة (0..1) — 1 لغير الاستقالة
  gratuity: number; // المستحق فعليًا حسب السيناريو
  leaveEncashment: number; // بدل الإجازات: الرصيد × (الأجر ÷ 26) — خارج سقف المكافأة
  total: number; // gratuity + leaveEncashment
}

/**
 * الحساب الموحد — كل الأرقام لقطات قابلة للعرض بالتقرير المطبوع:
 * الاستقالة تُحتسب على المكافأة الكاملة (بعد سقفها) × نسبة م51.
 * الاتفاق: agreementAmount يحدد المكافأة مباشرة (≥0) إن أُرسل.
 */
export function computeEos(input: EosInput): EosResult {
  const scenario = eosScenarioByValue(input.scenario);
  const years = eosServiceYears(input.hireDate, input.endDate);
  const fullGratuity = eosFullGratuity(input.wage, years);
  const capped = eosCapApplied(input.wage, years);

  let gratuity = 0;
  let fractionApplied = 1;
  if (scenario) {
    switch (scenario.rule) {
      case "full":
        gratuity = fullGratuity;
        break;
      case "resignation":
        fractionApplied = resignationFraction(years);
        gratuity = r3(fullGratuity * fractionApplied);
        break;
      case "none":
        gratuity = 0;
        fractionApplied = 0;
        break;
      case "agreement": {
        const override = input.agreementAmount;
        if (override != null && Number.isFinite(Number(override)) && Number(override) >= 0) {
          gratuity = r3(Number(override));
          fractionApplied = fullGratuity > 0 ? Math.min(1, gratuity / fullGratuity) : 1;
        } else {
          gratuity = fullGratuity;
        }
        break;
      }
    }
  }

  const leaveEncashment = r3(Math.max(0, input.leaveBalanceDays || 0) * (Math.max(0, input.wage || 0) / LEAVE_DAY_DIVISOR));
  return {
    years,
    fullGratuity,
    capped,
    fractionApplied,
    gratuity: r3(gratuity),
    leaveEncashment,
    total: r3(gratuity + leaveEncashment),
  };
}
