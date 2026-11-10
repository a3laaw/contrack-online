/**
 * بذر مؤقت للتحقق الحي HR-1 — يُحذف بعد الاختبار (نمط consulting-v1).
 * يشغَّل: bun --conditions react-server scripts/seed-hr.ts
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const base = new PrismaClient();

async function main() {
  const company = await base.company.create({
    data: {
      name: "شركة بذر HR التجريبية",
      shortName: "HR-SEED",
      notes: "بذر مؤقت للتحقق الحي HR-1 — تُمسح بعد الاختبار",
    },
  });

  await base.companyModule.createMany({
    data: [{ companyId: company.id, code: "hr", status: "active", enabledBy: "seed" }],
  });
  await base.division.create({
    data: { companyId: company.id, code: "div-hr", name: "الموارد البشرية", moduleCode: "hr", isActive: true },
  });

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync("HR-Seed-2026!", Buffer.from(salt, "hex"), 200000, 32, "sha256").toString("hex");
  await base.user.create({
    data: {
      companyId: company.id,
      username: "hrseed-admin",
      passwordHash: hash,
      salt,
      role: "admin",
      fullName: "مدير بذر HR",
      jobTitle: "مدير عام",
      active: true,
    },
  });

  console.log(JSON.stringify({ companyId: company.id, username: "hrseed-admin", password: "HR-Seed-2026!" }));
}

main()
  .then(() => base.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await base.$disconnect();
    process.exit(1);
  });
