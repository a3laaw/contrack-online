// ============================================================
// POST /api/dev/companies/[id]/modules — تفعيل/إيقاف موديول (نشاط) لشركة
// — للمطور حصريًا (خطة الأنشطة — المرحلة A):
// • { code, enable: true }  ⇒ تفعيل + ضمان القسم الافتراضي
// • { code, enable: false } ⇒ إيقاف (تجميد): الشاشات تختفي من الشل والبيانات محفوظة كاملة
// • الكور (المحاسبة والخزينة) لا يُوقف أبدًا، وغير المتاح في الكتالوج («قريبًا») لا يُفعَّل
// ============================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { setCompanyModule } from "@/lib/modules-server";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "developer") {
    return jsonError("إدارة موديولات الشركات للمطور فقط", 403);
  }
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as { code?: string; enable?: boolean };
  const code = String(body.code || "").trim();
  if (!code) return jsonError("كود الموديول مطلوب");
  const enable = body.enable !== false; // الغياب = تفعيل

  const result = await setCompanyModule(id, code, enable, guard.user.username);
  if (result.error) return jsonError(result.error);

  await audit(db, {
    username: guard.user.username,
    action: enable ? "تفعيل موديول" : "إيقاف موديول",
    entityType: "company_module",
    entityId: id,
    entityName: `${result.label ?? code} · شركة #${id}`,
  });

  return ok({
    message: enable
      ? `تم تفعيل «${result.label}» — القسم الافتراضي جاهز والشاشات ظهرت`
      : `تم إيقاف «${result.label}» — شاشاته مخفية وبياناتها محفوظة كاملة`,
  });
}
