/**
 * بذر محلي للتحقق — شركة + اشتراك فعّال + admin مربوط بها
 * (يعمل على قاعدة البيانات المدمجة فقط — لا يستخدم في الإنتاج)
 * ملاحظة: يضمن وجود admin/admin نفسه — يمكن ركضه في أي ترتيب
 * (قبل أو بعد أول دخول)، والعودة idempotent دائمًا.
 */
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function hashPassword(password: string, salt?: string) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, Buffer.from(s, "hex"), 200000, 32, "sha256").toString("hex");
  return { salt: s, hash };
}

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
  // ضمان admin/admin — المدير مربوط بالشركة (توكنه بشركة فعّالة فيصل دخوله)
  const admin = await db.user.findUnique({ where: { username: "admin" } });
  const pw = hashPassword("admin");
  if (!admin) {
    await db.user.create({
      data: { username: "admin", passwordHash: pw.hash, salt: pw.salt, role: "admin", fullName: "مدير النظام", jobTitle: "مدير", companyId: c.id },
    });
    console.log("admin created bound to company", c.id);
  } else if (admin.companyId == null) {
    await db.user.update({ where: { id: admin.id }, data: { companyId: c.id } });
    console.log("admin rebound to company", c.id);
  } else {
    console.log("admin already bound to", admin.companyId);
  }
  // الموديولات كلها فعّالة للشركة (استشارات/موارد/مخازن/مبيعات/صيانة/مقاولات)
  for (const code of ["consulting", "hr", "warehouses", "sales", "maintenance", "contracting"]) {
    const exists = await db.companyModule.findFirst({ where: { companyId: c.id, code } });
    if (!exists) {
      await db.companyModule.create({ data: { companyId: c.id, code, status: "active" } as never });
    }
  }
  console.log("OK company", c.id, "plan", plan.code, "modules on");
}
main().finally(() => db.$disconnect());
