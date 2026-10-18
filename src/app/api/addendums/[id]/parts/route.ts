import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { addendumEditable, partDueDate, recomputeAddendumHeader } from "@/lib/addendum-server";

type P = { params: Promise<{ id: string }> };

/**
 * إضافة جزء إلى ملحق قابل للتعديل:
 * add boq (بند جديد) / add plan (دفعة جديدة) / delete boq|plan|stage (حذف ناعم معلَّم) / unlink stage (فك ربط مرحلة)
 * المجموع التراكمي للملحق يُعاد حسابه: amountAdd=Σ إضافات العميل · amountDeduct=Σ خصومات العميل.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const addendumId = Number(idStr);
  if (!Number.isFinite(addendumId)) return jsonError("معرف غير صالح");

  const a = await db.addendum.findUnique({ where: { id: addendumId } });
  if (!a) return jsonError("الملحق غير موجود", 404);
  if (a.status === "ملغى") return jsonError("الملحق ملغى — لا يمكن التعديل عليه");
  if (a.appliedAt || a.status === "معتمد") return jsonError("تم تنفيذ هذا الملحق — لا يمكن التعديل");
  if (!addendumEditable(a)) return jsonError("لا يمكن تعديل هذا الملحق");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "").trim();
  const refKind = String(body.refKind || "").trim();
  if (!["add", "delete", "unlink"].includes(action)) return jsonError("نوع الحركة غير صحيح (add|delete|unlink)");
  if (!["boq", "plan", "stage"].includes(refKind)) return jsonError("نوع المرجع غير صحيح (boq|plan|stage)");

  const side = a.side;
  const subContractId = a.subContractId;
  if (side === "sub" && !subContractId) return jsonError("حدد عقد الباطن للملحق أولًا");

  // ===== التحققات قبل المعاملة =====
  let newPart: {
    side: string;
    action: string;
    subContractId: number | null;
    description: string;
    qty: number;
    unit: string;
    unitPrice: number;
    amount: number;
    refKind: string;
    refId: number;
  } | null = null;

  if (action === "add") {
    if (refKind === "stage") return jsonError("إضافة مرحلة غير مدعومة — استخدم بنودًا أو دفعات");
    const description = String(body.description || "").trim();
    if (!description) return jsonError("وصف البند مطلوب");

    let qty = 1;
    let unitPrice = 0;
    let amount = 0;
    if (refKind === "boq") {
      qty = Number(body.qty ?? 0);
      unitPrice = Number(body.unitPrice ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) return jsonError("كمية البند يجب أن تكون أكبر من صفر");
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return jsonError("سعر الوحدة لا يمكن أن يكون سالبًا");
      amount = body.amount !== undefined ? Number(body.amount) : r3(qty * unitPrice);
      if (!Number.isFinite(amount) || amount <= 0) return jsonError("قيمة البند يجب أن تكون أكبر من صفر");
    } else {
      // دفعة جديدة: المبلغ هو الأساس
      amount = Number(body.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) return jsonError("قيمة الدفعة يجب أن تكون أكبر من صفر");
      qty = 1;
      unitPrice = amount;
    }
    const dueDate = refKind === "plan" && body.dueDate ? parseDay(body.dueDate) : "";
    if (refKind === "plan" && body.dueDate && !dueDate) return jsonError("تاريخ استحقاق الدفعة غير صالح");

    newPart = {
      side,
      action: "add",
      subContractId,
      description,
      qty,
      // لأجزاء الدفعات يُستخدم حقل unit مخزنًا لتاريخ الاستحقاق (لا حقل مخصص — موثق)
      unit: refKind === "plan" ? dueDate : String(body.unit || "").trim(),
      unitPrice,
      amount,
      refKind,
      refId: 0,
    };
  } else if (action === "delete") {
    const refId = Number(body.refId || 0);
    if (!refId) return jsonError("حدد العنصر المطلوب حذفه أولًا");
    const dup = await db.addendumItem.findFirst({
      where: { addendumId, side, action: "delete", refKind, refId },
    });
    if (dup) return jsonError(refKind === "boq" ? "هذا البند مُعلَّم للحذف بالفعل" : "هذا العنصر مُعلَّم للحذف بالفعل");

    let amount = 0;
    let description = String(body.description || "").trim();
    if (refKind === "boq") {
      const item = await db.boqItem.findUnique({ where: { id: refId } });
      if (!item || item.contractId !== a.contractId) return jsonError("البند المحدد لا يتبع هذا العقد");
      if (item.deleted) return jsonError("البند محذوف بالفعل");
      const linked = await db.subContractItem.count({ where: { boqItemId: refId } });
      if (linked > 0) return jsonError("البند مرتبط بعقد باطن");
      amount = r3(Number(item.qty) * Number(item.unitPrice));
      if (!description) description = item.description;
    } else if (refKind === "plan") {
      const line = await db.paymentPlanItem.findUnique({ where: { id: refId } });
      if (!line || line.contractId !== a.contractId) return jsonError("الدفعة المحددة لا تتبع هذا العقد");
      if (line.deletedAddendumId) return jsonError("الدفعة محذوفة بالفعل");
      const links = await db.voucherPaymentLink.count({
        where: { lineId: refId, kind: "receipt", voucher: { cancelled: false } },
      });
      if (links > 0) return jsonError("لا يمكن حذف الدفعة: مرتبطة بسند قبض سارٍ");
      amount = Number(line.amount);
      if (!description) description = line.title;
    } else {
      const st = await db.contractStage.findUnique({ where: { id: refId } });
      if (!st || st.contractId !== a.contractId) return jsonError("المرحلة المحددة لا تتبع هذا العقد");
      if (st.deletedAddendumId) return jsonError("المرحلة محذوفة بالفعل");
      if (!description) description = st.name;
    }
    newPart = {
      side,
      action: "delete",
      subContractId,
      description,
      qty: refKind === "boq" ? 0 : 1,
      unit: "",
      unitPrice: 0,
      amount,
      refKind,
      refId,
    };
  } else {
    // unlink: فك ربط مرحلة عن دفعات الخطة
    if (refKind !== "stage") return jsonError("فك الربط يخص المراحل فقط");
    const refId = Number(body.refId || 0);
    if (!refId) return jsonError("حدد المرحلة المطلوب فك ربطها");
    const dup = await db.addendumItem.findFirst({
      where: { addendumId, side, action: "unlink", refKind: "stage", refId },
    });
    if (dup) return jsonError("هذه المرحلة مُعلَّمة للفك بالفعل");
    const st = await db.contractStage.findUnique({ where: { id: refId } });
    if (!st || st.contractId !== a.contractId) return jsonError("المرحلة المحددة لا تتبع هذا العقد");
    const linked = await db.paymentPlanItem.count({ where: { contractId: a.contractId, stageId: refId } });
    if (linked === 0) return jsonError("لا توجد دفعات مرتبطة بهذه المرحلة");
    newPart = {
      side,
      action: "unlink",
      subContractId,
      description: String(body.description || "").trim() || st.name,
      qty: 0,
      unit: "",
      unitPrice: 0,
      amount: 0,
      refKind: "stage",
      refId,
    };
  }

  const partId = await db.$transaction(async (tx) => {
    const created = await tx.addendumItem.create({ data: { addendumId, ...newPart! } });
    const totals = await recomputeAddendumHeader(tx, addendumId);
    await audit(tx, {
      username: guard.user.username,
      action: "إضافة جزء",
      entityType: "addendum",
      entityId: addendumId,
      entityName: a.addendumNumber,
      newStatus: `${action}:${refKind}`,
      reason: `المجاميع بعد التعديل: +${totals.add} / −${totals.deduct}`,
    });
    return created.id;
  });

  const part = await db.addendumItem.findUnique({ where: { id: partId } });
  const fresh = await db.addendum.findUnique({ where: { id: addendumId }, select: { amountAdd: true, amountDeduct: true } });
  return ok(
    {
      part: part
        ? {
            id: part.id,
            side: part.side,
            action: part.action,
            refKind: part.refKind,
            refId: part.refId,
            description: part.description,
            qty: Number(part.qty),
            unit: part.refKind === "plan" ? "" : part.unit,
            dueDate: partDueDate(part),
            unitPrice: Number(part.unitPrice),
            amount: Number(part.amount),
          }
        : null,
      amountAdd: Number(fresh?.amountAdd || 0),
      amountDeduct: Number(fresh?.amountDeduct || 0),
    },
    201
  );
}

/** إزالة جزء من مسودة (?partId=) — الأجزاء المنفذة لا تُحذف */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const addendumId = Number(idStr);
  const partId = Number(req.nextUrl.searchParams.get("partId") || 0);
  if (!Number.isFinite(addendumId) || !partId) return jsonError("معرف غير صالح");

  const a = await db.addendum.findUnique({ where: { id: addendumId } });
  if (!a) return jsonError("الملحق غير موجود", 404);
  if (a.status === "ملغى") return jsonError("الملحق ملغى — لا يمكن التعديل عليه");
  if (a.appliedAt || a.status === "معتمد") return jsonError("تم تنفيذ هذا الملحق — لا يمكن التعديل");

  const part = await db.addendumItem.findUnique({ where: { id: partId } });
  if (!part || part.addendumId !== addendumId) return jsonError("الجزء غير موجود", 404);
  if (part.applied) return jsonError("تم تنفيذ السطر — لا يمكن حذفه");

  await db.$transaction(async (tx) => {
    await tx.addendumItem.delete({ where: { id: partId } });
    await recomputeAddendumHeader(tx, addendumId);
    await audit(tx, {
      username: guard.user.username,
      action: "إزالة جزء",
      entityType: "addendum",
      entityId: addendumId,
      entityName: a.addendumNumber,
    });
  });

  const fresh = await db.addendum.findUnique({ where: { id: addendumId }, select: { amountAdd: true, amountDeduct: true } });
  return ok({
    removed: partId,
    amountAdd: Number(fresh?.amountAdd || 0),
    amountDeduct: Number(fresh?.amountDeduct || 0),
  });
}
