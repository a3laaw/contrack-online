/**
 * بذر البيانات الأساسية — ConTrack Online (Supabase Postgres)
 * ============================================================
 * ينشئ/يضمن وجود: صف الإعدادات الواحد، المدير الافتراضي (اختياري)،
 * عدادات الترقيم، طرق الدفع الافتراضية، وإشارات المزايا للوحدات المعتمدة.
 *
 * التشغيل:  bun prisma/seed.ts
 * الأمان:   كلمة مرور المدير تُقرأ من SEED_ADMIN_PASSWORD فقط —
 *           بلا قيمة يُتخطى إنشاء/تحديث المستخدم تماماً (لا كلمات مرور افتراضية في الكود).
 */
import { PrismaClient } from "@prisma/client";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const db = new PrismaClient();

/** نفس خوارزمية src/lib/auth.ts: PBKDF2-SHA256 بـ200,000 دورة */
function hashPassword(password: string, salt?: string) {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, s, 200000, 32, "sha256").toString("hex");
  return { salt: s, hash };
}

async function main() {
  // 1) صف الإعدادات للشركة الرئيسية (1)
  await db.setting.upsert({ where: { companyId: 1 }, create: { companyId: 1 }, update: {} });

  // 2) المدير الافتراضي — فقط عند تمرير كلمة مرور صريحة
  const username = process.env.SEED_ADMIN_USERNAME?.trim() || "admin";
  const password = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (password) {
    const { salt, hash } = hashPassword(password);
    await db.user.upsert({
      where: { username },
      create: { username, passwordHash: hash, salt, role: "admin", fullName: "المدير" },
      update: {},
    });
    console.log(`seed: admin «${username}» مضمون`);
  } else {
    console.log("seed: تخطي المستخدم (SEED_ADMIN_PASSWORD غير مضبوط)");
  }

  // 3) عدادات الترقيم (الأسماء كما تستهلكها الخدمات)
  const sequences = ["RV", "PV", "TV", "CV", "SD", "PRJ", "QUO", "SUB", "GRP"];
  for (const name of sequences) {
    await db.numberSequence.upsert({
      where: { companyId_name: { companyId: 1, name } },
      create: { companyId: 1, name, lastNo: 0 },
      update: {},
    });
  }

  // 4) طرق الدفع الافتراضية (رسوم كالمكتب: تحويل 0.150 / KNET 1.5%)
  const methods: Array<{ name: string; feeType: "amount" | "percent"; feeValue: number }> = [
    { name: "نقدًا", feeType: "amount", feeValue: 0 },
    { name: "تحويل بنكي", feeType: "amount", feeValue: 0.15 },
    { name: "KNET", feeType: "percent", feeValue: 1.5 },
    { name: "شيك", feeType: "amount", feeValue: 0 },
    { name: "أخرى", feeType: "amount", feeValue: 0 },
  ];
  for (const m of methods) {
    await db.paymentMethod.upsert({
      where: { companyId_name: { companyId: 1, name: m.name } },
      create: { companyId: 1, ...m },
      update: {},
    });
  }

  // 5) إشارات المزايا — الوحدات المعتمدة كلها مفعّلة افتراضياً
  const flags = [
    "subcontractors",
    "followup",
    "statement",
    "custody",
    "payment_gateway",
    "invoices",
    "tasks",
    "visits",
    "comments",
    "reports",
    "full_backup",
  ];
  for (const key of flags) {
    await db.featureFlag.upsert({ where: { key }, create: { key, enabled: true }, update: {} });
  }

  console.log("seed: تم — الإعدادات + العدادات + طرق الدفع + الإشارات");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
