// ============================================================
// POST /api/register — التقديم الذاتي لانضمام شركة جديدة (Task 115)
// نقطة نهاية عامة (بلا جلسة): تُنشئ «طلب انضمام معلق» فقط — لا شركة ولا مستخدم.
// الاعتماد يدوي من المطور في لوحته (طلبات الانضمام) وفق قرار التصميم.
// الحماية: تحقق كامل + حد معدل في الذاكرة (5 طلبات/IP/ساعة) + هش كلمة المرور PBKDF2
// منذ لحظة الطلب (لا نص صريح يُخزَّن أبدًا).
// ============================================================
import { NextRequest } from "next/server";
import { db, sysDb } from "@/lib/db";
import { jsonError, ok } from "@/lib/api-utils";
import { hashPassword } from "@/lib/auth";
import { validateRegistrationInput } from "@/lib/saas-core";
import { validateModuleSelection, moduleSelectionLabel } from "@/lib/modules-catalog";

// حد معدل بسيط في الذاكرة — يكفي لبوابة تقديم الطلبات (الإعادة عند النشر المتعدد مقبولة)
const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return jsonError("عدد كبير من الطلبات من هذا الجهاز — يرجى المحاولة بعد ساعة", 429);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = {
    companyName: String(body.companyName || "").trim(),
    shortName: String(body.shortName || "").trim(),
    contactName: String(body.contactName || "").trim(),
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim(),
    activity: String(body.activity || "").trim(),
    adminFullName: String(body.adminFullName || "").trim(),
    requestedUsername: String(body.requestedUsername || "").trim(),
    password: String(body.password || ""),
  };

  const invalid = validateRegistrationInput(input);
  if (invalid) return jsonError(invalid);

  // خطة الأنشطة: الأنشطة المختارة من بوابة الانضمام — تُنظف وتُتحقق ضد الكتالوج
  // (activity النص الحر صار مشتقًا من الاختيار للعرض والتوافق)
  const modulesSel = validateModuleSelection(body.modules);
  if (!modulesSel.ok) return jsonError(modulesSel.error);
  const modulesJson = JSON.stringify(modulesSel.codes);
  const activityLabel = moduleSelectionLabel(modulesSel.codes);

  const companyExists = await db.company.findFirst({
    where: { name: input.companyName },
    select: { id: true },
  });
  if (companyExists) return jsonError("يوجد شركة بهذا الاسم في النظام مسبقًا");

  const pending = await sysDb.registrationRequest.findFirst({
    where: { companyName: input.companyName, status: "pending" },
    select: { id: true },
  });
  if (pending) return jsonError("يوجد طلب قيد المراجعة بهذا الاسم بالفعل — سيتم التواصل معكم قريبًا");

  const usernameTaken = await sysDb.user.findUnique({
    where: { username: input.requestedUsername },
    select: { id: true },
  });
  if (usernameTaken) return jsonError("اسم المستخدم محجوز — يرجى اختيار اسم آخر");

  const pendingUsername = await sysDb.registrationRequest.findFirst({
    where: { requestedUsername: input.requestedUsername, status: "pending" },
    select: { id: true },
  });
  if (pendingUsername) return jsonError("اسم المستخدم محجوز لطلب قيد المراجعة — اختر اسمًا آخر");

  const h = hashPassword(input.password);
  const row = await sysDb.registrationRequest.create({
    data: {
      companyName: input.companyName,
      shortName: input.shortName,
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      activity: activityLabel,
      modules: modulesJson,
      requestedUsername: input.requestedUsername,
      passwordHash: h.hash,
      salt: h.salt,
      adminFullName: input.adminFullName || input.contactName,
    },
  });

  return ok(
    {
      id: row.id,
      message: "تم استلام طلب الانضمام بنجاح — سيتم التواصل معكم بعد مراجعة الطلب",
    },
    201
  );
}
