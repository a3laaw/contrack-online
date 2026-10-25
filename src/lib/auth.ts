import "server-only";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  PERMISSIONS,
  isSuperRole,
  roleDefaultAllowed,
} from "@/lib/permissions-catalog";
import { parseToken, SESSION_COOKIE, issueToken } from "@/lib/session-token";

export { PERMISSIONS, roleDefaultAllowed, isSuperRole } from "@/lib/permissions-catalog";
export type { PermissionSpec } from "@/lib/permissions-catalog";
export { SESSION_COOKIE, issueToken } from "@/lib/session-token";

export interface SessionUser {
  id: number;
  username: string;
  role: string; // admin | secretary | developer
  fullName: string;
  jobTitle: string;
  companyId: number;
  companyName: string;
  /** لوحة المطور (Task 97): شركة المستخدم الأم من سجله — تختلف عن companyId عند الدخول لشركة أخرى */
  homeCompanyId: number;
}

// ===== كلمات المرور: PBKDF2-SHA256 بـ 200,000 دورة — الملح بايتاته الخام bytes.fromhex(salt) كما المكتبي حرفيًا =====
// (مواءمة Task 60: المكتبي auth_service.py يمرر bytes.fromhex(salt) وليس نص hex — بلا هذا لا تُتحقق كلمات مرور المستخدمين المنقولين)
export function hashPassword(password: string, salt?: string) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, Buffer.from(s, "hex"), 200000, 32, "sha256").toString("hex");
  return { salt: s, hash };
}

export function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), 200000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

export function getBearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  return null;
}

export function getCookieToken(req: NextRequest): string | null {
  return req.cookies.get(SESSION_COOKIE)?.value || null;
}

export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = getBearerToken(req) || getCookieToken(req);
  if (!token) return null;
  const parsed = parseToken(token);
  if (!parsed) return null;
  const user = await db.user.findUnique({ where: { id: parsed.userId } });
  if (!user || !user.active) return null;
  const company = await db.company.findUnique({ where: { id: parsed.companyId } });
  if (!company || !company.isActive) return null;
  // مستخدم عادي: توكنه يجب أن يطابق شركته (إبطال الجلسة بعد النقل) —
  // المدير/المطور (أدوار فائقة) يسمح له بالتبديل عبر التوكن لأي شركة فعّالة
  if (!isSuperRole(user.role) && user.companyId !== parsed.companyId) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.fullName || user.username,
    jobTitle: user.jobTitle || "",
    companyId: company.id,
    companyName: company.name,
    homeCompanyId: user.companyId,
  };
}

export function sessionCookieOptionsFor(req: NextRequest) {
  const isHttps = (req.headers.get("x-forwarded-proto") || "") === "https";
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: isHttps,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function unauthorized(message = "يجب تسجيل الدخول") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "لا تملك صلاحية لهذا الإجراء") {
  return NextResponse.json({ error: message }, { status: 403 });
}


export async function hasPermission(userId: number, role: string, permKey: string): Promise<boolean> {
  if (isSuperRole(role)) return true;
  const row = await db.userPermission.findUnique({
    where: { userId_permKey: { userId, permKey } },
  });
  if (row) return row.allowed; // التخصيص الصريح مُقدَّم على افتراضيات الدور
  return roleDefaultAllowed(role, permKey); // افتراضيات الدور — كالمكتبي role_perm_defaults
}

/** خريطة صلاحيات كاملة لمستخدم (لبناء القائمة وAppShell) — استعلام واحد + افتراضيات الدور */
export async function permsForUser(userId: number, role: string): Promise<Record<string, boolean>> {
  if (isSuperRole(role)) {
    return Object.fromEntries(PERMISSIONS.map((p) => [p.key, true]));
  }
  const rows = await db.userPermission.findMany({ where: { userId }, select: { permKey: true, allowed: true } });
  const custom = new Map(rows.map((r) => [r.permKey, r.allowed]));
  return Object.fromEntries(
    PERMISSIONS.map((p) => [p.key, custom.has(p.key) ? (custom.get(p.key) as boolean) : roleDefaultAllowed(role, p.key)])
  );
}
