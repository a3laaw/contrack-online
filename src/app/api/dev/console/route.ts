// ============================================================
// لوحة تحكم المطور (Task 98) — إحصائيات عامة + قائمة الشركات بعقودها
// للمطور فقط (role === "developer") — الأرقام عبر sysDb عمدًا:
// هذه قراءات تجميعية عبر الشركات من باب الحوكمة، لا بيانات تشغيلية.
// ============================================================
import { NextRequest } from "next/server";
import { db, sysDb } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "developer") {
    return jsonError("لوحة المطور للمطور فقط", 403);
  }

  const [companies, usersCount, contractsByCompany] = await Promise.all([
    db.company.findMany({
      orderBy: { id: "asc" },
      include: { users: { select: { id: true } } },
    }),
    db.user.count(),
    // عدد العقود لكل شركة — تجميعية عبر الشركات (مطور فقط)
    sysDb.contract.groupBy({ by: ["companyId"], _count: { _all: true } }),
  ]);

  const contractsMap = new Map<number, number>(
    contractsByCompany.map((g) => [g.companyId, g._count._all])
  );

  const list = companies.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    isActive: c.isActive,
    notes: c.notes,
    createdAt: c.createdAt,
    usersCount: c.users.length,
    contractsCount: contractsMap.get(c.id) ?? 0,
  }));

  const activeCount = list.filter((c) => c.isActive).length;
  const latest = companies.reduce<typeof companies[number] | null>(
    (acc, c) => (!acc || c.createdAt > acc.createdAt ? c : acc),
    null
  );

  return ok({
    stats: {
      companiesCount: list.length,
      activeCompaniesCount: activeCount,
      usersCount,
      latestCompanyName: latest?.name || null,
      latestCompanyAt: latest?.createdAt || null,
    },
    companies: list,
    // سياق الجلسة: 0 = بلا شركة (اللوحة) — وإلا الشركة التي داخلها المطور (شارة «الحالية»)
    currentCompanyId: guard.user.companyId,
  });
}
