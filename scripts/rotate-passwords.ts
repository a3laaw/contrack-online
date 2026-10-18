// تدوير كلمات مرور المستخدمين — PBKDF2-SHA256 / 200,000 دورة (مطابق لـ src/lib/auth.ts)
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient();

function makeCreds(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 200000, 32, "sha256")
    .toString("hex");
  return { salt, hash };
}

function genPassword() {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = lower + upper + digits + symbols;
  let out = "";
  // ضمان: حرف كبير + صغير + رقم + رمز
  out += upper[crypto.randomInt(upper.length)];
  out += lower[crypto.randomInt(lower.length)];
  out += digits[crypto.randomInt(digits.length)];
  out += symbols[crypto.randomInt(symbols.length)];
  while (out.length < 14) out += all[crypto.randomInt(all.length)];
  // خلط الترتيب
  return out
    .split("")
    .sort(() => crypto.randomInt(3) - 1)
    .join("");
}

async function main() {
  const users = await db.user.findMany({
    where: { active: true },
    select: { id: true, username: true },
  });
  const results: { username: string; password: string }[] = [];
  for (const u of users) {
    const password = genPassword();
    const { salt, hash } = makeCreds(password);
    await db.user.update({ where: { id: u.id }, data: { salt, passwordHash: hash } });
    results.push({ username: u.username, password });
    console.log(`ROTATED: ${u.username} (id=${u.id})`);
  }
  console.log("=== CREDENTIALS (show once, store safely) ===");
  for (const r of results) console.log(`${r.username}: ${r.password}`);
  console.log("=== END CREDENTIALS ===");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
