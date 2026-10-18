import "server-only";

/**
 * V5.8: حذف بيانات مقاول الباطن بخيارات — عقد · سند · السجل.
 *
 * مطابق دلاليًا للمكتبي: app/services/sub_delete_service.py
 * (مع lc.delete_sub_contract وpg.purge_vouchers وpg.purge_subcontractor).
 *
 * القواعد المكتبية الحاكمة:
 *  - حذف **عقد باطن** محدد (أو أكثر) وحده — بلا مساس بسجل المقاول ولا بعقوده الأخرى.
 *  - حذف **سند** محدد (أو أكثر) — حذف نهائي لحساب المطور، وإلغاء موثّق لغيره
 *    (الحركة المالية لا تُمحى بلا حساب المطور).
 *  - حذف **سجل المقاول** نفسه — بعد إفراغه فقط؛ يُرفض ما دام عليه عقد أو سند.
 *  - الإلغاء ناعم دائمًا والأرقام لا تُعاد (قاعدة المشروع).
 *
 * لا يمسّ هذا الملف بنود عقد **العميل** أبدًا — فقط ارتباط عقد الباطن.
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { cancelVoucherTx, VOUCHER_TYPE_LABELS, voucherCancelBarrier } from "@/lib/voucher-server";

type Tx = Prisma.TransactionClient;

export class SubDeleteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** حساب المطور فقط — مثل is_developer() المكتبي */
export function isDeveloperRole(role: string): boolean {
  return role === "developer";
}

/** رسالة _require_developer في purge_service.py حرفيًا */
export const DEVELOPER_ONLY_MSG =
  "أداة التنظيف متاحة لحساب المطور فقط.\nهذه الأداة تحذف بيانات نهائيًا ولا تُتاح لأي مستخدم آخر.";

// ============================================================
// معاينة الخيارات — نظير overview(sub_id)
// ============================================================

export interface SubDeleteContractRow {
  id: number;
  /** رقم عقد العميل (client_number) */
  contractNumber: string;
  customerName: string;
  amount: number;
  status: string;
  items: number;
  planRows: number;
  vouchersActive: number;
  claims: number;
  canDelete: boolean;
  blockReason: string;
}

export interface SubDeleteVoucherRow {
  id: number;
  voucherNumber: string;
  vtype: string;
  typeLabel: string;
  vdate: string;
  amount: number;
  cancelled: boolean;
  /** رقم عقد العميل المرتبط (عبر عقد الباطن) */
  linkedContract: string;
  linkedSubContractId: number;
}

export interface SubDeleteOverview {
  subcontractor: {
    id: number;
    subCode: string;
    name: string;
    phone: string;
    email: string;
    activity: string;
    notes: string;
  } | null;
  contracts: SubDeleteContractRow[];
  vouchers: SubDeleteVoucherRow[];
  summary: {
    contracts: number;
    contractsValue: number;
    vouchers: number;
    vouchersActive: number;
    vouchersCancelled: number;
    vouchersTotal: number;
  };
  canDeleteRecord: boolean;
  recordBlock: string;
}

function emptyOverview(): SubDeleteOverview {
  return {
    subcontractor: null,
    contracts: [],
    vouchers: [],
    summary: { contracts: 0, contractsValue: 0, vouchers: 0, vouchersActive: 0, vouchersCancelled: 0, vouchersTotal: 0 },
    canDeleteRecord: false,
    recordBlock: "",
  };
}

/** قراءة فقط: عقود المقاول وسنداته وحالة سجل المقاول — مثل overview() */
export async function subDeleteOverview(subId: number): Promise<SubDeleteOverview> {
  const sid = Number(subId || 0);
  if (!sid) return emptyOverview();
  const sub = await db.subcontractor.findUnique({ where: { id: sid } });
  if (!sub) return emptyOverview();

  const scs = await db.subContract.findMany({
    where: { subcontractorId: sid },
    orderBy: { id: "asc" },
    select: {
      id: true,
      amount: true,
      status: true,
      contract: { select: { contractNumber: true, customer: { select: { name: true } } } },
    },
  });

  const contracts: SubDeleteContractRow[] = [];
  for (const sc of scs) {
    const [items, plan, vAct, claims] = await Promise.all([
      db.subContractItem.count({ where: { subContractId: sc.id } }),
      db.subPaymentPlanItem.count({ where: { subContractId: sc.id } }),
      db.voucher.count({ where: { subContractId: sc.id, cancelled: false } }),
      db.claim.count({ where: { subContractId: sc.id } }),
    ]);
    // سبب منع حذف هذا العقد (نفس قواعد lifecycle.delete_sub_contract)
    const blocks: string[] = [];
    if (vAct > 0) blocks.push(`${vAct} سند صرف سارٍ`);
    if (claims > 0) blocks.push(`${claims} مطالبة`);
    contracts.push({
      id: sc.id,
      contractNumber: sc.contract.contractNumber || "",
      customerName: sc.contract.customer.name || "",
      amount: Number(sc.amount),
      status: sc.status || "",
      items,
      planRows: plan,
      vouchersActive: vAct,
      claims,
      canDelete: blocks.length === 0,
      blockReason: blocks.join(" · "),
    });
  }

  const scIds = scs.map((s) => s.id);
  const vrows = await db.voucher.findMany({
    where: {
      OR: [
        { partyType: "subcontractor", partyId: sid },
        ...(scIds.length > 0 ? [{ subContractId: { in: scIds } }] : []),
      ],
    },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
    select: { id: true, voucherNumber: true, vtype: true, vdate: true, amount: true, cancelled: true, subContractId: true },
  });
  const scById = new Map(contracts.map((c) => [c.id, c]));
  const vouchers: SubDeleteVoucherRow[] = vrows.map((v) => {
    const sc = v.subContractId ? scById.get(v.subContractId) : undefined;
    return {
      id: v.id,
      voucherNumber: v.voucherNumber || "",
      vtype: v.vtype,
      typeLabel: VOUCHER_TYPE_LABELS[v.vtype] || v.vtype,
      vdate: v.vdate,
      amount: Number(v.amount),
      cancelled: Boolean(v.cancelled),
      linkedContract: sc?.contractNumber || "",
      linkedSubContractId: v.subContractId || 0,
    };
  });

  const summary = {
    contracts: contracts.length,
    contractsValue: r3(contracts.reduce((s, c) => s + c.amount, 0)),
    vouchers: vouchers.length,
    vouchersActive: vouchers.filter((v) => !v.cancelled).length,
    vouchersCancelled: vouchers.filter((v) => v.cancelled).length,
    vouchersTotal: r3(vouchers.filter((v) => !v.cancelled).reduce((s, v) => s + v.amount, 0)),
  };

  // حالة سجل المقاول — مثل نهاية overview()
  const left: string[] = [];
  if (summary.contracts > 0) left.push(`${summary.contracts} عقد باطن`);
  if (summary.vouchers > 0) left.push(`${summary.vouchers} سند`);
  let canDeleteRecord = false;
  let recordBlock = "";
  if (left.length > 0) {
    canDeleteRecord = false;
    recordBlock = `لا يمكن حذف سجل المقاول الآن — عليه ${left.join(" و ")}. احذفها من هذه الشاشة أولًا.`;
  } else {
    canDeleteRecord = true;
    recordBlock = "";
  }

  return {
    subcontractor: {
      id: sub.id,
      subCode: sub.subCode,
      name: sub.name,
      phone: sub.phone,
      email: sub.email,
      activity: sub.activity,
      notes: sub.notes,
    },
    contracts,
    vouchers,
    summary,
    canDeleteRecord,
    recordBlock,
  };
}

// ============================================================
// ① حذف عقود باطن — نظير delete_contracts + lc.delete_sub_contract
// ============================================================

/**
 * حذف عقد باطن واحد داخل معاملة — نفس خطوات المكتبي حرفيًا:
 *  - يُرفض مع سندات صرف سارية (المرتبطة بعقد الباطن + الغامرة غير المرتبطة
 *    على نفس عقد العميل لنفس المقاول — V5.8).
 *  - يُرفض مع أي مطالبات مسجّلة عليه.
 *  - السندات الملغاة تُفكّ عن العقد (تبقى في السجل بلا ارتباط).
 *  - تُحذف خطة الدفعات ومصادرها وبنود الارتباط، وأسطر بنود أوامر التغييري
 *    الخاصة بالمقاول تُحذف والملحق يبقى في سجل العقد بلا ارتباط.
 */
async function deleteSubContractTx(tx: Tx, subContractId: number, username: string, reason: string): Promise<void> {
  const sc = await tx.subContract.findUnique({
    where: { id: subContractId },
    select: { id: true, subcontractorId: true, contractId: true },
  });
  if (!sc) throw new SubDeleteError("عقد الباطن غير موجود", 404);

  // V5.4: تُحتسب السارية فقط — السندات الملغاة تُفكّ ولا تمنع
  let linked = await tx.voucher.count({ where: { subContractId, cancelled: false } });
  // V5.8: السندات غير المرتبطة بعقد باطن (قديمة/غامضة) على نفس عقد العميل تمنع الحذف
  linked += await tx.voucher.count({
    where: {
      partyType: "subcontractor",
      partyId: sc.subcontractorId,
      contractId: sc.contractId,
      cancelled: false,
      subContractId: null,
    },
  });
  if (linked > 0) {
    throw new SubDeleteError("لا يمكن حذف عقد الباطن · للمقاول سندات صرف سارية على هذا العقد.\nألغِ السندات أولًا.");
  }
  const claims = await tx.claim.count({ where: { subContractId } });
  if (claims > 0) {
    throw new SubDeleteError(`لا يمكن حذف عقد الباطن · عليه ${claims} مطالبة مسجّلة.\nاحذف المطالبات أولًا.`);
  }

  // السندات الملغاة تُفكّ عن العقد (تبقى في السجل بلا ارتباط)
  await tx.voucher.updateMany({ where: { subContractId }, data: { subContractId: null } });

  // V5.4: تُحذف خطة الدفعات ومصادرها أيضًا (كانت تبقى معلّقة)
  await tx.subPaymentSource.deleteMany({ where: { subLine: { subContractId } } });
  await tx.subPaymentPlanItem.deleteMany({ where: { subContractId } });

  // V5.5: أوامر التغييري تبقى في سجل العقد لكن بلا ارتباط بعقد باطن محذوف،
  // وتُحذف أسطر بنودها الخاصة بالمقاول (البند نفسه لعميل العميل).
  await tx.addendumItem.deleteMany({ where: { side: "sub", subContractId } });
  await tx.addendum.updateMany({ where: { subContractId }, data: { subContractId: null } });

  await tx.subContractItem.deleteMany({ where: { subContractId } });
  await tx.subContract.delete({ where: { id: subContractId } });

  // مثل log_event(contract_id, "حذف عقد باطن", "")
  await tx.contractEvent.create({
    data: { contractId: sc.contractId, eventType: "حذف عقد باطن", description: "", username },
  });
  await audit(tx, {
    username,
    action: "حذف",
    entityType: "sub_contract",
    entityId: subContractId,
    entityName: `باطن ${subContractId}`,
    reason,
  });
}

export interface SubDeleteIdsResult {
  deleted: number;
  ids: number[];
  errors: { id: number; msg: string }[];
}

/** يحذف عقود باطن محددة فقط — بلا مساس بسجل المقاول أو بغيره (كل عقد في معاملة مستقلة كالمكتبي) */
export async function deleteSubContracts(subContractIds: number[], username: string, reason = ""): Promise<SubDeleteIdsResult> {
  const ids = (subContractIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) throw new SubDeleteError("حدد عقد باطن واحدًا على الأقل.");
  const done: number[] = [];
  const errors: { id: number; msg: string }[] = [];
  for (const scid of ids) {
    try {
      await db.$transaction(async (tx) => {
        await deleteSubContractTx(tx, scid, username, reason);
      });
      done.push(scid);
    } catch (e) {
      errors.push({ id: scid, msg: e instanceof SubDeleteError ? e.message : `تعذّر الحذف: ${e instanceof Error ? e.message : e}` });
    }
  }
  return { deleted: done.length, ids: done, errors };
}

// ============================================================
// ② حذف/إلغاء السندات — نظير delete_vouchers (+ purge_vouchers)
// ============================================================

export interface SubDeleteVouchersResult {
  mode: "delete" | "cancel";
  deleted?: number;
  cancelled?: number;
  ids: number[];
  errors: { id: number; msg: string }[];
}

/**
 * يحذف/يلغي سندات محددة فقط.
 * المطور: حذف نهائي موثّق في سجل التدقيق (نظير purge_vouchers).
 * غيره: إلغاء موثّق (الحركة تبقى في السجل ويُفتح ما عُلّق بها).
 */
export async function deleteSubVouchers(
  voucherIds: number[],
  reason: string,
  user: { username: string; role: string }
): Promise<SubDeleteVouchersResult> {
  const ids = (voucherIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) throw new SubDeleteError("حدد سندًا واحدًا على الأقل.");
  const cleanReason = (reason || "").trim();
  if (!cleanReason) throw new SubDeleteError("اكتب سبب الحذف/الإلغاء — يُحفظ في سجل التدقيق.");

  if (isDeveloperRole(user.role)) {
    // نظير pg.purge_vouchers: حذف نهائي بعد لقطة في سجل التدقيق
    let deleted = 0;
    for (const vid of ids) {
      const row = await db.voucher.findUnique({ where: { id: vid } });
      if (!row) continue;
      await db.$transaction(async (tx) => {
        // سندات الأبناء تُفكّ لا تُحذف ضمنيًا (V3.14/V5.8)
        await tx.voucher.updateMany({ where: { parentVoucherId: vid }, data: { parentVoucherId: null } });
        // القيود المحاسبية المرتبطة تُحذف (source_type LIKE 'voucher%')
        await tx.journalEntry.deleteMany({ where: { sourceType: { in: ["voucher", "voucher_cancel"] }, sourceId: vid } });
        // لقطة الحذف في سجل التدقيق (نظير purge_audit — بلا عمود snapshot في الويب)
        await audit(tx, {
          username: user.username,
          action: "حذف نهائي",
          entityType: "voucher",
          entityId: vid,
          entityName: `${row.voucherNumber} · ${Number(row.amount)} · ${row.party}`,
          reason: cleanReason,
        });
        // روابط الدفع تُحذف تلقائيًا بالـCascade مع السند
        await tx.voucher.delete({ where: { id: vid } });
      });
      deleted += 1;
    }
    return { mode: "delete", deleted, ids, errors: [] };
  }

  // غير المطور: إلغاء موثّق — نظير lc.cancel_voucher لكل سند
  const done: number[] = [];
  const errors: { id: number; msg: string }[] = [];
  for (const vid of ids) {
    const row = await db.voucher.findUnique({ where: { id: vid } });
    if (!row) {
      errors.push({ id: vid, msg: "السند غير موجود." });
      continue;
    }
    if (row.cancelled) {
      errors.push({ id: vid, msg: "السند ملغى بالفعل." });
      continue;
    }
    const barrier = await voucherCancelBarrier(vid);
    if (barrier) {
      errors.push({ id: vid, msg: barrier });
      continue;
    }
    try {
      await db.$transaction(async (tx) => {
        await cancelVoucherTx(tx, vid, `${cleanReason} — إلغاء بدل حذف (بلا حساب مطوّر)`, user.username);
      });
      done.push(vid);
    } catch (e) {
      errors.push({ id: vid, msg: `تعذّر الإلغاء: ${e instanceof Error ? e.message : e}` });
    }
  }
  return { mode: "cancel", cancelled: done.length, ids: done, errors };
}

// ============================================================
// ③ حذف سجل المقاول — نظير delete_record (+ purge_subcontractor)
// ============================================================

/** يحذف سجل المقاول نفسه — بعد إفراغه من العقود والسندات (حساب المطور فقط) */
export async function deleteSubRecord(
  subId: number,
  reason: string,
  user: { username: string; role: string }
): Promise<{ deleted: number }> {
  // ترتيب الرفض كالمكتبي في delete_record: الوجود ⇒ الإفراغ ⇒ السبب ⇒ المطور
  const sid = Number(subId || 0);
  if (!sid) throw new SubDeleteError("حدد المقاول.");
  const ov = await subDeleteOverview(sid);
  if (!ov.subcontractor) throw new SubDeleteError("المقاول غير موجود.", 404);
  if (!ov.canDeleteRecord) {
    throw new SubDeleteError(`لا يمكن حذف سجل المقاول «${ov.subcontractor.name}».\n${ov.recordBlock}`);
  }
  const cleanReason = (reason || "").trim();
  if (!cleanReason) throw new SubDeleteError("اكتب سبب الحذف — يُحفظ في سجل التدقيق.");
  if (!isDeveloperRole(user.role)) throw new SubDeleteError(DEVELOPER_ONLY_MSG);

  // نظير pg.purge_subcontractor(delete_contracts=False, delete_vouchers=False):
  // السجل فارغ مسبقًا — يُحذف السطر نفسه فقط بعد لقطة في سجل التدقيق.
  await db.$transaction(async (tx) => {
    await audit(tx, {
      username: user.username,
      action: "حذف نهائي",
      entityType: "subcontractor",
      entityId: sid,
      entityName: `${ov.subcontractor!.subCode} · ${ov.subcontractor!.name}`,
      reason: cleanReason,
    });
    await tx.subcontractor.delete({ where: { id: sid } });
  });
  return { deleted: 1 };
}
