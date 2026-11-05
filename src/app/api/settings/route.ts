import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, ok } from "@/lib/api-utils";
import { getSettingsRow, numOr } from "@/lib/contrack-server";

function serialize(s: Awaited<ReturnType<typeof getSettingsRow>>) {
  return {
    id: s.companyId, // Task 85: PK صار company_id — أُبقي المفتاح لثبات شكل الاستجابة
    companyId: s.companyId,
    companyName: s.companyName,
    companyAddress: s.companyAddress,
    companyPhone: s.companyPhone,
    companyEmail: s.companyEmail,
    headerTitle: s.headerTitle,
    currency: s.currency,
    companyLicense: s.companyLicense,
    bankFeeAmount: Number(s.bankFeeAmount),
    bankFeeMethod: s.bankFeeMethod,
    bankFeeEnabled: s.bankFeeEnabled,
    cashflowEnabled: s.cashflowEnabled,
    openingBalanceBank: Number(s.openingBalanceBank),
    openingBalanceCash: Number(s.openingBalanceCash),
    openingBalanceDate: s.openingBalanceDate,
    cashStartDate: s.cashStartDate,
    subPayClientGate: s.subPayClientGate,
    collectionAlertDays: s.collectionAlertDays,
    expiryAlerts: s.expiryAlerts,
    descPrefixReceipt: s.descPrefixReceipt,
    descPrefixSupervision: s.descPrefixSupervision,
    descPrefixTransfer: s.descPrefixTransfer,
    descPrefixCustody: s.descPrefixCustody,
    descPrefixStageNote: s.descPrefixStageNote,
    autoBackupEnabled: s.autoBackupEnabled,
    autoBackupInterval: s.autoBackupInterval,
    uiTheme: s.uiTheme,
    entryApprovalMode: s.entryApprovalMode,
    updatedAt: s.updatedAt,
  };
}

const STR_FIELDS = [
  "companyName",
  "companyAddress",
  "companyPhone",
  "companyEmail",
  "headerTitle",
  "currency",
  "companyLicense",
  "bankFeeMethod",
  "openingBalanceDate",
  "cashStartDate",
  "expiryAlerts",
  "descPrefixReceipt",
  "descPrefixSupervision",
  "descPrefixTransfer",
  "descPrefixCustody",
  "descPrefixStageNote",
  "uiTheme",
] as const;

const NUM_FIELDS = ["bankFeeAmount", "openingBalanceBank", "openingBalanceCash", "autoBackupInterval"] as const;
const BOOL_FIELDS = ["bankFeeEnabled", "cashflowEnabled", "subPayClientGate", "autoBackupEnabled", "entryApprovalMode"] as const;

/** الإعدادات — ينشئ الصف الافتراضي id=1 إن لم يوجد */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const s = await getSettingsRow();
  return ok({ settings: serialize(s) });
}

/** حفظ الإعدادات — للمدير */
export async function PUT(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const f of STR_FIELDS) if (body[f] !== undefined) data[f] = String(body[f]);
  for (const f of NUM_FIELDS) if (body[f] !== undefined) data[f] = numOr(body[f], 0);
  for (const f of BOOL_FIELDS) if (body[f] !== undefined) data[f] = Boolean(body[f]);
  if (body.collectionAlertDays !== undefined) {
    // أدنى نافذة 7 أيام (كالمصدر)
    data.collectionAlertDays = Math.max(7, Math.trunc(numOr(body.collectionAlertDays, 30)));
  }
  if (Object.keys(data).length === 0) {
    const s = await getSettingsRow();
    return ok({ settings: serialize(s) });
  }

  const s = await getSettingsRow();
  // Task 112 — updateMany بدل update(where companyId): غلاف db يحصر companyId آليًا
  // (update بالـwhere companyId المباشر يمر بمسار injectCompound المخصص للمفاتيح المركبة فيكسر القيمة)
  await db.setting.updateMany({ where: { companyId: s.companyId }, data });
  const updated = await getSettingsRow();
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "settings",
    entityId: s.companyId,
    entityName: "الإعدادات",
    reason: Object.keys(data).join("، "),
  });
  return ok({ settings: serialize(updated) });
}
