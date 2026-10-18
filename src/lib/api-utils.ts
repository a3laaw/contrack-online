import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getSessionUser,
  hasPermission,
  isSuperRole,
  unauthorized,
  forbidden,
  SessionUser,
} from "@/lib/auth";

export { unauthorized, forbidden } from "@/lib/auth";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data as unknown as Record<string, unknown>, { status });
}

/** حارس المصادقة: يعيد المستخدم أو استجابة خطأ */
export async function authGuard(
  req: NextRequest,
  permKey?: string
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) return { response: unauthorized() };
  if (permKey && !isSuperRole(user.role)) {
    const allowed = await hasPermission(user.id, user.role, permKey);
    if (!allowed) return { response: forbidden() };
  }
  return { user };
}

export async function adminGuard(req: NextRequest): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) return { response: unauthorized() };
  if (!isSuperRole(user.role)) return { response: forbidden("هذا الإجراء للمدير فقط") };
  return { user };
}

/** ترقيم ذري عبر number_sequences — داخل معاملة إن مُمرَّرت */
export async function nextNumber(prefix: string, width = 4, tx?: Prisma.TransactionClient): Promise<string> {
  const client = tx || db;
  const name = `voucher:${prefix}`;
  const row = await client.numberSequence.upsert({
    where: { name },
    update: { lastNo: { increment: 1 } },
    create: { name, lastNo: 1 },
  });
  return `${prefix}-${String(row.lastNo).padStart(width, "0")}`;
}

export async function nextAddendumNumber(contractId: number, tx?: Prisma.TransactionClient): Promise<string> {
  const client = tx || db;
  const name = `addendum:contract:${contractId}`;
  const row = await client.numberSequence.upsert({
    where: { name },
    update: { lastNo: { increment: 1 } },
    create: { name, lastNo: 1 },
  });
  return `ADD-${String(row.lastNo).padStart(3, "0")}`;
}

export async function nextClaimNumber(tx?: Prisma.TransactionClient): Promise<string> {
  return nextNumber("CLM", 4, tx);
}

/** تحقق تاريخ YYYY-MM-DD */
export function parseDay(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? "" : s;
}

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** عتبة المقارنة المالية الموحدة 0.001 */
export const EPS = 0.001;
export function isZero(n: number | Prisma.Decimal) {
  return Math.abs(Number(n)) < EPS;
}

/** كتابة سطر تدقيق */
export async function audit(
  tx: Prisma.TransactionClient,
  data: {
    username: string;
    action: string;
    entityType: string;
    entityId?: number;
    entityName?: string;
    oldStatus?: string;
    newStatus?: string;
    reason?: string;
  }
) {
  await tx.auditLog.create({
    data: {
      username: data.username,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId ?? 0,
      entityName: data.entityName ?? "",
      oldStatus: data.oldStatus ?? "",
      newStatus: data.newStatus ?? "",
      reason: data.reason ?? "",
    },
  });
}

/** تطبيع البحث العربي (مطابق لـ search_utils.py) */
export function normalizeArabic(s: string): string {
  return (s || "")
    .replace(/[\u064B-\u065F\u0670]/g, "") // التشكيل
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .trim()
    .toLowerCase();
}
