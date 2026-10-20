import "server-only";
import { db } from "@/lib/db";
import { normalizeArabic } from "@/lib/api-utils";
import type { Prisma } from "@prisma/client";
import type { ProjectRow } from "@/lib/projects-core";

/**
 * المشاريع — طبقة الخادم (بند 11).
 * مرآة lifecycle_service.list_projects: ربط اسم العميل + بحث مطبَّع
 * على (الاسم · اسم العميل · هاتف العميل) + ORDER BY id DESC.
 * (مفاتيح البحث المكتبية p.project_code غير موجودة في المخطط المرجعي فتُستبعد.)
 */

const PROJECT_SELECT = {
  id: true,
  customerId: true,
  name: true,
  description: true,
  location: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { name: true, phone: true } },
  _count: { select: { vouchers: true } },
} satisfies Prisma.ProjectSelect;

type ProjectWithCustomer = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

export function toProjectRow(p: ProjectWithCustomer): ProjectRow {
  return {
    id: p.id,
    customerId: p.customerId,
    customerName: p.customer?.name || "",
    name: p.name,
    description: p.description || "",
    location: p.location || "",
    startDate: p.startDate || "",
    endDate: p.endDate || "",
    status: p.status || "",
    vouchersCount: p._count.vouchers,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** القائمة: فلتر customerId + بحث مطبَّع (الاسم · اسم العميل · هاتف العميل) — الأحدث أولًا */
export async function listProjects(opts: {
  customerId?: number;
  q?: string;
}): Promise<ProjectRow[]> {
  const where: Prisma.ProjectWhereInput = {};
  if (opts.customerId && opts.customerId > 0) where.customerId = opts.customerId;

  const q = (opts.q || "").trim();
  let rows = await db.project.findMany({
    where,
    select: PROJECT_SELECT,
    orderBy: { id: "desc" },
    take: 2000,
  });

  const nq = normalizeArabic(q);
  if (nq.length >= 1) {
    rows = rows.filter((p) => {
      const hay = normalizeArabic(
        [p.name, p.description, p.location, p.customer?.name, p.customer?.phone]
          .filter(Boolean)
          .join(" ")
      );
      return hay.includes(nq);
    });
  }
  return rows.map(toProjectRow);
}

/** مشروع واحد مع عداد سنداته (للعرض وحارس الحذف) */
export async function getProjectRow(id: number): Promise<ProjectRow | null> {
  const p = await db.project.findUnique({ where: { id }, select: PROJECT_SELECT });
  return p ? toProjectRow(p) : null;
}
