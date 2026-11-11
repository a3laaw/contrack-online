import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { intOr, loadContractCore } from "@/lib/contrack-server";
import { computeNetDue } from "@/lib/phase-a-core";
import {
  buildInvoiceItems,
  invoicedTotalForContract,
  repostInvoiceEntry,
  voidInvoiceTx,
  type InvoiceItemInputRow,
} from "@/lib/invoice-server";
import { voidPosLinkedTx } from "@/lib/sales-server";

type P = { params: Promise<{ id: string }> };

/** GET: تفاصيل الفاتورة — البنود + سندات السداد المرتبطة + القيد + الوضع المالي للعقد */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);

  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, customerCode: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true, status: true, customerId: true } },
      items: { orderBy: { sortOrder: "asc" } },
      paymentLinks: {
        include: { voucher: { select: { id: true, voucherNumber: true, vdate: true, cancelled: true, method: true } } },
        orderBy: { id: "asc" },
      },
      entry: { select: { id: true, entryNo: true, status: true, entryDate: true } },
    },
  });
  if (!inv) return jsonError("الفاتورة غير موجودة", 404);

  const core = inv.contractId ? await loadContractCore(inv.contractId) : null;
  const invoiced = inv.contractId ? await invoicedTotalForContract(db, inv.contractId) : 0;
  const current = core ? core.current : 0;

  return ok({
    invoice: {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerName: inv.customer.name,
      customerPhone: inv.customer.phone,
      customerCode: inv.customer.customerCode,
      contractId: inv.contractId,
      contractNumber: inv.contract?.contractNumber ?? null,
      contractName: inv.contract?.contractName ?? null,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      description: inv.description,
      subtotal: r3(Number(inv.subtotal)),
      discountTotal: r3(Number(inv.discountTotal)),
      total: r3(Number(inv.total)),
      paidAmount: r3(Number(inv.paidAmount)),
      remaining: r3(inv.status === "void" ? 0 : Number(inv.total) - Number(inv.paidAmount)),
      // المرحلة (أ) — المحتجزات والدفعة المقدمة
      retentionRate: r3(Number(inv.retentionRate)),
      retentionAmount: r3(Number(inv.retentionAmount)),
      retentionReleased: inv.retentionReleased,
      retentionReleasedAt: inv.retentionReleasedAt,
      retentionReleaseEntryId: inv.retentionReleaseEntryId,
      advanceRecovered: r3(Number(inv.advanceRecovered)),
      netDue: inv.status === "void" ? 0 : computeNetDue(Number(inv.total), Number(inv.retentionAmount), Number(inv.advanceRecovered)),
      status: inv.status,
      voidReason: inv.voidReason,
      legacy: inv.legacy,
      notes: inv.notes,
    },
    items: inv.items.map((it) => ({
      id: it.id,
      description: it.description,
      quantity: r3(Number(it.quantity)),
      unitPrice: r3(Number(it.unitPrice)),
      discountPct: Number(it.discountPct),
      lineTotal: r3(Number(it.lineTotal)),
    })),
    payments: inv.paymentLinks.map((l) => ({
      id: l.id,
      voucherId: l.voucher.id,
      voucherNumber: l.voucher.voucherNumber,
      vdate: l.voucher.vdate,
      method: l.voucher.method,
      amount: r3(Number(l.amount)),
      cancelled: l.voucher.cancelled,
    })),
    entry: inv.entry
      ? { id: inv.entry.id, entryNo: inv.entry.entryNo, status: inv.entry.status, entryDate: inv.entry.entryDate }
      : null,
    financials: inv.contractId
      ? { current: r3(current), invoiced: r3(invoiced), remaining: r3(current - invoiced) }
      : null,
  });
}

/** PATCH: تعديل الفاتورة (بنود/تواريخ/عقد — بعكس وإعادة نشر القيد عند تغيّر الصافي أو التاريخ) أو الإلغاء بقيد عكسي */
export async function PATCH(req: NextRequest, { params }: P) {
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);

  // ===== الإلغاء (مدير) — بقيد عكسي مرتبط، لا حذف للفاتورة الصادرة قيدًا =====
  const action = (req.nextUrl.searchParams.get("action") || "").trim();
  if (action === "void") {
    const guard = await adminGuard(req);
    if ("response" in guard) return guard.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = String(body.reason || "").trim();
    if (!reason) return jsonError("سبب الإلغاء مطلوب");

    try {
      const result = await db.$transaction(
        async (tx) => {
          const inv = await tx.invoice.findUnique({
            where: { id },
            include: { customer: { select: { name: true } }, contract: { select: { id: true, contractNumber: true } } },
          });
          if (!inv) throw new Error("الفاتورة غير موجودة");
          // المبيعات (docs/sales-design.md د8): الإلغاء الشامل — إذن الصرف الآلي أولًا ثم
          // سندات القبض المرتبطة بعكسها، ثم عكس الإصدار في voidInvoiceTx (الفاتورة العادية
          // بلا saleDocs ولا سندات تمر كما كان حرفيًا — لا فحص إضافي).
          const posUndo = await voidPosLinkedTx(tx, id, reason, guard.user.username);
          const res = await voidInvoiceTx(tx, id, reason, guard.user.username);
          if (inv.contractId) {
            await tx.contractEvent.create({
              data: {
                contractId: inv.contractId,
                eventType: "إلغاء فاتورة",
                description: `إلغاء الفاتورة ${res.invoiceNumber} بمبلغ ${Number(inv.total)} — السبب: ${reason}`,
                username: guard.user.username,
              },
            });
          }
          await audit(tx, {
            username: guard.user.username,
            action: "إلغاء",
            entityType: "invoice",
            entityId: id,
            entityName: res.invoiceNumber,
            reason,
          });
          return { invoiceNumber: res.invoiceNumber, reversedEntryId: res.reversedEntryId, posUndo };
        },
        { timeout: 30_000, maxWait: 10_000 }
      );
      return ok({ voided: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("غير موجودة") || msg.includes("ملغاة") || msg.includes("مسددة")) return jsonError(msg, 400);
      console.error("فشل إلغاء الفاتورة:", e);
      return jsonError("تعذر إلغاء الفاتورة، حاول مجددًا", 500);
    }
  }

  // ===== التعديل =====
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;

  const inv = await db.invoice.findUnique({
    where: { id },
    include: { items: true, customer: { select: { name: true } } },
  });
  if (!inv) return jsonError("الفاتورة غير موجودة", 404);
  if (inv.status === "void") return jsonError("لا يمكن تعديل فاتورة ملغاة");
  if (inv.legacy) {
    return jsonError("الفاتورة الترحيلية أرشيفية (ما قبل النواة المزدوجة) — لا تُعدَّل مبالغها أو تواريخها، يمكن إلغاؤها فقط");
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: {
    invoiceDate?: string;
    dueDate?: string;
    description?: string;
    notes?: string;
    contractId?: number | null;
    subtotal?: number;
    discountTotal?: number;
    total?: number;
  } = {};

  let newItems: InvoiceItemInputRow[] = [];
  let itemsProvided = false;

  if (body.invoiceDate !== undefined) {
    const d = parseDay(body.invoiceDate);
    if (!d) return jsonError("تاريخ الفاتورة غير صالح بصيغة YYYY-MM-DD");
    data.invoiceDate = d;
  }
  if (body.dueDate !== undefined) {
    data.dueDate = parseDay(body.dueDate) || "";
  }
  if (body.description !== undefined) data.description = String(body.description).trim();
  if (body.notes !== undefined) data.notes = String(body.notes).trim();
  if (body.contractId !== undefined) {
    const cid = intOr(body.contractId, 0) || null;
    if (cid) {
      const contract = await db.contract.findUnique({
        where: { id: cid },
        select: { id: true, customerId: true, contractNumber: true },
      });
      if (!contract) return jsonError("العقد غير موجود", 404);
      if (contract.customerId !== inv.customerId) return jsonError("الفاتورة يجب أن تخص عميل العقد");
    }
    data.contractId = cid;
  }
  if (body.items !== undefined) {
    const built = buildInvoiceItems(body.items);
    if (!built.ok) return jsonError(built.error);
    newItems = built.items;
    itemsProvided = true;
    data.subtotal = built.subtotal;
    data.discountTotal = built.discountTotal;
    data.total = built.total;
  }

  if (!Object.keys(data).length) return jsonError("لا توجد حقول للتعديل");

  // سقف الفوترة عند تغيّر الصافي أو العقد
  const newTotal = itemsProvided ? data.total! : r3(Number(inv.total));
  const effContractId = data.contractId !== undefined ? data.contractId : inv.contractId;
  if (effContractId && (itemsProvided || data.contractId !== undefined)) {
    const core = await loadContractCore(effContractId);
    if (!core) return jsonError("العقد غير موجود", 404);
    const invoicedExcl = await db.invoice.aggregate({
      where: { contractId: effContractId, status: { not: "void" }, id: { not: id } },
      _sum: { total: true },
    });
    const remaining = r3(core.current - r3(Number(invoicedExcl._sum.total || 0)));
    if (newTotal > remaining + EPS) {
      return jsonError(`الفاتورة تتجاوز المتبقي من العقد (${remaining} د.ك)`);
    }
  }
  // لا تقليص أقل من المسدد
  const paid = r3(Number(inv.paidAmount));
  if (paid > EPS && newTotal < paid - EPS) {
    return jsonError(`الصافي الجديد (${newTotal}) أقل من المسدد (${paid}) — راجع سندات السداد أولًا`);
  }
  // المرحلة (أ) — المحتجز لقطة لا تُمس: الصافي الجديد يجب أن يبقى فوقه
  const effRetention = r3(Number(inv.retentionAmount));
  if (effRetention > EPS && newTotal < effRetention + EPS) {
    return jsonError(`الصافي الجديد (${newTotal}) أقل من المحتجزات الثابتة (${effRetention}) — ألغِ الفاتورة وأعد إصدارها`);
  }

  const entryDateChanged = data.invoiceDate !== undefined && data.invoiceDate !== inv.invoiceDate;
  const totalChanged = itemsProvided && r3(newTotal) !== r3(Number(inv.total));

  try {
    const updated = await db.$transaction(
      async (tx) => {
        if (itemsProvided) {
          await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
          await tx.invoiceItem.createMany({
            data: newItems.map((it, i) => ({
              invoiceId: id,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              discountPct: it.discountPct,
              lineTotal: it.lineTotal,
              sortOrder: i,
            })),
          });
        }
        const row = await tx.invoice.update({ where: { id }, data });

        // تغيّر الصافي أو تاريخ الإصدار ⇒ عكس القيد وإعادة نشره بقيم الفاتورة الحالية
        if (totalChanged || entryDateChanged) {
          await repostInvoiceEntry(
            tx,
            {
              id,
              invoiceNumber: row.invoiceNumber,
              invoiceDate: row.invoiceDate,
              total: r3(Number(row.total)),
              customerId: row.customerId,
              contractId: row.contractId,
              entryId: row.entryId,
              retentionAmount: r3(Number(row.retentionAmount)),
            },
            inv.customer.name,
            totalChanged ? "تعديل فاتورة (تغيّر الصافي)" : "تعديل فاتورة (تغيّر تاريخ الإصدار)",
            guard.user.username
          );
        }

        if (effContractId) {
          await tx.contractEvent.create({
            data: {
              contractId: effContractId,
              eventType: "تعديل فاتورة",
              description: `تعديل الفاتورة ${row.invoiceNumber} — الصافي ${r3(Number(row.total))}`,
              username: guard.user.username,
            },
          });
        }
        await audit(tx, {
          username: guard.user.username,
          action: "تعديل",
          entityType: "invoice",
          entityId: id,
          entityName: row.invoiceNumber,
        });
        return row;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );

    return ok({
      invoice: {
        id: updated.id,
        invoiceNumber: updated.invoiceNumber,
        invoiceDate: updated.invoiceDate,
        total: r3(Number(updated.total)),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("مقفلة")) return jsonError(msg, 400);
    console.error("فشل تعديل الفاتورة:", e);
    return jsonError("تعذر تعديل الفاتورة، حاول مجددًا", 500);
  }
}
