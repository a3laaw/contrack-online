import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
const db = new PrismaClient();
async function main() {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync("Zp9#verify2026", salt, 200000, 32, "sha256").toString("hex");
  const u = await db.user.upsert({
    where: { username: "zphase9" },
    update: { salt, passwordHash: hash, role: "admin" },
    create: { username: "zphase9", salt, passwordHash: hash, role: "admin", fullName: "تحقق مرحلة 8" },
  });
  console.log("OK user id", u.id);
}
main().finally(() => db.$disconnect());
