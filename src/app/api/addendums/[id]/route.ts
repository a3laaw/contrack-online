import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { AddendumError, addendumEditable, cancelAddendumTx, partDueDate } from "@/lib/addendum-server";

type P = { params: Promise<{ id: string }> };

async function loadAddendum(id: number) {
  return db.addendum.findUnique({
    where: { id },
    include: {
      contract: {
        select: { id: true, contractNumber: true, contractName: true, status: true, customerId: true },
      },
      subContract: { select: { id: true, amount: true, subcontractor: { select: { id: true, name: true } } } },
      items: { orderBy: { id: "asc" } },
    },
  });
}

/** تفاصيل الملحق بأجزائه بتفاصيلها (المُنشأ والمُعاد) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const a = await loadAddendum(id);
  if (!a) return jsonError("الملحق غير موجود", 404);

  // أسماء العناصر المنشأة/المحذوفة لأجزاء boq وplan
  const boqIds = a.items.map((i) => i.boqItemId || i.createdItemId).filter((x) => x > 0);
  const planIds = a.items.filter((i) => i.refKind === "plan").map((i) => i.createdItemId || i.refId).filter((x) => x > 0);
  type BoqRow = { id: number; description: string; amount: Prisma.Decimal; deleted: boolean };
  type PlanRow = { id: number; title: string; amount: Prisma.Decimal; dueDate: string; deletedAddendumId: number };
  const boqRows: BoqRow[] = boqIds.length
    ? await db.boqItem.findMany({ where: { id: { in: boqIds } }, select: { id: true, description: true, amount: true, deleted: true } })
    : [];
  const planRows: PlanRow[] = planIds.length
    ? await db.paymentPlanItem.findMany({ where: { id: { in: planIds } }, select: { id: true, title: true, amount: true, dueDate: true, deletedAddendumId: true } })
    : [];
  const boqMap = new Map<number, BoqRow>(boqRows.map((b) => [b.id, b]));
  const planMap = new Map<number, PlanRow>(planRows.map((p) => [p.id, p]));

  return ok({
    addendum: {
      id: a.id,
      addendumNumber: a.addendumNumber,
      addendumType: a.addendumType,
      adate: a.adate,
      reason: a.reason,
      description: a.description,
      amountAdd: Number(a.amountAdd),
      amountDeduct: Number(a.amountDeduct),
      net: r3(Number(a.amountAdd) - Number(a.amountDeduct)),
      status: a.status,
      approvedDate: a.approvedDate,
      appliedAt: a.appliedAt,
      side: a.side,
      subContractId: a.subContractId,
      subContract: a.subContract
        ? { id: a.subContract.id, amount: Number(a.subContract.amount), subcontractorName: a.subContract.subcontractor.name }
        : null,
      itemsCount: a.items.length,
      cancelReason: a.cancelReason,
      cancelledAt: a.cancelledAt,
      editable: addendumEditable(a),
      contract: a.contract,
    },
    items: a.items.map((i) => {
      const refId = i.createdItemId || i.refId || i.boqItemId || 0;
      const boq = i.refKind === "boq" ? boqMap.get(refId) : undefined;
      const plan = i.refKind === "plan" ? planMap.get(refId) : undefined;
      return {
        id: i.id,
        side: i.side,
        action: i.action,
        refKind: i.refKind,
        refId: i.refId,
        boqItemId: i.boqItemId,
        description: i.description,
        qty: Number(i.qty),
        unit: i.refKind === "plan" ? "" : i.unit,
        dueDate: partDueDate(i),
        unitPrice: Number(i.unitPrice),
        amount: Number(i.amount),
        applied: i.applied,
        createdItemId: i.createdItemId,
        restoreDeletedBy: i.restoreDeletedBy,
        createdItem:
          i.createdItemId > 0
            ? boq
              ? { kind: "boq", id: boq.id, label: boq.description, amount: Number(boq.amount), deleted: boq.deleted }
              : plan
                ? { kind: "plan", id: plan.id, label: plan.title, amount: Number(plan.amount), dueDate: plan.dueDate }
                : null
            : null,
        refLabel: boq?.description || plan?.title || "",
      };
    }),
  });
}

/** تعديل رأس المسودة (reason/description/adate/amountAdd/amountDeduct) — بعد الاعتماد لا تعديل إطلاقًا */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const a = await db.addendum.findUnique({ where: { id } });
  if (!a) return jsonError("الملحق غير موجود", 404);
  if (a.status === "معتمد") return jsonError("الملحق معتمد — لا يمكن تعديله");
  if (a.status === "ملغى") return jsonError("الملحق ملغى — لا يمكن التعديل");
  if (!addendumEditable(a)) return jsonError("لا يمكن تعديل هذا الملحق");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.reason !== undefined) data.reason = String(body.reason).trim();
  if (body.description !== undefined) data.description = String(body.description).trim();
  if (body.adate !== undefined) {
    if (!body.adate) {
      data.adate = "";
    } else {
      const d = parseDay(body.adate);
      if (!d) return jsonError("تاريخ الملحق غير صالح");
      data.adate = d;
    }
  }
  if (body.amountAdd !== undefined) {
    const v = Number(body.amountAdd);
    if (!Number.isFinite(v) || v < 0) return jsonError("قيمة الإضافة لا يمكن أن تكون سالبة");
    if (a.addendumType === "عقد إضافي" && !(v > 0)) return jsonError("العقد الإضافي يتطلب قيمة إضافية");
    data.amountAdd = v;
  }
  if (body.amountDeduct !== undefined) {
    const v = Number(body.amountDeduct);
    if (!Number.isFinite(v) || v < 0) return jsonError("قيمة الخصم لا يمكن أن تكون سالبة");
    // رأس ملحق الباطن لا يُخزَّن (الصافي يطبق على قيمة الباطن عند الاعتماد)
    if (a.side === "sub") return jsonError("قيم ملحق الباطن تُدار من أجزائه");
    data.amountDeduct = v;
  }

  if (!Object.keys(data).length) return ok({ addendum: { id: a.id, status: a.status } });

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.addendum.update({ where: { id }, data });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "addendum",
      entityId: id,
      entityName: a.addendumNumber,
    });
    return row;
  });

  return ok({
    addendum: {
      id: updated.id,
      addendumNumber: updated.addendumNumber,
      status: updated.status,
      amountAdd: Number(updated.amountAdd),
      amountDeduct: Number(updated.amountDeduct),
    },
  });
}

/** إلغاء الملحق (مدير فقط) — معتمد ⇒ تراجع كامل restore_parts داخل معاملة واحدة */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason || "").trim();
  if (!reason) return jsonError("سبب الإلغاء مطلوب");

  try {
    const result = await db.$transaction(async (tx) => {
      const res = await cancelAddendumTx(tx, id, reason, guard.user.username);
      await audit(tx, {
        username: guard.user.username,
        action: "إلغاء",
        entityType: "addendum",
        entityId: id,
        entityName: res.addendumNumber,
        oldStatus: res.restored ? "معتمد" : res.status,
        newStatus: "ملغى",
        reason,
      });
      return res;
    });
    return ok({ cancelled: true, ...result });
  } catch (e) {
    if (e instanceof AddendumError) return jsonError(e.message, e.status);
    console.error(e);
    return jsonError("تعذر إلغاء الملحق", 500);
  }
}
