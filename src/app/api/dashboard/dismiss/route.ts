import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { authGuard, ok } from "@/lib/api-utils";

/**
 * إخفاء التنبيهات النظامية للمستخدم الحالي — POST /api/dashboard/dismiss
 * مرآة workflow_service.dismiss_alerts (V9.15.6): بصمة sha1 لنص كل تنبيه،
 * وإذا تغيّرت بياناته (مبلغ/تاريخ/حالة) يعود ظاهرًا تلقائيًا.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as { texts?: unknown };
  const texts = Array.isArray(body.texts)
    ? body.texts.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  if (texts.length === 0) return ok({ dismissed: 0 });

  const keys = [...new Set(texts.map((t) => createHash("sha1").update(t, "utf8").digest("hex")))];
  const res = await db.dismissedAlert.createMany({
    data: keys.map((alertKey) => ({ userId: guard.user.id, alertKey })),
    skipDuplicates: true,
  });
  return ok({ dismissed: res.count });
}
