/**
 * maintenance-verify-cleanup — التنظيف الشامل بعد التحقق الحي (docs/maintenance-design.md §8.5):
 * مرآة sales-verify-cleanup — حذف كل صفوف شركة التحقق (companyId=1) بكل الجداول المستأجرة
 * (وتشمل جداول الصيانة الثلاثة آليًا عبر DMMF) + مستخدم المدير + سطور audit + الشركة ⇒
 * عودة القاعدة لحالة ما قبل التحقق بصفر صفوف.
 * الاستخدام: DATABASE_URL=... bun .zscripts/maintenance-verify-cleanup.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const COMPANY_ID = Number(process.env.MAINT_VERIFY_COMPANY_ID || "1"); // شركة التحقق — تُمرر إن لم تكن الأولى في القاعدة
let totalDeleted = 0;

async function main() {
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

  const auditDel = await db.auditLog.deleteMany({
    where: { username: { in: ["maintadmin", "devcheck"] } },
  });
  totalDeleted += auditDel.count;
  console.log(`audit: ${auditDel.count}`);

  const userDel = await db.user.deleteMany({ where: { companyId: COMPANY_ID } });
  totalDeleted += userDel.count;
  console.log(`users: ${userDel.count}`);

  const companyDel = await db.company.deleteMany({ where: { id: COMPANY_ID } });
  totalDeleted += companyDel.count;
  console.log(`company: ${companyDel.count}`);

  // ===== التحقق النهائي: صفر صفوف بالجداول الثلاثة الجديدة وكل المستأجرة =====
  let remaining = 0;
  const leftovers: string[] = [];
  for (const m of models) {
    const delegate = (db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[
      m.name.charAt(0).toLowerCase() + m.name.slice(1)
    ];
    if (!delegate?.count) continue;
    try {
      const n = await delegate.count({ where: { companyId: COMPANY_ID } });
      if (n > 0) {
        remaining += n;
        leftovers.push(`${m.name}: ${n}`);
      }
    } catch {
      /* بلا جدول */
    }
  }
  console.log(`المتبقي: ${remaining}${leftovers.length ? ` — ${leftovers.join(" · ")}` : " (صفر صفوف — القاعدة نظيفة)"}`);
  console.log(`الإجمالي المحذوف: ${totalDeleted}`);
  await db.$disconnect();
  if (remaining > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
