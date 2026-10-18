import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, nextAddendumNumber, ok, parseDay } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { ADDENDUM_TYPES, addendumEditable } from "@/lib/addendum-server";

type P = { params: Promise<{ id: string }> };

/** ملحقات العقد بترتيبها مع عدد الأجزاء وصافي كل ملحق */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const rows = await db.addendum.findMany({
    where: { contractId },
    orderBy: { id: "asc" },
    include: {
      subContract: { select: { id: true, amount: true, subcontractor: { select: { id: true, name: true } } } },
      items: { select: { action: true, side: true, amount: true } },
    },
  });

  const addendums = rows.map((a) => {
    const add = r3(a.items.filter((i) => i.side === "client" && i.action === "add").reduce((s, i) => s + Number(i.amount), 0));
    const deduct = r3(a.items.filter((i) => i.side === "client" && i.action === "delete").reduce((s, i) => s + Number(i.amount), 0));
    return {
      id: a.id,
      addendumNumber: a.addendumNumber,
      addendumType: a.addendumType,
      adate: a.adate,
      reason: a.reason,
      description: a.description,
      amountAdd: a.items.length ? add : Number(a.amountAdd),
      amountDeduct: a.items.length ? deduct : Number(a.amountDeduct),
      net: r3(a.items.length ? add - deduct : Number(a.amountAdd) - Number(a.amountDeduct)),
      status: a.status,
      approvedDate: a.approvedDate,
      appliedAt: a.appliedAt,
      itemsCount: a.items.length,
      side: a.side,
      subContractId: a.subContractId,
      subContract: a.subContract
        ? { id: a.subContract.id, amount: Number(a.subContract.amount), subcontractorName: a.subContract.subcontractor.name }
        : null,
      cancelReason: a.cancelReason,
      cancelledAt: a.cancelledAt,
      editable: addendumEditable(a),
    };
  });

  const totals = {
    add: r3(addendums.filter((a) => a.status === "معتمد").reduce((s, a) => s + a.amountAdd, 0)),
    deduct: r3(addendums.filter((a) => a.status === "معتمد").reduce((s, a) => s + a.amountDeduct, 0)),
  };
  return ok({ addendums, totals, net: r3(totals.add - totals.deduct) });
}

/**
 * إنشاء ملحق/أمر تغييري — مسودة بترقيم ADD-### لكل عقد (العد يشمل الملغاة).
 * «عقد إضافي» إجباري amountAdd>0 · جهة الباطن تتطلب عقد باطن تابعًا للعقد.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true, contractNumber: true } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const addendumType = String(body.addendumType || "أمر تغييري").trim();
  if (!ADDENDUM_TYPES.includes(addendumType as (typeof ADDENDUM_TYPES)[number])) {
    return jsonError("نوع الملحق غير صحيح");
  }
  const side = String(body.side || "client").trim().toLowerCase();
  if (side !== "client" && side !== "sub") return jsonError("جهة الملحق غير صحيحة");

  let subContractId: number | null = null;
  if (side === "sub") {
    const sid = Number(body.subContractId);
    if (!Number.isFinite(sid) || !sid) return jsonError("حدد عقد الباطن للملحق");
    const sc = await db.subContract.findUnique({ where: { id: sid } });
    if (!sc) return jsonError("عقد الباطن غير موجود", 404);
    if (sc.contractId !== contractId) return jsonError("عقد الباطن لا يتبع هذا العقد");
    subContractId = sid;
  }

  let amountAdd = 0;
  let amountDeduct = 0;
  if (body.amountAdd !== undefined) {
    amountAdd = Number(body.amountAdd);
    if (!Number.isFinite(amountAdd) || amountAdd < 0) return jsonError("قيم الملحق لا يمكن أن تكون سالبة");
  }
  if (body.amountDeduct !== undefined) {
    amountDeduct = Number(body.amountDeduct);
    if (!Number.isFinite(amountDeduct) || amountDeduct < 0) return jsonError("قيم الملحق لا يمكن أن تكون سالبة");
  }
  if (addendumType === "عقد إضافي" && !(amountAdd > 0)) {
    return jsonError("العقد الإضافي يتطلب قيمة إضافية");
  }

  const adate = body.adate !== undefined ? parseDay(body.adate) : "";
  if (body.adate !== undefined && body.adate && !adate) return jsonError("تاريخ الملحق غير صالح");
  const reason = String(body.reason || "").trim();
  const description = String(body.description || "").trim();

  const created = await db.$transaction(async (tx) => {
    const addendumNumber = await nextAddendumNumber(contractId, tx);
    const row = await tx.addendum.create({
      data: {
        addendumNumber,
        contractId,
        addendumType,
        adate: body.adate !== undefined ? adate : "",
        reason,
        description,
        // رأس ملحق الباطن لا يمس قيمة عقد العميل — الصافي يُطبق على قيمة الباطن عند الاعتماد
        amountAdd: side === "sub" ? 0 : amountAdd,
        amountDeduct: side === "sub" ? 0 : amountDeduct,
        status: "مسودة",
        side,
        subContractId,
      },
    });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: `إنشاء ${addendumType}`,
        description: `${addendumNumber}${reason ? ` · ${reason}` : ""}`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إنشاء",
      entityType: "addendum",
      entityId: row.id,
      entityName: addendumNumber,
    });
    return row;
  });

  return ok(
    {
      addendum: {
        id: created.id,
        addendumNumber: created.addendumNumber,
        addendumType: created.addendumType,
        status: created.status,
        side: created.side,
        subContractId: created.subContractId,
      },
    },
    201
  );
}
