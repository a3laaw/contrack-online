// ============================================================
// session-token.ts — رمز الجلسة الموقّع: userId.companyId.timestamp.hmac
// (Task 85 — SaaS: الشركة داخل التوكن نفسه لقراءتها وقت الاستعلام
//  في غلاف Prisma عبر cookies() دون الاعتماد على AsyncLocalStorage
//  الذي ينهار تحت Bun مع enterWith)
// ============================================================
import "server-only";
import crypto from "crypto";

export const SESSION_COOKIE = "ctrk_session";
const AUTH_SECRET = process.env.AUTH_SECRET || "contrack-local-secret-v9";

function sign(payload: string) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("hex").slice(0, 32);
}

export function issueToken(userId: number, companyId: number) {
  const payload = `${userId}.${companyId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export interface ParsedToken {
  userId: number;
  companyId: number;
}

/** التوكن القديم (3 أجزاء بلا شركة) يُرفض — إعادة دخول إجبارية مرة واحدة */
export function parseToken(token: string): ParsedToken | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  if (sign(payload) !== parts[3]) return null;
  const userId = parseInt(parts[0], 10);
  const companyId = parseInt(parts[1], 10);
  if (!Number.isFinite(userId) || !Number.isFinite(companyId)) return null;
  return { userId, companyId };
}
