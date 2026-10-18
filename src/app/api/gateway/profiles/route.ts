import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, audit } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { GatewayError, listProfiles, methodKeywords } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET: قائمة بروفايلات البوابات (الكلمات المفصولة كما هي + مصفوفة مساعدة) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  const profiles = await listProfiles(false);
  return ok({
    profiles: profiles.map((p) => ({
      ...p,
      methodsList: methodKeywords(p.methods),
    })),
  });
}

/** POST: إضافة بوابة (الاسم فريد) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم البوابة إلزامي.");
    const dup = await db.gatewayProfile.findUnique({ where: { name } });
    if (dup) return jsonError(`يوجد بروفايل بنفس الاسم «${name}».`);
    const tolerance =
      body.tolerance === undefined || body.tolerance === "" ? 0.005 : Number(body.tolerance) || 0;
    const p = await db.gatewayProfile.create({
      data: {
        name,
        bankAccount: String(body.bankAccount || "").trim(),
        methods: String(body.methods || "KNET").trim() || "KNET",
        lagDays: intOr(body.lagDays, 1),
        feeFixed: Number(body.feeFixed || 0) || 0,
        tolerance,
        lateDays: intOr(body.lateDays, 3),
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      },
    });
    await audit(db, {
      username: guard.user.username,
      action: "gateway_profile_create",
      entityType: "gateway_profiles",
      entityId: p.id,
      entityName: name,
      newStatus: String(p.feeFixed),
    });
    return ok({ profile: p }, 201);
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
