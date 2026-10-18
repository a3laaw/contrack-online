import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";

type P = { params: Promise<{ id: string }> };

/** تفاصيل مقاول + عقوده الباطنة مع المدفوع/المتبقي */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const sub = await db.subcontractor.findUnique({
    where: { id },
    include: {
      subContracts: {
        include: {
          contract: { select: { id: true, contractNumber: true, contractName: true, customer: { select: { name: true } } } },
          planLines: { select: { amount: true } },
        },
        orderBy: { id: "desc" },
      },
    },
  });
  if (!sub) return jsonError("المقاول غير موجود", 404);

  const contracts: Record<string, unknown>[] = [];
  for (const sc of sub.subContracts) {
    const paidAgg = await db.voucher.aggregate({
      where: { subContractId: sc.id, vtype: "payment", cancelled: false, allocation: "" },
      _sum: { amount: true },
    });
    const paid = r3(Number(paidAgg._sum.amount || 0));
    const amount = Number(sc.amount);
    contracts.push({
      id: sc.id,
      amount,
      startDate: sc.startDate,
      endDate: sc.endDate,
      status: sc.status,
      description: sc.description,
      cancelReason: sc.cancelReason,
      cancelledAt: sc.cancelledAt,
      contract: {
        id: sc.contract.id,
        contractNumber: sc.contract.contractNumber,
        contractName: sc.contract.contractName,
        customerName: sc.contract.customer.name,
      },
      planTotal: r3(sc.planLines.reduce((s, p) => s + Number(p.amount), 0)),
      paid,
      remaining: r3(amount - paid),
    });
  }

  return ok({
    subcontractor: {
      id: sub.id,
      subCode: sub.subCode,
      name: sub.name,
      phone: sub.phone,
      email: sub.email,
      activity: sub.activity,
      notes: sub.notes,
      showAllContracts: sub.showAllContracts,
    },
    contracts,
    totals: {
      activeContracts: contracts.filter((c) => c.status !== "ملغى").length,
      activeAmount: r3(contracts.filter((c) => c.status !== "ملغى").reduce((s, c) => s + (c.amount as number), 0)),
      paid: r3(contracts.reduce((s, c) => s + (c.paid as number), 0)),
    },
  });
}

/** تعديل بيانات المقاول */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const sub = await db.subcontractor.findUnique({ where: { id } });
  if (!sub) return jsonError("المقاول غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.SubcontractorUpdateInput = {};
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم المقاول مطلوب");
    data.name = name;
  }
  if (body.phone !== undefined) data.phone = String(body.phone || "");
  if (body.email !== undefined) data.email = String(body.email || "");
  if (body.activity !== undefined) data.activity = String(body.activity || "");
  if (body.notes !== undefined) data.notes = String(body.notes || "");
  if (body.showAllContracts !== undefined) data.showAllContracts = Boolean(body.showAllContracts);

  await db.$transaction(async (tx) => {
    await tx.subcontractor.update({ where: { id }, data });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "subcontractor",
      entityId: id,
      entityName: `${sub.subCode} — ${data.name || sub.name}`,
    });
  });
  return ok({ updated: true });
}

/** حذف مقاول (للمدير) — ممنوع مع عقود باطن نشطة أو سندات صرف سارية */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const sub = await db.subcontractor.findUnique({ where: { id }, include: { subContracts: { select: { id: true, status: true } } } });
  if (!sub) return jsonError("المقاول غير موجود", 404);

  const activeContracts = sub.subContracts.filter((sc) => sc.status !== "ملغى");
  if (activeContracts.length > 0) return jsonError("لا يمكن حذف مقاول له عقود باطن نشطة");
  if (sub.subContracts.length > 0) {
    return jsonError("لا يمكن حذف مقاول له عقود باطن (حتى الملغاة — تُحذف عبر عقود الباطن أولًا)");
  }
  const activeVouchers = await db.voucher.count({
    where: { partyType: "subcontractor", partyId: id, vtype: "payment", cancelled: false },
  });
  if (activeVouchers > 0) return jsonError("لا يمكن حذف مقاول له سندات صرف سارية");

  await db.$transaction(async (tx) => {
    await tx.subcontractor.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "subcontractor",
      entityId: id,
      entityName: `${sub.subCode} — ${sub.name}`,
    });
  });
  return ok({ deleted: true });
}
