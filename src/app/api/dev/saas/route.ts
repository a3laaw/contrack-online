// ============================================================
// GET /api/dev/saas — بيانات مركز إدارة SaaS (Task 115) — للمطور حصريًا:
// • إحصاءات عامة (طلبات معلقة، توزيع حالات الاشتراك)
// • كتالوج الخطط المبذور
// • طلبات الانضمام (بدون أي هشات كلمات مرور — لا تُرسل للعميل أبدًا)
// • الشركات مع اشتراكاتها وحالتها الفعلية (بدون اشتراك = الشركات اليدوية القديمة)
// كل القراءات عبر sysDb — حوكمة عبر الشركات لا بيانات تشغيلية.
// ============================================================
import { NextRequest } from "next/server";
import { db, sysDb } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { ensureCompany1Subscription, ensurePlans } from "@/lib/saas-server";
import { daysLeft, effectiveSubscriptionStatus } from "@/lib/saas-core";
import { MODULE_CATALOG } from "@/lib/modules-catalog";
import { companyModulesState, parseRequestModules, requestModulesLabel } from "@/lib/modules-server";

export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "developer") {
    return jsonError("مركز إدارة SaaS للمطور فقط", 403);
  }

  // بذر الخطط + اشتراك الشركة الرئيسية الدائم (idempotent)
  await ensureCompany1Subscription();

  const [companies, plans, requests, contractsByCompany] = await Promise.all([
    sysDb.company.findMany({
      orderBy: { id: "asc" },
      include: {
        users: { select: { id: true } },
        subscription: { include: { plan: true } },
      },
    }),
    sysDb.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    sysDb.registrationRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    sysDb.contract.groupBy({ by: ["companyId"], _count: { _all: true } }),
  ]);

  // خطة الأنشطة: حالة موديولات كل شركة (بالتوازي — استعلام صغير لكل شركة)
  const modulesByCompany = new Map<number, Awaited<ReturnType<typeof companyModulesState>>>();
  await Promise.all(
    companies.map(async (c) => {
      modulesByCompany.set(c.id, await companyModulesState(c.id));
    })
  );

  const contractsMap = new Map<number, number>(
    contractsByCompany.map((g) => [g.companyId, g._count._all])
  );

  const now = new Date();
  const subscriptions = companies.map((c) => {
    const sub = c.subscription;
    const effective = effectiveSubscriptionStatus(sub, now);
    return {
      companyId: c.id,
      companyName: c.name,
      shortName: c.shortName,
      isActive: c.isActive,
      usersCount: c.users.length,
      contractsCount: contractsMap.get(c.id) ?? 0,
      modules: modulesByCompany.get(c.id) ?? [],
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            effective,
            planCode: sub.plan.code,
            planName: sub.plan.name,
            startsAt: sub.startsAt,
            endsAt: sub.endsAt,
            daysLeft: daysLeft(sub.endsAt, now),
            notes: sub.notes,
          }
        : null,
    };
  });

  const statusCounts = {
    trial: 0,
    active: 0,
    frozen: 0,
    expired: 0,
    cancelled: 0,
    none: 0,
  } as Record<string, number>;
  for (const s of subscriptions) statusCounts[s.subscription?.effective ?? "none"] += 1;

  const pendingRequests = requests.filter((r) => r.status === "pending").length;

  return ok({
    stats: {
      pendingRequests,
      companiesCount: companies.length,
      ...statusCounts,
    },
    plans: plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      durationDays: p.durationDays,
      maxUsers: p.maxUsers,
      maxDivisions: p.maxDivisions,
      priceMonthly: Number(p.priceMonthly),
    })),
    requests: requests.map((r) => ({
      id: r.id,
      companyName: r.companyName,
      shortName: r.shortName,
      contactName: r.contactName,
      phone: r.phone,
      email: r.email,
      activity: r.activity,
      modules: parseRequestModules(r), // الأنشطة المطلوبة (أكواد)
      modulesLabel: requestModulesLabel(r), // التسمية للعرض
      requestedUsername: r.requestedUsername,
      adminFullName: r.adminFullName,
      status: r.status,
      rejectionReason: r.rejectionReason,
      createdCompanyId: r.createdCompanyId,
      processedBy: r.processedBy,
      processedAt: r.processedAt,
      createdAt: r.createdAt,
    })),
    subscriptions,
    // خطة الأنشطة: الكتالوج للواجهة (بطاقات لوحة المطور وبوابة الانضمام من مصدر واحد)
    moduleCatalog: MODULE_CATALOG.map((m) => ({
      code: m.code,
      name: m.name,
      icon: m.icon,
      desc: m.desc,
      available: m.available,
      core: m.core,
    })),
  });
}
