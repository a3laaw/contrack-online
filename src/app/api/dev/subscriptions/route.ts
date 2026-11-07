// ============================================================
// POST /api/dev/subscriptions — إدارة اشتراك شركة (Task 115) — للمطور حصريًا:
// assign (تعيين أول) · renew (تجديد/تمديد) · freeze (تجميد) · unfreeze (تشغيل)
// · change_plan (تغيير الخطة) · cancel (إلغاء) — كل إجراء يُوثق في التدقيق.
// قواعد المدة: التجديد يُمدد من نهاية الاشتراك الحالي إن كانت مستقبلًا وإلا من الآن
// (renewEndsAt) — فلا يخسر المشترك أيامًا بالتجديد المبكر.
// ============================================================
import { NextRequest } from "next/server";
import { db, sysDb } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { getPlanByCode } from "@/lib/saas-server";
import { addDays, effectiveSubscriptionStatus, renewEndsAt } from "@/lib/saas-core";

const ACTIONS = ["assign", "renew", "freeze", "unfreeze", "change_plan", "cancel"] as const;

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "developer") {
    return jsonError("إدارة الاشتراكات للمطور فقط", 403);
  }

  const body = (await req.json().catch(() => ({}))) as {
    companyId?: number;
    action?: string;
    planCode?: string;
    days?: number;
    until?: string; // YYYY-MM-DD — بديل عن days
    notes?: string;
  };

  const companyId = Number(body.companyId);
  if (!Number.isFinite(companyId) || companyId <= 0) return jsonError("معرف الشركة غير صالح");
  const action = String(body.action || "") as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) return jsonError("إجراء غير معروف");

  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return jsonError("الشركة غير موجودة", 404);

  const sub = await sysDb.subscription.findUnique({
    where: { companyId },
    include: { plan: true },
  });
  const now = new Date();

  // حالة موحدة للمتابعة { planId, status, endsAt, notes } ثم كتابة واحدة
  let planId = sub?.planId ?? 0;
  let status = sub?.status ?? "";
  let endsAt = sub?.endsAt ?? null;
  let notes = sub?.notes ?? "";
  let oldLabel = sub ? `${sub.plan.name}/${sub.status}` : "بدون اشتراك";

  if (action === "assign") {
    if (sub) return jsonError("يوجد اشتراك بالفعل — استخدم التجديد أو تغيير الخطة");
    const plan = await getPlanByCode(String(body.planCode || "").trim());
    if (!plan || !plan.isActive) return jsonError("الخطة المختارة غير معروفة");
    planId = plan.id;
    status = plan.code === "trial" ? "trial" : "active";
    endsAt = plan.durationDays > 0 ? addDays(now, plan.durationDays) : null;
    notes = String(body.notes || "").trim();
  } else {
    if (!sub) return jsonError("لا يوجد اشتراك لهذه الشركة — عيّن اشتراكًا أولًا");

    if (action === "renew") {
      if (sub.status === "cancelled") return jsonError("الاشتراك ملغى — عيّن اشتراكًا جديدًا");
      const until = String(body.until || "").trim();
      let newEnd: Date | null;
      if (until) {
        const d = new Date(`${until}T23:59:59`);
        if (isNaN(d.getTime())) return jsonError("تاريخ الانتهاء غير صالح");
        newEnd = d;
      } else {
        const days = Number(body.days);
        if (!Number.isFinite(days) || days <= 0 || days > 3650)
          return jsonError("عدد أيام التجديد يجب أن يكون بين 1 و 3650");
        // خطة دائمة (endsAt=null) والتجديد بأيام ⇒ يصبح مؤقتًا من الآن
        newEnd = renewEndsAt(sub.endsAt, days, now);
      }
      endsAt = newEnd;
      status = "active"; // التجديد ينهي حالة التجربة/التجميد
    } else if (action === "freeze") {
      if (sub.status === "frozen") return jsonError("الاشتراك مجمّد بالفعل");
      if (sub.status === "cancelled") return jsonError("لا يمكن تجميد اشتراك ملغى");
      status = "frozen";
    } else if (action === "unfreeze") {
      if (sub.status !== "frozen") return jsonError("الاشتراك ليس مجمّدًا");
      const effective = effectiveSubscriptionStatus(sub, now);
      if (effective === "expired")
        return jsonError("مدة الاشتراك منتهية — جدّد أولًا ثم سيُشغَّل تلقائيًا بالتجديد");
      status = "active";
    } else if (action === "change_plan") {
      const plan = await getPlanByCode(String(body.planCode || "").trim());
      if (!plan || !plan.isActive) return jsonError("الخطة المختارة غير معروفة");
      if (plan.id === sub.planId) return jsonError("الخطة المختارة هي الحالية بالفعل");
      planId = plan.id;
      // المدة: خطة دائمة ⇒ بلا انتهاء · خطة مؤقتة على اشتراك دائم ⇒ من الآن
      if (plan.durationDays === 0) endsAt = null;
      else if (!sub.endsAt) endsAt = addDays(now, plan.durationDays);
      // مؤقت→مؤقت: نهاية المدة الحالية تبقى كما هي (التغيير يعدّل الخطة لا المدة)
    } else if (action === "cancel") {
      if (sub.status === "cancelled") return jsonError("الاشتراك ملغى بالفعل");
      status = "cancelled";
    }
  }

  const saved = sub
    ? await sysDb.subscription.update({
        where: { companyId },
        data: { planId, status, endsAt, notes },
        include: { plan: true },
      })
    : await sysDb.subscription.create({
        data: { companyId, planId, status, endsAt, notes },
        include: { plan: true },
      });

  await audit(db, {
    username: guard.user.username,
    action: "اشتراك",
    entityType: "subscription",
    entityId: saved.id,
    entityName: company.name,
    oldStatus: oldLabel,
    newStatus: `${saved.plan.name}/${saved.status}`,
    reason: String(body.notes || "").trim() || action,
  });

  return ok({
    subscription: {
      id: saved.id,
      companyId,
      status: saved.status,
      effective: effectiveSubscriptionStatus(saved, now),
      planCode: saved.plan.code,
      planName: saved.plan.name,
      endsAt: saved.endsAt,
      notes: saved.notes,
    },
    message: "تم تنفيذ الإجراء وتوثيقه",
  });
}
