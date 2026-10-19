import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { numOr } from "@/lib/contrack-server";
import { r3 } from "@/lib/contrack-core";
import { PRICING_MODES, validateTypeInput } from "@/lib/contract-types-admin";

/** أنواع العقود — لكل نوع عدد عقوده (contractsCount) وعدد قوالب دفعاته */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const [types, counts] = await Promise.all([
    db.contractType.findMany({
      include: { _count: { select: { paymentTemplates: true } } },
      orderBy: { name: "asc" },
    }),
    // الربط بالعقود اسمي (contract.contractType نص) — تُحسب مجموعةً ثم تُطابَق بالاسم
    db.contract.groupBy({ by: ["contractType"], _count: { _all: true } }),
  ]);
  const countMap = new Map(counts.map((c) => [c.contractType, c._count._all]));

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
      contractsCount: countMap.get(t.name) ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();

  // حرس المكتبي الحرفي: الاسم ← المبلغ ← سعر الوحدة ← الشامل/الإشرافي (add_type)
  const defaultAmount = r3(numOr(body.defaultAmount, 0));
  const unitPrice = r3(numOr(body.unitPrice, 0));
  const guardError = validateTypeInput({
    name,
    defaultAmount,
    unitPrice,
    pricingMode: body.pricingMode !== undefined ? String(body.pricingMode) : undefined,
    isSupervision: body.isSupervision !== undefined ? Boolean(body.isSupervision) : undefined,
  });
  if (guardError) return jsonError(guardError);

  const exists = await db.contractType.findUnique({ where: { name } });
  if (exists) return jsonError(`النوع «${name}» موجود بالفعل.`);

  const pricingMode = String(body.pricingMode || "lump");
  if (!PRICING_MODES.some((m) => m.value === pricingMode)) return jsonError("نمط التسعير غير صحيح");

  const type = await db.contractType.create({
    data: {
      name,
      defaultAmount,
      notes: String(body.notes || ""),
      active: body.active !== undefined ? Boolean(body.active) : true,
      manualTrack: Boolean(body.manualTrack),
      unitLabel: String(body.unitLabel || "").trim(),
      unitPrice,
      pricingMode,
      isSupervision: Boolean(body.isSupervision),
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
