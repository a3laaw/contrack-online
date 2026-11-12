import { NextRequest } from "next/server";
import { adminGuard, authGuard, jsonError, ok } from "@/lib/api-utils";
import { ALLOWED_SLOT_MINUTES, writeVisitSlotConfig } from "@/lib/visit-slots";
import { getVisitsConfig } from "@/lib/visits-server";

/**
 * إعدادات جدول الزيارات — GET/PUT /api/visits/config (توحيد الجلسة 13)
 *
 * التخزين الفعلي في Settings.uiPrefs لكل شركة عبر lib/visit-slots —
 * كانت القيم ثابتة والـPUT تجاهلًا صامتًا، والآن تُعدَّل من تاب «جدول الزيارات»
 * وتحكم صفوف شبكة الزيارات مباشرة (/api/visits يبني الخانات من المصدر نفسه).
 * القواعد الحرفية من visits_service.py (spec-8-f §2):
 *   slot ∈ {15,20,30,60,90,120} وإلا رفض؛ start ∈ [0,23]؛ end ∈ [1,24]؛ end>start.
 * (مسار /api/settings/visit-slot الموازي حُذف — كان يتيمًا بلا مستهلك UI)
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;

  const cfg = await getVisitsConfig();
  const manager = guard.user.role === "admin" || guard.user.role === "developer";
  return ok({ ...cfg, editable: manager });
}

/** حفظ القيم — مدير/مطور فقط (adminGuard كالمكتبية) */
export async function PUT(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const slotMinutes = Math.trunc(Number(body.slotMinutes));
  if (!(ALLOWED_SLOT_MINUTES as readonly number[]).includes(slotMinutes)) {
    return jsonError(`مدة الحصة يجب أن تكون إحدى القيم: ${ALLOWED_SLOT_MINUTES.join(" / ")} دقيقة`);
  }

  const startHour = Math.trunc(Number(body.startHour));
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    return jsonError("ساعة البداية يجب أن تكون بين 0 و 23");
  }
  const endHour = Math.trunc(Number(body.endHour));
  if (!Number.isInteger(endHour) || endHour < 1 || endHour > 24) {
    return jsonError("ساعة النهاية يجب أن تكون بين 1 و 24");
  }
  if (endHour <= startHour) {
    return jsonError("ساعة النهاية يجب أن تكون بعد ساعة البداية");
  }

  await writeVisitSlotConfig({ slotMinutes, startHour, endHour });
  return ok({ slotMinutes, startHour, endHour, editable: true });
}
