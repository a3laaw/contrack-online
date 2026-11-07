import "server-only";
/**
 * saas-server.ts — بذر وخدمات SaaS الخادمية (Task 115):
 * • كتالوج الخطط يُبذر idempotent عند أول استخدام
 * • الشركة الرئيسية (1) تشتراك Enterprise دائم — قرار التصميم: النظام الحالي لا يتأثر
 * كل القراءات عبر sysDb — هذه حوكمة عبر الشركات لا بيانات تشغيلية.
 */
import { sysDb } from "@/lib/db";

export interface PlanSeed {
  code: string;
  name: string;
  durationDays: number; // 0 = دائم
  maxUsers: number;
  maxDivisions: number;
  priceMonthly: number;
  sortOrder: number;
}

/** كتالوج الخطط — الأسعار صفر مؤقتًا حتى حسم التسعير (سؤال متبقٍ موثق في وثيقة التصميم) */
export const PLAN_CATALOG: PlanSeed[] = [
  { code: "trial", name: "تجربة مجانية", durationDays: 14, maxUsers: 3, maxDivisions: 1, priceMonthly: 0, sortOrder: 1 },
  { code: "basic", name: "أساسي", durationDays: 365, maxUsers: 5, maxDivisions: 1, priceMonthly: 0, sortOrder: 2 },
  { code: "pro", name: "متقدم", durationDays: 365, maxUsers: 15, maxDivisions: 3, priceMonthly: 0, sortOrder: 3 },
  { code: "enterprise", name: "Enterprise", durationDays: 0, maxUsers: 999, maxDivisions: 99, priceMonthly: 0, sortOrder: 4 },
];

let plansReady: Promise<void> | null = null;

/** بذر كتالوج الخطط — idempotent، مرة واحدة لكل عملية خادم */
export function ensurePlans(): Promise<void> {
  plansReady ??= (async () => {
    for (const p of PLAN_CATALOG) {
      await sysDb.plan.upsert({
        where: { code: p.code },
        update: { name: p.name, durationDays: p.durationDays, maxUsers: p.maxUsers, maxDivisions: p.maxDivisions, sortOrder: p.sortOrder, isActive: true },
        create: { ...p },
      });
    }
  })();
  return plansReady;
}

let company1Ready: Promise<void> | null = null;

/** الشركة الرئيسية (1) — Enterprise دائم بلا انتهاء (تُبذر مرة) */
export function ensureCompany1Subscription(): Promise<void> {
  company1Ready ??= (async () => {
    await ensurePlans();
    // بعد المسح الشامل قد لا توجد أي شركات (نظام SaaS نظيف) — البذرة لا تعمل بلا الشركة 1
    const c1 = await sysDb.company.findUnique({ where: { id: 1 }, select: { id: true } });
    if (!c1) return;
    const ent = await sysDb.plan.findUnique({ where: { code: "enterprise" }, select: { id: true } });
    if (!ent) return;
    const existing = await sysDb.subscription.findUnique({ where: { companyId: 1 }, select: { id: true } });
    if (!existing) {
      await sysDb.subscription.create({
        data: {
          companyId: 1,
          planId: ent.id,
          status: "active",
          endsAt: null,
          notes: "الشركة الرئيسية — اشتراك دائم (بذرة النظام)",
        },
      });
    }
  })();
  return company1Ready;
}

/** خطة بالكود مع ضمان البذر — null إن الكود غير معروف */
export async function getPlanByCode(code: string) {
  await ensurePlans();
  return sysDb.plan.findUnique({ where: { code } });
}
