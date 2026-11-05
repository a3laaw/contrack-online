/**
 * بذر بيئة الفحص المحلية — Task 107 (قاعدة Postgres المحلية، لا علاقة للإنتاج):
 *  شركة 1 + إعدادات + مستخدمان (raheem مدير / khaled سكرتير) + عميل وعقد
 *  + فاتورتان بصيغة الهيكل القديم (amount واحد) ثم أرشيفتها ثم ترحيلها
 *  بسكربت task107 لاختبار المسار التاريخي كاملًا في البيئة المحلية.
 * تشغيل: DATABASE_URL=... DIRECT_URL=... bun scripts/task107-seed-check.ts
 */
import { PrismaClient } from "@prisma/client";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 200000, 32, "sha256").toString("hex");
  return { salt, hash };
}

async function main(): Promise<void> {
  // ===== الشركة والإعدادات والمستخدمون =====
  const company = await prisma.company.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "مؤسسة الفحص للمقاولات", shortName: "الفحص" },
  });
  await prisma.setting.upsert({
    where: { companyId: 1 },
    update: { companyName: "مؤسسة الفحص للمقاولات", companyPhone: "+965 22334455", currency: "د.ك" },
    create: { companyId: 1, companyName: "مؤسسة الفحص للمقاولات", companyPhone: "+965 22334455", currency: "د.ك" },
  });

  const raheem = hashPassword("Raheem@107");
  const khaled = hashPassword("Khaled@107");
  await prisma.user.upsert({
    where: { username: "raheem" },
    update: { passwordHash: raheem.hash, salt: raheem.salt, companyId: 1, role: "admin", active: true },
    create: {
      username: "raheem",
      passwordHash: raheem.hash,
      salt: raheem.salt,
      role: "admin",
      fullName: "رشدي لبافة",
      jobTitle: "مدير الحسابات",
      companyId: 1,
    },
  });
  await prisma.user.upsert({
    where: { username: "khaled" },
    update: { passwordHash: khaled.hash, salt: khaled.salt, companyId: 1, role: "secretary", active: true },
    create: {
      username: "khaled",
      passwordHash: khaled.hash,
      salt: khaled.salt,
      role: "secretary",
      fullName: "خالد العتيبي",
      jobTitle: "سكرتير",
      companyId: 1,
    },
  });

  // ===== عميل وعقد =====
  const customer = await prisma.customer.upsert({
    where: { companyId_customerCode: { companyId: 1, customerCode: "C-0001" } },
    update: {},
    create: {
      companyId: 1,
      customerCode: "C-0001",
      name: "شركة الأهلي للمقاولات العامة",
      phone: "+965 99112233",
      address: "السالمية — بلوك 4",
    },
  });
  const contract = await prisma.contract.upsert({
    where: { companyId_contractNumber: { companyId: 1, contractNumber: "CON-0001" } },
    update: {},
    create: {
      companyId: 1,
      contractNumber: "CON-0001",
      contractName: "أعمال تشطيب مبنى السالمية",
      customerId: customer.id,
      contractDate: "2026-01-15",
      amount: 50000,
      status: "نشط",
    },
  });

  // ===== فاتورتان بصيغة الهيكل القديم (محاكاة صفوف ما قبل Task 107) =====
  const legacyCount = await prisma.invoice.count();
  if (legacyCount === 0) {
    await prisma.invoice.createMany({
      data: [
        {
          companyId: 1,
          invoiceNumber: "INV-0001",
          invoiceNo: 9999001, // مؤقت — يُستبدل بالترحيل من الأرشيف
          customerId: customer.id,
          contractId: contract.id,
          invoiceDate: "2026-09-10",
          description: "دفعة أولى — قيمة العقد",
          subtotal: 0,
          discountTotal: 0,
          total: 0, // يُملأ بالترحيل من الأرشيف (محاكاة db:push بعد إسقاط amount)
          notes: "",
        },
        {
          companyId: 1,
          invoiceNumber: "INV-0002",
          invoiceNo: 9999002,
          customerId: customer.id,
          contractId: contract.id,
          invoiceDate: "2026-10-05",
          description: "المستخلص رقم 2",
          subtotal: 0,
          discountTotal: 0,
          total: 0,
          notes: "",
        },
      ],
    });
    // أرشيف بصيغة الهيكل القديم (كما كان قبل db:push)
    const rows = await prisma.invoice.findMany({ orderBy: { id: "asc" } });
    const legacyArchive = {
      archivedAt: new Date().toISOString(),
      count: rows.length,
      rows: rows.map((r) => ({
        id: r.id,
        companyId: r.companyId,
        invoiceNumber: r.invoiceNumber,
        customerId: r.customerId,
        contractId: r.contractId,
        invoiceDate: r.invoiceDate,
        description: r.description,
        amount: r.invoiceNumber === "INV-0001" ? 2500 : 1750, // مبلغ الهيكل القديم
        notes: r.notes,
      })),
    };
    writeFileSync("db/invoices-archive-task107.json", JSON.stringify(legacyArchive, null, 2), "utf8");
    console.log(`بُذرت ${rows.length} فاتورة قديمة الشكل + أرشفتها إلى db/invoices-archive-task107.json`);
  } else {
    console.log(`الفواتير موجودة مسبقًا (${legacyCount}) — لا بذر`);
  }

  console.log("بيئة الفحص جاهزة: raheem/Raheem@107 · khaled/Khaled@107 (شركة 1)");
  console.log("التالي: bun scripts/task107-migrate-invoices.ts لترحيل الفاتورتين القديمتين");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
