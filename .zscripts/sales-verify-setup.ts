/**
 * sales-verify setup — إنشاء مستخدم مطوّر للتحقق الحي (قاعدة فارغة) — بنفس hashPassword (auth.ts).
 * لا يمس أي شركة — مطوّر فقط لتمرير بوابة إنشاء الشركات.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, pbkdf2Sync } from "node:crypto";

const sys = new PrismaClient();

function hashPassword(password: string, salt?: string) {
  const s = salt || randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, Buffer.from(s, "hex"), 200000, 32, "sha256").toString("hex");
  return { salt: s, hash };
}

async function main() {
  const existing = await sys.user.findUnique({ where: { username: "devcheck" }, select: { id: true } });
  if (existing) {
    console.log("devcheck exists");
    return;
  }
  const h = hashPassword("dev123456");
  const dev = await sys.user.create({
    data: {
      username: "devcheck",
      passwordHash: h.hash,
      salt: h.salt,
      role: "developer",
      fullName: "متحقق المبيعات",
    },
  });
  console.log("created developer", dev.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sys.$disconnect());
