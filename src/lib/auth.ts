import "server-only";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "ctrk_session";
const AUTH_SECRET = process.env.AUTH_SECRET || "contrack-local-secret-v9";

export interface SessionUser {
  id: number;
  username: string;
  role: string; // admin | secretary | developer
  fullName: string;
  jobTitle: string;
}

// ===== كلمات المرور: PBKDF2-SHA256 بـ 200,000 دورة (كالمصدر) =====
export function hashPassword(password: string, salt?: string) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, s, 200000, 32, "sha256").toString("hex");
  return { salt: s, hash };
}

export function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = crypto.pbkdf2Sync(password, salt, 200000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

// ===== الرموز: id.timestamp.hmac =====
function sign(payload: string) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("hex").slice(0, 32);
}

export function issueToken(userId: number) {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function parseToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  if (sign(payload) !== parts[2]) return null;
  const id = parseInt(parts[0], 10);
  return Number.isFinite(id) ? id : null;
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
  const userId = parseToken(token);
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.fullName || user.username,
    jobTitle: user.jobTitle || "",
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

// كتالوج الصلاحيات (37 مفتاحًا حرفيًا من المصدر — auth_service)
export const PERMISSIONS: { key: string; label: string; group: string }[] = [
  { key: "screen_customers", label: "شاشة العملاء", group: "الشاشات" },
  { key: "screen_contracts", label: "شاشة العقود", group: "الشاشات" },
  { key: "screen_vouchers", label: "شاشة السندات", group: "الشاشات" },
  { key: "screen_subcontractors", label: "شاشة المقاولين", group: "الشاشات" },
  { key: "screen_custody", label: "شاشة العُهد", group: "الشاشات" },
  { key: "screen_invoices", label: "شاشة الفواتير", group: "الشاشات" },
  { key: "screen_gateway", label: "البوابة المالية", group: "الشاشات" },
  { key: "screen_clearing", label: "شاشة التصفية", group: "الشاشات" },
  { key: "screen_other_company", label: "الشركة الأخرى", group: "الشاشات" },
  { key: "screen_tasks", label: "شاشة المهام", group: "الشاشات" },
  { key: "screen_visits", label: "جدول الزيارات", group: "الشاشات" },
  { key: "screen_archive", label: "الأرشيف", group: "الشاشات" },
  { key: "report_customers_balances", label: "تقرير العملاء والأرصدة", group: "التقارير" },
  { key: "report_stage_dues", label: "مستحقات المراحل", group: "التقارير" },
  { key: "report_supervision_delays", label: "تأخير الإشراف", group: "التقارير" },
  { key: "report_subcontractors", label: "تقرير المقاولين", group: "التقارير" },
  { key: "report_vouchers", label: "الإيرادات والمصروفات", group: "التقارير" },
  { key: "report_expenses", label: "تفصيل المصروفات", group: "التقارير" },
  { key: "report_cashflow", label: "التدفق النقدي", group: "التقارير" },
  { key: "report_contracts", label: "تقارير العقود", group: "التقارير" },
  { key: "report_execution", label: "مراحل التنفيذ", group: "التقارير" },
  { key: "report_prospects", label: "الفرص البيعية", group: "التقارير" },
  { key: "report_other_company", label: "كشف الشركة الأخرى", group: "التقارير" },
  { key: "report_journal", label: "دفتر اليومية", group: "التقارير" },
  { key: "report_gateway_summary", label: "ملخص البوابة", group: "التقارير" },
  { key: "action_add_contract", label: "إضافة عقد", group: "الإجراءات" },
  { key: "action_edit_contract", label: "تعديل عقد", group: "الإجراءات" },
  { key: "action_cancel_contract", label: "إلغاء عقد", group: "الإجراءات" },
  { key: "action_add_voucher", label: "إضافة سند", group: "الإجراءات" },
  { key: "action_cancel_voucher", label: "إلغاء سند", group: "الإجراءات" },
  { key: "action_add_payment", label: "إضافة دفعة", group: "الإجراءات" },
  { key: "action_edit_payment", label: "تعديل دفعة", group: "الإجراءات" },
  { key: "action_addendum_approve", label: "اعتماد ملحق", group: "الإجراءات" },
  { key: "action_claim_manage", label: "إدارة المطالبات", group: "الإجراءات" },
  { key: "action_stage_advance", label: "تخطي/إرجاع مرحلة", group: "الإجراءات" },
  { key: "action_edit_voucher_desc", label: "تعديل وصف السند", group: "الإجراءات" },
  { key: "action_backups", label: "النسخ الاحتياطي", group: "الإجراءات" },
];

export function isSuperRole(role: string) {
  return role === "admin" || role === "developer";
}

export async function hasPermission(userId: number, role: string, permKey: string): Promise<boolean> {
  if (isSuperRole(role)) return true;
  const row = await db.userPermission.findUnique({
    where: { userId_permKey: { userId, permKey } },
  });
  if (!row) return true; // المفتاح المجهول لا يقيّد (كالمصدر)
  return row.allowed;
}
