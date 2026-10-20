import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { listProjects } from "@/lib/projects-server";
import {
  cleanProjectCustomerId,
  cleanProjectDate,
  cleanProjectName,
  cleanProjectStatus,
  cleanProjectText,
  PROJECT_NAME_REQUIRED,
} from "@/lib/projects-core";

/**
 * المشاريع — بند 11 من المرحلة 9.
 * البوابة شاشة الحاضن screen_customers (المكتبي: لا مدخل للمشاريع في PAGE_PERMS،
 * وفتح نتيجة بحث «مشروع» محروس بها — main_window.py:1813) — لا بند شل.
 */

/** قائمة المشاريع — فلاتر customerId / q (مرآة list_projects: بحث مطبَّع + الأحدث أولًا) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const customerId = Number(sp.get("customerId") || 0);
  const projects = await listProjects({
    customerId: Number.isFinite(customerId) && customerId > 0 ? customerId : undefined,
    q: sp.get("q") || "",
  });
  return ok({ projects });
}

/** إنشاء مشروع — تحقق الاسم المكتبي الحرفي + تدقيق «إنشاء مشروع» */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanProjectName(body.name);
  if (!name) return jsonError(PROJECT_NAME_REQUIRED, 400);

  const customerId = cleanProjectCustomerId(body.customerId);
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) return jsonError("العميل غير موجود.", 400);
  }

  const project = await db.project.create({
    data: {
      name,
      customerId,
      description: cleanProjectText(body.description),
      location: cleanProjectText(body.location),
      startDate: cleanProjectDate(body.startDate),
      endDate: cleanProjectDate(body.endDate),
      status: cleanProjectStatus(body.status),
    },
  });

  await db.$transaction((tx) =>
    audit(tx, {
      username: guard.user.username,
      action: "إنشاء مشروع",
      entityType: "project",
      entityId: project.id,
      entityName: project.name,
    })
  );

  return ok({ project }, 201);
}
