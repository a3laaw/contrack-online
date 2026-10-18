import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { intOr, loadContractCore, numOr } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

/** GET: تفاصيل فاتورة مع الأسماء والوضع المالي للعقد (القيمة الحالية/المفوتر/المتبقي) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);

  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true, status: true, customerId: true } },
    },
  });
  if (!inv) return jsonError("الفاتورة غير موجودة", 404);

  const core = await loadContractCore(inv.contractId);
  const invoicedAgg = await db.invoice.aggregate({ where: { contractId: inv.contractId }, _sum: { amount: true } });
  const invoiced = r3(Number(invoicedAgg._sum.amount || 0));
  const current = core ? core.current : 0;

  return ok({
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customer: inv.customer,
      contractId: inv.contractId,
      contract: inv.contract,
      invoiceDate: inv.invoiceDate,
      description: inv.description,
      amount: Number(inv.amount),
      notes: inv.notes,
      createdAt: inv.createdAt,
    },
    financials: {
      current: r3(current),
      invoiced,
      remaining: r3(current - invoiced),
    },
  });
}

/** PATCH: تعديل الوصف/الملاحظات/التاريخ، والمبلغ بفحص السقف مجددًا (باستثناء الفاتورة نفسها) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);

  const inv = await db.invoice.findUnique({ where: { id } });
  if (!inv) return jsonError("الفاتورة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { description?: string; notes?: string; amount?: number; invoiceDate?: string } = {};

  if (body.description !== undefined) data.description = String(body.description).trim();
  if (body.notes !== undefined) data.notes = String(body.notes).trim();
  if (body.invoiceDate !== undefined) {
    const d = parseDay(body.invoiceDate);
    if (!d) return jsonError("تاريخ الفاتورة غير صالح بصيغة YYYY-MM-DD");
    data.invoiceDate = d;
  }
  if (body.amount !== undefined) {
    const amount = r3(numOr(body.amount, 0));
    if (!(amount > 0)) return jsonError("مبلغ الفاتورة يجب أن يكون أكبر من صفر");
    const core = await loadContractCore(inv.contractId);
    const invoicedAgg = await db.invoice.aggregate({
      where: { contractId: inv.contractId, id: { not: id } },
      _sum: { amount: true },
    });
    const invoicedExcl = r3(Number(invoicedAgg._sum.amount || 0));
    const remaining = r3((core ? core.current : 0) - invoicedExcl);
    if (amount > remaining + EPS) {
      return jsonError(`الفاتورة تتجاوز المتبقي من العقد (${remaining} د.ك)`);
    }
    data.amount = amount;
  }

  if (!Object.keys(data).length) return jsonError("لا توجد حقول للتعديل");

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.invoice.update({ where: { id }, data });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "invoice",
      entityId: id,
      entityName: inv.invoiceNumber,
    });
    return row;
  });

  return ok({
    invoice: {
      id: updated.id,
      invoiceNumber: updated.invoiceNumber,
      invoiceDate: updated.invoiceDate,
      description: updated.description,
      amount: Number(updated.amount),
      notes: updated.notes,
    },
  });
}

/**
 * DELETE (مدير): حذف فعلي مع لقطة PurgeAudit — المصدر يمنع الحذف إلا من إدارة البيانات،
 * والرقم لا يُعاد للاستخدام (عدّاد INV لا يتراجع).
 */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);

  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      contract: { select: { contractNumber: true } },
    },
  });
  if (!inv) return jsonError("الفاتورة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason || req.nextUrl.searchParams.get("reason") || "").trim() || "حذف فاتورة من إدارة البيانات";

  const snapshot = {
    action: "invoice_delete",
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerName: inv.customer.name,
      contractId: inv.contractId,
      contractNumber: inv.contract.contractNumber,
      invoiceDate: inv.invoiceDate,
      description: inv.description,
      amount: Number(inv.amount),
      notes: inv.notes,
      createdAt: inv.createdAt,
    },
    deletedAt: todayStr(),
    deletedBy: guard.user.username,
  };

  await db.$transaction(async (tx) => {
    await tx.invoice.delete({ where: { id } });
    await tx.purgeAudit.create({
      data: {
        purgedBy: guard.user.username,
        entity: "invoice",
        entityId: id,
        label: inv.invoiceNumber,
        reason,
        snapshot: JSON.stringify(snapshot),
      },
    });
    await tx.contractEvent.create({
      data: {
        contractId: inv.contractId,
        eventType: "حذف فاتورة",
        description: `حذف الفاتورة ${inv.invoiceNumber} بمبلغ ${Number(inv.amount)} — السبب: ${reason}`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "invoice",
      entityId: id,
      entityName: inv.invoiceNumber,
      reason,
    });
  });

  return ok({ deleted: true, id, invoiceNumber: inv.invoiceNumber, reason });
}
