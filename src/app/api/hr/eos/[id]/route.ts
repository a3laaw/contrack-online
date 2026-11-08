import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** DELETE: إلغاء توثيق نهاية خدمة «محسوبة» فقط — بسببه (توثيق بلا حذف للحالة المستقرة) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason || "").trim();
  if (!reason) return jsonError("سبب الإلغاء إلزامي");

  const termination = await db.employeeTermination.findUnique({
    where: { id },
    include: { employee: { select: { name: true } } },
  });
  if (!termination) return jsonError("التوثيق غير موجود", 404);
  if (termination.status === "مستقرة") {
    return jsonError("التوثيق مستقر بقيد مالي — الاسترداد عبر الخزينة ولا يُحذف هنا");
  }

  // التوثيق «محسوبة» بلا أثر مالي بعد — حذفه بنمط حذف المسودات، مع audit كامل بالسبب
  await db.employeeTermination.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "إلغاء توثيق نهاية خدمة",
    entityType: "employee_termination",
    entityId: id,
    entityName: `${termination.employee.name} — ${termination.scenario}`,
    reason,
  });
  return ok({ cancelled: true });
}
