import { NextRequest } from "next/server";
import { db, currentCompanyId } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  FEATURE_CATALOG,
  FORCED_ON_FEATURES,
  isEffectivelyEnabled,
  isRawEnabled,
} from "@/lib/feature-flags";

/**
 * المزايا الاختيارية — عقد الواجهة المتفق عليه:
 *   GET  ⇒ { flags: [{key, name, desc, group, requires, enabled, effective}] }
 *   PUT  ⇒ جسم { key, enabled } — للمدير/المطور فقط (upsert في feature_flags).
 * مقابلة feature_service.py (_raw_flags / enabled / set_enabled).
 */

/** GET /api/feature-flags — دمج المحفوظ مع الافتراضي وحساب effective بعد requires */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const rows = await db.featureFlag.findMany();
  const stored: Record<string, boolean> = {};
  for (const r of rows) stored[r.key] = r.enabled;

  const flags = FEATURE_CATALOG.map((spec) => ({
    key: spec.key,
    name: spec.name,
    desc: spec.desc,
    group: spec.group,
    requires: spec.requires,
    enabled: isRawEnabled(spec.key, stored),
    effective: isEffectivelyEnabled(spec.key, stored),
  }));

  return ok({ flags });
}

/** PUT /api/feature-flags — حفظ حالة مفتاح واحد (المدير/المطور فقط) */
export async function PUT(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = String(body.key ?? "").trim();
  const spec = FEATURE_CATALOG.find((f) => f.key === key);
  if (!spec) return jsonError("مفتاح ميزة غير معروف", 404);
  if (FORCED_ON_FEATURES.includes(key)) {
    return jsonError("هذه الميزة مفعّلة دائمًا في هذا النظام ولا يمكن تعطيلها");
  }

  const enabled = Boolean(body.enabled);

  await db.$transaction(async (tx) => {
    await tx.featureFlag.upsert({
      where: { key },
      update: { enabled },
      create: { key, enabled },
    });
    // المرحلة 3/ج: مزامنة bank_fee مع إعدادات الرسوم — مطابقة المكتبي
    // settings.py:_save_modules ⇒ settings_service.set_modules(bank_fee=…):
    // الرسوم تُقرأ من الإعداد bankFeeEnabled في محرك السندات (receiptBankFee)
    // فحفظ المفتاح هنا يحدّثه فورًا (None = لا تغيير لبقية المفاتيح — قاعدة 15).
    if (key === "bank_fee") {
      const cid = await currentCompanyId();
      if (cid != null) await tx.setting.update({ where: { companyId: cid }, data: { bankFeeEnabled: enabled } });
    }
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل ميزة",
      entityType: "feature_flag",
      entityId: 0,
      entityName: `${spec.name} (${key}) — ${enabled ? "مفعّلة" : "معطّلة"}`,
    });
  });

  return ok({ key, enabled, saved: true });
}
