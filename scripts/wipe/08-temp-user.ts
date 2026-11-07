/**
 * مستخدم مطور مؤقت للتحقق الحي بعد المسح — يُحذف بعدها
 * تشغيل: bun scripts/wipe/08-temp-user.ts
 */
import { PrismaClient } from "@prisma/client";
import { createHash, pbkdf2Sync, randomBytes } from "crypto";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const USERNAME = "__wipe_check";
const PASSWORD = "WipeCheck#2026";

function hashPassword(password: string, salt?: string) {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, Buffer.from(s, "hex"), 200000, 32, "sha256").toString("hex");
  return { hash, salt: s };
}

try {
  const existing = await prisma.$queryRaw<any[]>`SELECT id FROM users WHERE username = ${USERNAME}`;
  if (existing.length > 0) {
    console.log("المستخدم المؤقت موجود مسبقًا — لا شيء");
  } else {
    const { hash, salt } = hashPassword(PASSWORD);
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (username, password_hash, salt, role, full_name, job_title, active, "createdAt", company_id)
       VALUES ($1, $2, $3, 'developer', 'فحص المسح', '', true, NOW(), NULL)`,
      USERNAME, hash, salt
    );
    console.log(`✓ أُنشئ المستخدم المؤقت: ${USERNAME} / ${PASSWORD}`);
  }
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 400));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
