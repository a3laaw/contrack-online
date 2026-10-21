import { NextRequest } from "next/server";
import { adminGuard, authGuard, jsonError, ok } from "@/lib/api-utils";
import { analyzeUnspecified, applyFixes, type FixDecision } from "@/lib/fix-unspecified-server";

/** GET — تحليل العقود ذات النوع «غير محدد» (قراءة فقط: الاقتراح + الحالة + الآمن) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const rows = await analyzeUnspecified();
  return ok({ rows });
}

/** POST — تنفيذ قرارات صريحة عقدًا عقدًا (مدير) — allowDestructive إذن ثانٍ لإعادة بناء ذي التقدّم */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = Array.isArray(body.decisions) ? body.decisions : [];
  const decisions: FixDecision[] = raw.map((x) => {
    const d = x as Record<string, unknown>;
    return {
      contractId: Number(d.contractId ?? 0),
      typeName: String(d.typeName ?? ""),
      action: String(d.action ?? "skip"),
    };
  });
  const allowDestructive = Boolean(body.allowDestructive);
  const stats = await applyFixes(decisions, allowDestructive, guard.user.username);
  return ok(stats);
}
