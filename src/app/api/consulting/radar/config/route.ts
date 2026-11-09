import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, authGuard, moduleGuard, ok } from "@/lib/api-utils";
import { getUiPrefs, updateUiPrefs } from "@/lib/ui-prefs";
import { normalizeRadarSlotMinutes } from "@/lib/consulting-radar-core";

/**
 * إعدادات رادار المواعيد (بند NOVA 4 — docs/consulting-radar-design.md):
 * نطاق الدوام يُقرأ من إعدادات الموارد البشرية (hrWorkStart/hrWorkEnd) — لا يُعدل من هنا؛
 * PUT يضبط مدة الخانة فقط في uiPrefs.radar_slot_minutes (المدير فقط — كإعدادات الزيارات).
 */

/** الاشتقاق الموحد: دوام HR + مدة الخانة من uiPrefs */
async function buildResponse(companyId: number) {
  const setting = await db.setting.findUnique({ where: { companyId } });
  const { prefs } = await getUiPrefs();
  return {
    workStart: setting?.hrWorkStart || "08:00",
    workEnd: setting?.hrWorkEnd || "17:00",
    slotMinutes: normalizeRadarSlotMinutes(prefs.radar_slot_minutes),
  };
}

/** GET — إعدادات الرادار الحالية (نطاق الدوام + مدة الخانة) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  return ok(await buildResponse(guard.user.companyId || 0));
}

/** PUT {slotMinutes} — ضبط مدة الخانة (مدير فقط — القيم غير المسموحة تُطبَّع للافتراضي 60) */
export async function PUT(req: NextRequest) {
  const g = await adminGuard(req);
  if ("response" in g) return g.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slotMinutes = normalizeRadarSlotMinutes(body.slotMinutes);
  await updateUiPrefs({ radar_slot_minutes: slotMinutes });
  return ok({ slotMinutes });
}
