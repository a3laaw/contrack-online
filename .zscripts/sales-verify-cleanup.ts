/**
 * sales-verify-cleanup — التنظيف الشامل بعد التحقق الحي (docs/sales-design.md §8.5):
 * حذف كل صفوف شركة التحقق (companyId=1) بكل الجداول المستأجرة بترتيب آمن متعدد المرات
 * + مستخدم المدير + سطور audit للتحقق + الشركة نفسها ⇒ عودة القاعدة لحالة ما قبل التحقق.
 * الاستخدام: DATABASE_URL=... bun .zscripts/sales-verify-cleanup.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const COMPANY_ID = 1;
let totalDeleted = 0;

async function main() {
  // كل النماذج المستأجرة التي تحمل companyId — حذف بأمرار متعددة (قيود Restrict بين الجداول)
  const models = Prisma.dmmf.datamodel.models
    .map((m) => ({ name: m.name, dbName: m.dbName ?? m.name, hasCompany: m.fields.some((f) => f.name === "companyId") }))
    .filter((m) => m.hasCompany);

  for (let pass = 1; pass <= 6; pass++) {
    let passDeleted = 0;
    for (const m of models) {
      const delegate = (db as unknown as Record<string, { deleteMany: (a: unknown) => Promise<{ count: number }> }>)[
        m.name.charAt(0).toLowerCase() + m.name.slice(1)
      ];
      if (!delegate?.deleteMany) continue;
      try {
        const res = await delegate.deleteMany({ where: { companyId: COMPANY_ID } });
        passDeleted += res.count;
      } catch {
        // قيد Restrict — تُعاد في مرور لاحق بعد حذف الأبناء
      }
    }
    totalDeleted += passDeleted;
    if (passDeleted === 0) break;
    console.log(`مرور ${pass}: حُذف ${passDeleted} صف`);
  }

  // سطور audit الخاصة بالتحقق (جدول عام بلا companyId — نمط التنظيف السابق)
  const auditDel = await db.auditLog.deleteMany({
    where: { username: { in: ["salesadmin", "devcheck"] } },
  });
  totalDeleted += auditDel.count;
  console.log(`audit: ${auditDel.count}`);

  // مستخدم مدير شركة التحقق (المطوّر devcheck يبقى للجلسات القادمة)
  const userDel = await db.user.deleteMany({ where: { companyId: COMPANY_ID } });
  totalDeleted += userDel.count;
  console.log(`users: ${userDel.count}`);

  // الشركة نفسها أخيرًا
  const companyDel = await db.company.deleteMany({ where: { id: COMPANY_ID } });
  totalDeleted += companyDel.count;
  console.log(`company: ${companyDel.count}`);

  // ===== التحقق النهائي: صفر صفوف =====
  let remaining = 0;
  const leftovers: string[] = [];
  for (const m of models) {
    const delegate = (db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[
      m.name.charAt(0).toLowerCase() + m.name.slice(1)
    ];
    if (!delegate?.count) continue;
    const c = await delegate.count({ where: { companyId: COMPANY_ID } }).catch(() => 0);
    if (c > 0) {
      remaining += c;
      leftovers.push(`${m.name}:${c}`);
    }
  }
  const usersLeft = await db.user.count({ where: { companyId: COMPANY_ID } });
  const companyLeft = await db.company.count({ where: { id: COMPANY_ID } });
  const auditLeft = await db.auditLog.count({ where: { username: { in: ["salesadmin", "devcheck"] } } });

  console.log(`\nإجمالي المحذوف: ${totalDeleted}`);
  console.log(`بقايا جداول مستأجرة: ${remaining} ${leftovers.join(" ")}`);
  console.log(`بقايا مستخدمين/شركة/audit: ${usersLeft}/${companyLeft}/${auditLeft}`);
  if (remaining === 0 && usersLeft === 0 && companyLeft === 0) {
    console.log("🎉 تنظيف شامل — القاعدة عادت لحالة ما قبل التحقق (صفر صفوف)");
  } else {
    console.log("💥 تنظيف غير مكتمل");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
