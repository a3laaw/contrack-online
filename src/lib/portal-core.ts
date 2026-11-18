/**
 * portal-core.ts — النواة النقية لر5 «بوابة العميل — رابط الكشف المؤقت الآمن»
 * (docs/customer-portal-design.md §4): دوال خالصة للتوليد والهاش وحكم الصلاحية
 * وحدود النافذة — تُختبَر bun قبل أي ربط مسار أو واجهة (نمط consulting-v1/opportunities).
 */

import { createHash, randomBytes } from "crypto";
import {
  PORTAL_DEFAULT_DAYS,
  PORTAL_IP_FAIL_RATE_PER_HOUR,
  PORTAL_LINK_CHOICES,
  PORTAL_LINK_STATUSES,
  PORTAL_RATE_WINDOW_MS,
  PORTAL_TOKEN_RATE_PER_HOUR,
  type PortalLinkDays,
  type PortalLinkStatus,
  type PortalRejectReason,
} from "./portal-constants";

/** الصف الذي يكفي للحكم — يأتي من قاعدة البيانات (كائنات تاريخ Prisma أو نص ISO) */
export interface PortalTokenRow {
  tokenHash: string;
  customerId: number;
  expiresAt: Date | string;
  revokedAt: Date | string | null;
}

/* ==================== التوليد والهاش (د1) ==================== */

/** هاش SHA-256 hex حتمي — نفس الرمز يعطي نفس الهاش دائمًا */
export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** توليد رمز جديد: 256-bit عشوائي → base64url (43 محرفًا) + هاشه (د1) */
export function generatePortalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashPortalToken(token) };
}

/* ==================== الصلاحية (د2/د3) ==================== */

/** موضع التاريخ إلى وقت مقارنة — يقبل كائن Date أو نص ISO (متسامح مع القاعدة) */
function asTime(value: Date | string | null): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * حكم صف الرمز — السبب الدقيق داخلي (للسجل) والطرف العام يرفض عامًا (د4).
 * ترتيب الفحص: مبطول قبل منتهٍ (الإبطال اليدوي فوري مهما كانت الصلاحية).
 */
export function validatePortalToken(
  row: PortalTokenRow | null,
  now: Date = new Date()
): { ok: true } | { ok: false; reason: PortalRejectReason } {
  if (!row) return { ok: false, reason: "not_found" };
  const revoked = asTime(row.revokedAt);
  if (revoked != null && revoked <= now.getTime()) return { ok: false, reason: "revoked" };
  const expires = asTime(row.expiresAt);
  if (expires == null || expires <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** تاريخ الانتهاء من المدة المختارة (د2) — خادمي بلا cron */
export function portalLinkExpiry(days: PortalLinkDays = PORTAL_DEFAULT_DAYS, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** شارة الحالة بالقائمة (د3) — نفس ترتيب الحكم أعلاه */
export function portalLinkStatus(
  row: Pick<PortalTokenRow, "expiresAt" | "revokedAt">,
  now: Date = new Date()
): PortalLinkStatus {
  const v = validatePortalToken({ ...row, tokenHash: "", customerId: 0 }, now);
  return v.ok ? "نشط" : v.reason === "revoked" ? "مبطول" : "منتهي";
}

/* ==================== حد الطلبات (د6) ==================== */

/** فحص نافذة نقّي — عداد النافذة لم يتجاوز الحد؟ */
export function checkRateWindow(count: number, limit: number): boolean {
  return count < limit;
}

/**
 * نوافذ الطلبات في الذاكرة المحلية (د6) — فئة نقية قابلة للاختبار كاملًا:
 * عدّاد انزلاقي لكل مفتاح (هاش الرمز أو IP) بنافذة ساعة، وتنظيف صحي للذاكرة
 * عند تجاوز السعة. على dev يعاد بناء الوحدة لكل طلب (تشتيت معطّل مؤقتًا)،
 * وعلى إنتاج lambda تحفظ الذاكرة بين الطلبات — والدفاع الفعلي إنتروبيا الرمز.
 */
export class RateWindowStore {
  private map = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly cap = 10_000
  ) {}

  /** عدد الطلبات الحية للنافذة — ينظف المفاتيح الميتة أثناء العدّ */
  count(key: string, now: number): number {
    const fresh = (this.map.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (fresh.length === 0) this.map.delete(key);
    else this.map.set(key, fresh);
    return fresh.length;
  }

  /** تسجيل طلب جديد — مع تنظيف صحي عند تجاوز السعة */
  push(key: string, now: number): void {
    if (this.map.size > this.cap) {
      for (const [k, v] of this.map) {
        const fresh = v.filter((t) => now - t < this.windowMs);
        if (fresh.length === 0) this.map.delete(k);
        else this.map.set(k, fresh);
      }
      if (this.map.size > this.cap) this.map.clear();
    }
    this.map.set(key, [...(this.map.get(key) ?? []), now]);
  }

  /** هل تجاوز المفتاح حده؟ (نمط المسار: count ثم push عند القرار) */
  exceeds(key: string, now: number): boolean {
    return !checkRateWindow(this.count(key, now), this.limit);
  }
}

/** ثوابت السياسة للتصدير (تستعملها المسارات) — د6 */
export const PORTAL_RATE_LIMITS = {
  tokenPerHour: PORTAL_TOKEN_RATE_PER_HOUR,
  ipFailPerHour: PORTAL_IP_FAIL_RATE_PER_HOUR,
  windowMs: PORTAL_RATE_WINDOW_MS,
} as const;

/* ==================== الروابط (د8) ==================== */

/** بناء رابط الكشف العام من أصل الطلب — يُعرض مرة واحدة عند الإنشاء (د1) */
export function portalStatementUrl(origin: string, token: string): string {
  return `${origin}/api/portal/statement/${encodeURIComponent(token)}`;
}

/** طول الرمز المتوقع — فحص سريع قبل الهاش (base64url لـ32 بايت = 43 محرفًا) */
export const PORTAL_TOKEN_LENGTH = 43;

/** عدد المدد المعتمدة في الحوار — فحص اتساق القوائم */
export const PORTAL_CHOICES_COUNT = PORTAL_LINK_CHOICES.length;
export const PORTAL_STATUS_COUNT = PORTAL_LINK_STATUSES.length;
