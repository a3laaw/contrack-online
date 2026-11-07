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
  });
}
