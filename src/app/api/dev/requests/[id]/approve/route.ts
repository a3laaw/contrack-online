// ============================================================
// POST /api/dev/requests/[id]/approve — اعتماد طلب انضمام (Task 115) — للمطور حصريًا:
// إنشاء الشركة + بذر قواعد القيد + مدير أول (بالهش المحفوظ من لحظة الطلب)
// + اشتراك بالخطة المختارة (افتراضيًا تجربة 14 يوم) + توثيق الطلب والتدقيق.
// يمكن للمطور تعديل اسم المستخدم عند الاعتماد (إن حُجز بين الحين والآخر).
// ============================================================
import { NextRequest } from "next/server";
import { db, forCompany, sysDb } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { ensurePostingRules } from "@/lib/posting-rules-server";
import { getPlanByCode } from "@/lib/saas-server";
import { addDays, validateAdminUsername } from "@/lib/saas-core";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "developer") {
    return jsonError("اعتماد طلبات الانضمام للمطور فقط", 403);
  }
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    planCode?: string;
  };

  const request = await sysDb.registrationRequest.findUnique({ where: { id } });
  if (!request) return jsonError("الطلب غير موجود", 404);
  if (request.status !== "pending") return jsonError("تمت معالجة هذا الطلب مسبقًا");

  // اسم المستخدم: تعديل المطور أو المطلوب أصلاً — تحقق نهائي الآن
  const username = String(body.username || "").trim() || request.requestedUsername;
  const usernameError = validateAdminUsername(username);
  if (usernameError) return jsonError(usernameError);
  const usernameTaken = await sysDb.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (usernameTaken) return jsonError("اسم المستخدم محجوز الآن — عدّله ثم أعتمد");

  // اسم الشركة فريد — قد تكون أُنشئت يدويًا بعد تقديم الطلب
  const companyExists = await db.company.findFirst({
    where: { name: request.companyName },
    select: { id: true },
  });
  if (companyExists) return jsonError("أُنشئت شركة بهذا الاسم بعد تقديم الطلب — ارفض الطلب أو عِدّل اسم الشركة يدويًا");

  // الخطة: افتراضيًا التجربة المجانية 14 يومًا
  const plan = await getPlanByCode(String(body.planCode || "").trim() || "trial");
  if (!plan || !plan.isActive) return jsonError("الخطة المختارة غير معروفة");

  // إنشاء الشركة + البذر + المدير الأول + الاشتراك (بالترتيب نفسه لإنشاء الشركات اليدوي)
  const company = await db.company.create({
    data: {
      name: request.companyName,
      shortName: request.shortName,
      notes: `انضمام ذاتي — مسؤول التواصل: ${request.contactName}${request.phone ? ` · ${request.phone}` : ""}${request.email ? ` · ${request.email}` : ""}`,
    },
  });
  await ensurePostingRules(forCompany(company.id));
  await db.user.create({
    data: {
      companyId: company.id,
      username,
      passwordHash: request.passwordHash,
      salt: request.salt,
      role: "admin",
      fullName: request.adminFullName || request.contactName || "مدير",
      jobTitle: "مدير",
    },
  });
  await db.subscription.create({
    data: {
      companyId: company.id,
      planId: plan.id,
      status: plan.code === "trial" ? "trial" : "active",
      endsAt: plan.durationDays > 0 ? addDays(new Date(), plan.durationDays) : null,
      notes: `اشتراك أولي من اعتماد طلب انضمام #${request.id}`,
    },
  });
  await sysDb.registrationRequest.update({
    where: { id: request.id },
    data: {
      status: "approved",
      requestedUsername: username, // توثيق الاسم الفعلي المعتمد
      createdCompanyId: company.id,
      processedBy: guard.user.username,
      processedAt: new Date(),
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "اعتماد",
    entityType: "registration_request",
    entityId: request.id,
    entityName: request.companyName,
    newStatus: `company:${company.id}`,
    reason: `اشتراك ${plan.name}`,
  });

  return ok({
    companyId: company.id,
    username,
    planCode: plan.code,
    planName: plan.name,
    message: `تم اعتماد الطلب — أُنشئت شركة «${request.companyName}» مع مدير «${username}» واشتراك ${plan.name}`,
  }, 201);
}
