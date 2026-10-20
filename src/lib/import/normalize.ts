/**
 * مطبّعات الاستيراد — مرآة حرفية لدوال import_service.py:
 *   _name_key (:107-115) · _cell_str (:376-381) · _cell_date (:384-396)
 *   _cell_amount (:399-406) · _is_valid_date (:409-414) · _type_key (:188-191
 *   عبر search_utils.normalize). عتبة المبالغ 0.001 كالنظام الموحد.
 * نقية تمامًا (بلا db ولا server-only) لتُستخدم في المحلل والاختبارات.
 */

import { IMPORT_CONTRACT_STATUSES, IMPORT_PAY_METHODS } from "./sheets";

/** مفتاح مطابقة عربي مرن للاستيراد: مسافات/همزات/ياء/ألف مقصورة (_name_key) */
export function nameKey(text: unknown): string {
  let s = String(text ?? "").trim();
  s = s.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  s = s.replace(/[\u064b-\u065f\u0670]/g, "");
  s = s
    .replace(/أ/g, "ا")
    .replace(/إ/g, "ا")
    .replace(/آ/g, "ا")
    .replace(/ٱ/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
  s = s.replace(/\s+/g, " ");
  return s.toLowerCase();
}

/** تطبيع اسم نوع العقد للمقارنة (يتحمّل فروق الهمزة والتاء) — search_utils.normalize */
export function typeKey(name: unknown): string {
  let n = String(name ?? "").trim().toLowerCase();
  n = n.replace(/[ًٌٍَُِّْٰـ]/g, "");
  n = n
    .replace(/أ/g, "ا")
    .replace(/إ/g, "ا")
    .replace(/آ/g, "ا")
    .replace(/ٱ/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ـ/g, "");
  return n.replace(/\s+/g, " ").trim();
}

/** قيمة خلية نصية — الأعداد الصحيحة بلا كسر عشري (_cell_str) */
export function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v) && v === Math.trunc(v)) return String(Math.trunc(v));
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (obj.result !== undefined) return cellStr(obj.result);
    if (typeof obj.text === "string") return obj.text.trim();
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[]).map((t) => t.text ?? "").join("").trim();
    }
    return "";
  }
  return String(v).trim();
}

/** تطبيع التاريخ لصيغة YYYY-MM-DD · يقبل Date أو نص (_cell_date) */
export function cellDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const text = String(v).trim();
  for (const fmt of ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%m/%d/%Y"] as const) {
    const parsed = strptime(text, fmt);
    if (parsed) return parsed;
  }
  return text; // سيُرفض في الفحص إن كان غير صالح
}

/** محاكاة strptime لصيغ المكتبي الخمس فقط */
function strptime(text: string, fmt: string): string | null {
  const map: Record<string, RegExp> = {
    "%Y-%m-%d": /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    "%d/%m/%Y": /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    "%d-%m-%Y": /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    "%Y/%m/%d": /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
    "%m/%d/%Y": /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  };
  const re = map[fmt];
  if (!re) return null;
  const m = text.match(re);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (fmt === "%Y-%m-%d" || fmt === "%Y/%m/%d") {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if (fmt === "%d/%m/%Y" || fmt === "%d-%m-%Y") {
    d = +m[1]; mo = +m[2]; y = +m[3];
  } else {
    mo = +m[1]; d = +m[2]; y = +m[3];
  }
  return validYmd(y, mo, d);
}

function validYmd(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}`;
}

/** مبلغ من خلية خام — ينظف كل ما ليس رقمًا/نقطة/سالب (_cell_amount) */
export function cellAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = String(v).replace(/[^\d.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** تحقق تاريخ YYYY-MM-DD (_is_valid_date) */
export function isValidDate(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  return validYmd(+m[1], +m[2], +m[3]) !== null;
}

/** تمثيل Python للعدد العشري داخل نصوص المفاتيح: 200 ⇒ «200.0» */
export function floatRepr(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/** تنسيق مبلغ بالرسائل: {:,.3f} الحرفية (1,200.250) */
export function fmt3(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** حالة غير معروفة ⇒ «نشط» مع تحذير (import_service.py:523-526) */
export function normalizeStatus(status: string): { status: string; unknown: boolean } {
  if (status && !IMPORT_CONTRACT_STATUSES.includes(status)) {
    return { status: "نشط", unknown: true };
  }
  return { status: status || "نشط", unknown: false };
}

/** طريقة دفع غير معروفة ⇒ «أخرى» مع تحذير (import_service.py:733-735) */
export function normalizePayMethod(method: string): { method: string; unknown: boolean } {
  if (method && !IMPORT_PAY_METHODS.includes(method)) {
    return { method: "أخرى", unknown: true };
  }
  return { method: method || "أخرى", unknown: false };
}
