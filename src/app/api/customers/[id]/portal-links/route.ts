import { NextRequest } from "next/server";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { db } from "@/lib/db";
import {
  PORTAL_DEFAULT_DAYS,
  isPortalLinkDays,
} from "@/lib/portal-constants";
import {
  generatePortalToken,
  portalLinkExpiry,
  portalLinkStatus,
} from "@/lib/portal-core";

type P = { params: Promise<{ id: string }> };

/**
 * ر5 — روابط كشف العميل المؤقتة (docs/customer-portal-design.md د8/د10):
 * GET  — قائمة روابط العميل (بلا نص صريح أبدًا — د1)
 * POST — إنشاء رابط جديد: يولد 256-bit ويخزن SHA-256 هاشًا ويُعيد النص الصريح مرة واحدة (د1/د2)
 */

/** GET /api/customers/[id]/portal-links — قائمة الروابط بشارات الحالة وآخر استخدام (د3/د7) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف العميل غير صالح");

  const customer = await db.customer.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!customer) return jsonError("العميل غير موجود", 404);

  const rows = await db.customerPortalToken.findMany({
    where: { customerId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      lastUsedIp: true,
    },
  });

  return ok(
    rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      lastUsedIp: r.lastUsedIp,
      status: portalLinkStatus(r),
    }))
  );
}

/** POST /api/customers/[id]/portal-links — إنشاء رابط: النص الصريح يُعرض مرة واحدة (د1) */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف العميل غير صالح");

  let body: { days?: unknown } = {};
  try {
    body = (await req.json()) as { days?: unknown };
  } catch {
    body = {};
  }
  // د2 — الافتراضي 90 إن لم يُرسل؛ ما أُرسل خارج المفردات يُرفض
  const daysRaw = body.days === undefined || body.days === null ? PORTAL_DEFAULT_DAYS : body.days;
  if (!isPortalLinkDays(daysRaw)) {
    return jsonError("مدة الرابط غير معتمدة — المسموح 30 أو 90 أو 365 يومًا.");
  }
  const days = daysRaw;

  const customer = await db.customer.findUnique({
    where: { id },
    select: { id: true, name: true, customerCode: true },
  });
  if (!customer) return jsonError("العميل غير موجود", 404);

  // د1 — التوليد والهاش: الصريح لا يُخزن؛ الهاش فقط يُكتب
  const { token, tokenHash } = generatePortalToken();
  const expiresAt = portalLinkExpiry(days);

  const created = await db.$transaction(async (tx) => {
    const row = await tx.customerPortalToken.create({
      data: {
        customerId: id,
        tokenHash,
        expiresAt,
        createdBy: guard.user.id,
      },
      select: { id: true, expiresAt: true },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إنشاء رابط كشف مؤقت لعميل",
      entityType: "customerPortalToken",
      entityId: row.id,
      entityName: `${customer.customerCode || customer.id} — ${customer.name}`,
      newStatus: `صلاحية ${days} يومًا حتى ${row.expiresAt.toISOString().slice(0, 10)}`,
    });
    return row;
  });

  // النص الصريح يخرج هنا حصرًا — القاعدة لا تحفظه إطلاقًا (د1)
  return ok(
    {
      id: created.id,
      token,
      expiresAt: created.expiresAt.toISOString(),
    },
    201
  );
}
