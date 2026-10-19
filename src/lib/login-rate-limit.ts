/**
 * حدّ محاولات تسجيل الدخول — المرحلة 2/أ من برومبت مطابقة المكتبي V9.15.19.
 * المرجع المكتبي: ui/login.py:19 MAX_ATTEMPTS = 3 ثم إغلاق البرنامج.
 * قرار الويب المعتمد في البرومبت: حد من جهة الخادم (حسب المستخدم + عنوان IP)
 * مع قفل مؤقت بدل الإغلاق + رسالة عربية + تسجيل في AuditLog.
 * التخزين: ذاكرة محلية (بلا وسيط خارجي) — تكفي لنسخة الخادم الواحد.
 * مدة القفل: 15 دقيقة (لم تحددها البرومبت ولا المكتبي — اختيار موثق لممارسة
 * الحماية المعتادة، ويُعدَّل من ثابت واحد هنا).
 */

/** عدد المحاولات المسموح بها — مطابق للمكتبي حرفيًا */
export const MAX_ATTEMPTS = 3;
/** مدة القفل المؤقت بالمللي ثانية */
export const LOCK_MS = 15 * 60 * 1000;

interface AttemptRecord {
  count: number;
  /** لحظة أول محاولة في النافذة الحالية */
  firstAt: number;
  /** لحظة انتهاء القفل (إن قُفل) */
  lockedUntil: number;
}

const attempts = new Map<string, AttemptRecord>();

/** مفتاح السجل: اسم المستخدم + عنوان IP (كما في البرومبت) */
export function attemptKey(username: string, ip: string): string {
  return `${(username || "").trim().toLowerCase()}|${ip || "unknown"}`;
}

/** استخراج عنوان IP من الترويسات (خلف وكيل: Vercel/Caddy) */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

export interface LockState {
  locked: boolean;
  /** الثواني المتبقية للقفل إن كان مفعّلًا */
  retryAfterSec: number;
}

/** هل هذا المفتاح مقفول الآن؟ */
export function lockState(key: string): LockState {
  const rec = attempts.get(key);
  if (!rec) return { locked: false, retryAfterSec: 0 };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  // انتهت نافذة القفل/النافذة القديمة — تهيئة
  if (rec.lockedUntil && rec.lockedUntil <= now) {
    attempts.delete(key);
    return { locked: false, retryAfterSec: 0 };
  }
  // نافذة عد المحاولات تُصفَّر بعد انتهاء مدة القفل الافتراضية من أول محاولة
  if (now - rec.firstAt > LOCK_MS) {
    attempts.delete(key);
    return { locked: false, retryAfterSec: 0 };
  }
  return { locked: false, retryAfterSec: 0 };
}

/** تسجيل محاولة فاشلة — يُرجع عدد المحاولات المتبقية قبل القفل */
export function registerFailedAttempt(key: string): { remaining: number; lockedNow: boolean } {
  const now = Date.now();
  let rec = attempts.get(key);
  if (!rec || now - rec.firstAt > LOCK_MS) {
    rec = { count: 0, firstAt: now, lockedUntil: 0 };
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCK_MS;
    attempts.set(key, rec);
    return { remaining: 0, lockedNow: true };
  }
  attempts.set(key, rec);
  return { remaining: MAX_ATTEMPTS - rec.count, lockedNow: false };
}

/** مسح المحاولات بعد نجاح الدخول */
export function clearAttempts(key: string): void {
  attempts.delete(key);
}
