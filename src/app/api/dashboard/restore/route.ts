import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, ok } from "@/lib/api-utils";

/**
 * إعادة إظهار كل التنبيهات المخفاة للمستخدم الحالي — POST /api/dashboard/restore
 * مرآة workflow_service.restore_dismissed_alerts: حذف بصمات المستخدم كلها
 * ويعيد عدد ما أُعيد إظهاره.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const res = await db.dismissedAlert.deleteMany({ where: { userId: guard.user.id } });
  return ok({ restored: res.count });
}
