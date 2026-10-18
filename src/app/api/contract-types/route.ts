import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { numOr } from "@/lib/contrack-server";

const PRICING_MODES = ["lump", "unit", "items", "bundle"];

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const types = await db.contractType.findMany({
    include: { _count: { select: { paymentTemplates: true } } },
    orderBy: { name: "asc" },
  });
  return ok({
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      defaultAmount: Number(t.defaultAmount),
      notes: t.notes,
      active: t.active,
      manualTrack: t.manualTrack,
      unitLabel: t.unitLabel,
      unitPrice: Number(t.unitPrice),
      pricingMode: t.pricingMode,
      isSupervision: t.isSupervision,
      templatesCount: t._count.paymentTemplates,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم نوع العقد مطلوب");
  const exists = await db.contractType.findUnique({ where: { name } });
  if (exists) return jsonError("اسم نوع العقد موجود مسبقًا");

  const pricingMode = String(body.pricingMode || "lump");
  if (!PRICING_MODES.includes(pricingMode)) return jsonError("نمط التسعير غير صحيح");
  const isSupervision = Boolean(body.isSupervision);
  if (pricingMode === "bundle" && isSupervision) return jsonError("النوع الشامل لا يكون إشرافيًا");

  const type = await db.contractType.create({
    data: {
      name,
      defaultAmount: numOr(body.defaultAmount, 0),
      notes: String(body.notes || ""),
      active: body.active !== undefined ? Boolean(body.active) : true,
      manualTrack: Boolean(body.manualTrack),
      unitLabel: String(body.unitLabel || ""),
      unitPrice: numOr(body.unitPrice, 0),
      pricingMode,
      isSupervision,
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "contractType",
    entityId: type.id,
    entityName: name,
  });
  return ok({ type: { ...type, defaultAmount: Number(type.defaultAmount), unitPrice: Number(type.unitPrice) } }, 201);
}
