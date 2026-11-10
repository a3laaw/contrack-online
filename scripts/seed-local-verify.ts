/**
 * بذر محلي للتحقق — شركة + اشتراك فعّال + ربط admin بها
 * (يعمل على قاعدة البيانات المدمجة فقط — لا يستخدم في الإنتاج)
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const plan = await db.plan.upsert({
    where: { code: "pro" },
    create: { code: "pro", name: "برو", maxUsers: 25, maxDivisions: 5 },
    update: {},
  });
  let c = await db.company.findFirst({ where: { name: "شركة التجربة المحلية" } });
  if (!c) c = await db.company.create({ data: { name: "شركة التجربة المحلية", shortName: "تجربة" } });
  const sub = await db.subscription.findFirst({ where: { companyId: c.id } });
  if (!sub) {
    await db.subscription.create({
      data: { companyId: c.id, planId: plan.id, status: "active", endsAt: null },
    });
  }
  await db.user.updateMany({ where: { username: "admin" }, data: { companyId: c.id } });
  console.log("OK company", c.id, "admin bound, plan", plan.code);
}
main().finally(() => db.$disconnect());
