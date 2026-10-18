import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { VISITS_CONFIG } from "@/lib/visits-server";

/**
 * إعدادات جدول الزيارات — GET/PUT /api/visits/config
 *
 * القيم الحالية ثابتة: ساعات العمل 8→17 والحصة 60 دقيقة.
 * ملاحظة توثيقية: جدول Setting في schema الحالي لا يملك أعمدة لساعات الزيارات،
 * وجدول FeatureFlag يقبل قيمة enabled منطقية فقط — لذا لا مكان تخزين صحيح الآن.
 * المعتمد هنا (بتعليمات المهمة): إعادة القيم الثابتة وقبول PUT بتجاهل صامت،
 * حتى تُضاف أعمدة إعدادات حقيقية لاحقًا (غير مسموح تعديل schema في هذه المرحلة).
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;

  return ok({
    startHour: VISITS_CONFIG.startHour,
    endHour: VISITS_CONFIG.endHour,
    slotMinutes: VISITS_CONFIG.slotMinutes,
    editable: false,
    note: "القيم ثابتة حاليًا — لا يوجد مكان تخزين في القاعدة حتى تُضاف أعمدة الإعدادات",
  });
}

/** قبول قيم جديدة بتجاهل صامت — تُعاد القيم الثابتة دائمًا */
export async function PUT(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;

  // التجاهل الصامت المقصود — لا تخزين متاح حتى الآن
  return ok({
    startHour: VISITS_CONFIG.startHour,
    endHour: VISITS_CONFIG.endHour,
    slotMinutes: VISITS_CONFIG.slotMinutes,
    editable: false,
    note: "تم تجاهل التعديل — القيم ثابتة حتى إضافة أعمدة الإعدادات",
  });
}
