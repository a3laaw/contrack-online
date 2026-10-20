import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { createCategory, listCategories } from "@/lib/forms/forms-server";
import { MSG_CATEGORY_DUP, MSG_CATEGORY_NAME_REQUIRED } from "@/lib/forms/forms-core";

/**
 * تصنيفات النماذج (بند 56) — جدول form_categories موجود بالمكتبي بلا واجهة
 * إدارة؛ قسم التصنيفات هنا إضافة ويب موثقة على البنية المكتبية نفسها.
 * الحرس: screen_forms (بوابة مركز النماذج المكتبية PAGE_PERMS).
 */

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const categories = await listCategories();
  return ok({ categories });
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError(MSG_CATEGORY_NAME_REQUIRED, 400);
  const dup = await db.formCategory.findFirst({ where: { name } });
  if (dup) return jsonError(MSG_CATEGORY_DUP, 400);
  const created = await db.$transaction(async (tx) => {
    const last = await tx.formCategory.findFirst({ orderBy: [{ sort: "desc" }] });
    return tx.formCategory.create({ data: { name, sort: (last?.sort ?? 0) + 1 } });
  });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء تصنيف نماذج",
    entityType: "form_category",
    entityId: created.id,
    entityName: created.name,
  });
  return ok({ category: { id: created.id, name: created.name, sort: created.sort, templatesCount: 0 } }, 201);
}
