// Task 85 — SaaS: تبديل الشركة النشطة — (Task 97) للمطور فقط
// يعيد إصدار توكن الجلسة بشركة الهدف — cookie ctrk_session يُستبدل
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { issueToken, sessionCookieOptionsFor } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "developer") {
    return jsonError("تبديل الشركات للمطور فقط (Task 97)", 403);
  }

  const body = (await req.json().catch(() => ({}))) as { companyId?: number };
  const companyId = Math.trunc(Number(body.companyId));
  if (!Number.isFinite(companyId) || companyId < 0) return jsonError("معرف الشركة غير صالح");

  // Task 100 — companyId=0: العودة لسياق «بلا شركة» (لوحة المطور) — لا شركة تُتحقق
  if (companyId === 0) {
    const token = issueToken(guard.user.id, 0);
    await audit(db, {
      username: guard.user.username,
      action: "عودة للوحة المطور",
      entityType: "company",
      entityName: "لوحة المطور",
    });
    const res = ok({ companyId: 0, companyName: "", token });
    res.cookies.set("ctrk_session", token, sessionCookieOptionsFor(req));
    return res;
  }

  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company || !company.isActive) return jsonError("الشركة غير موجودة أو معطّلة", 404);

  // sysDb هنا مقصود: تحديث المستخدم نفسه ليس عملية على بيانات شركة
  const token = issueToken(guard.user.id, company.id);
  // لوحة المطور (Task 97): كل دخول شركة يُسجَّل في سجل التدقيق — مَن دخل أين ومتى
  await audit(db, {
    username: guard.user.username,
    action: "دخول شركة",
    entityType: "company",
    entityId: company.id,
    entityName: company.name,
  });
  const res = ok({ companyId: company.id, companyName: company.name, token });
  res.cookies.set("ctrk_session", token, sessionCookieOptionsFor(req));
  return res;
}
