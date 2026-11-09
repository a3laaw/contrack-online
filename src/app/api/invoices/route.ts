import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, nextNumber, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { intOr, loadContractCore } from "@/lib/contrack-server";
import { buildInvoiceItems, postInvoiceIssueEntry } from "@/lib/invoice-server";

/**
 * الفواتير — Task 107 (استبدال كامل — منهج النواة الواحدة):
 *  • فاتورة ببنود (وصف/كمية/سعر/خصم%) وإجماليات Decimal(18,3) محصلة على الرأس محركًا.
 *  • الإصدار يولد قيدًا posted متوازنًا إلزاميًا عبر قاعدة invoice_issue
 *    (مدين ذمم العملاء / دائن إيراد العقود) داخل نفس المعاملة — لا فاتورة بلا قيد.
 *  • حالة السداد مصدرها سندات القبض عبر InvoicePaymentLink (تخصيص آلي عند تسجيل السند).
 *  • سقف الفوترة: صافي الفاتورة ≤ القيمة الحالية − مفوتر العقد (لغير الملغاة) عند الربط بعقد.
 */

/** GET: فواتير بفلاتر q/status/customerId/contractId/from/to مع الأسماء ورقم القيد المرتبط */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const customerId = intOr(sp.get("customerId"), 0);
  const contractId = intOr(sp.get("contractId"), 0);
  const statusFilter = (sp.get("status") || "all").trim();
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));

  const where: Prisma.InvoiceWhereInput = {};
  if (customerId) where.customerId = customerId;
  if (contractId) where.contractId = contractId;
  if (from || to) {
    where.invoiceDate = {};
    if (from) where.invoiceDate.gte = from;
    if (to) where.invoiceDate.lte = to;
  }
  if (statusFilter === "legacy") where.legacy = true;
  else if (["unpaid", "partial", "paid", "void"].includes(statusFilter)) where.status = statusFilter;

  const rows = await db.invoice.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true, status: true } },
      entry: { select: { id: true, entryNo: true, status: true } },
    },
    orderBy: [{ invoiceDate: "desc" }, { invoiceNo: "desc" }],
    take: 2000,
  });

  const nq = q.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  const invoices = rows
    .filter((r) => {
      if (!nq) return true;
      const hay = `${r.invoiceNumber} ${r.description} ${r.notes} ${r.customer.name} ${r.contract?.contractNumber ?? ""}`
        .toLowerCase()
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي");
      return hay.includes(nq);
    })
    .map((r) => {
      const total = Number(r.total);
      const paid = Number(r.paidAmount);
      return {
        id: r.id,
        invoiceNo: r.invoiceNo,
        invoiceNumber: r.invoiceNumber,
        customerId: r.customerId,
        customerName: r.customer.name,
        contractId: r.contractId,
        contractNumber: r.contract?.contractNumber ?? null,
        contractName: r.contract?.contractName ?? null,
        invoiceDate: r.invoiceDate,
        dueDate: r.dueDate,
        description: r.description,
        subtotal: r3(Number(r.subtotal)),
        discountTotal: r3(Number(r.discountTotal)),
        total: r3(total),
        paidAmount: r3(paid),
        remaining: r3(r.status === "void" ? 0 : total - paid),
        status: r.status,
        legacy: r.legacy,
        entryId: r.entry?.id ?? null,
        entryNo: r.entry?.entryNo ?? null,
        notes: r.notes,
        createdAt: r.createdAt,
      };
    });

  return ok({ invoices });
}

/** POST: إصدار فاتورة — بنود + قيد إصدار آلي في نفس المعاملة + سقف الفوترة + حدث العقد */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const customerId = intOr(body.customerId, 0);
  const contractId = intOr(body.contractId, 0) || null;
  // جسر الإنجاز إلى الفوترة (docs/revisions-ipc-design.md §2.4) — ربط اختياري بدفعة خطة السداد
  const paymentId = intOr(body.paymentId, 0) || null;
  if (!customerId) return jsonError("العميل مطلوب");
  const invoiceDate = parseDay(body.invoiceDate);
  if (!invoiceDate) return jsonError("تاريخ الفاتورة مطلوب بصيغة YYYY-MM-DD");
  const dueDate = parseDay(body.dueDate) || "";
  const notes = String(body.notes || "").trim();
  const description = String(body.description || "").trim();

  const built = buildInvoiceItems(body.items);
  if (!built.ok) return jsonError(built.error);

  const [customer, contract] = await Promise.all([
    db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } }),
    contractId ? db.contract.findUnique({ where: { id: contractId }, select: { id: true, customerId: true, contractNumber: true, status: true } }) : Promise.resolve(null),
  ]);
  if (!customer) return jsonError("العميل غير موجود", 404);
  if (contractId && !contract) return jsonError("العقد غير موجود", 404);
  if (contract && contract.customerId !== customerId) {
    return jsonError("الفاتورة يجب أن تخص عميل العقد");
  }

  // جسر الإنجاز إلى الفوترة — تحقق الربط: الدفعة بنفس العقد + بلا فاتورة نشطة مرتبطة بها
  if (paymentId) {
    if (!contractId) return jsonError("الربط بدفعة الخطة يتطلب عقدًا");
    const pay = await db.paymentPlanItem.findUnique({ where: { id: paymentId }, select: { id: true, contractId: true, title: true } });
    if (!pay) return jsonError("دفعة الخطة غير موجودة", 404);
    if (pay.contractId !== contractId) return jsonError("دفعة الخطة لا تنتمي لهذا العقد");
    const linked = await db.invoice.findFirst({
      where: { paymentId, status: { not: "void" } },
      select: { invoiceNumber: true },
    });
    if (linked) return jsonError(`دفعة الخطة مرتبطة بفاتورة سارية (${linked.invoiceNumber})`);
  }

  // سقف الفوترة: المفوتر (لغير الملغاة) + هذه الفاتورة ≤ القيمة الحالية
  let core: Awaited<ReturnType<typeof loadContractCore>> | null = null;
  let invoicedBefore = 0;
  if (contractId) {
    core = await loadContractCore(contractId);
    if (!core) return jsonError("العقد غير موجود", 404);
    const invoicedAgg = await db.invoice.aggregate({
      where: { contractId, status: { not: "void" } },
      _sum: { total: true },
    });
    invoicedBefore = r3(Number(invoicedAgg._sum.total || 0));
    const remaining = r3(core.current - invoicedBefore);
    if (built.total > remaining + EPS) {
      return jsonError(`الفاتورة تتجاوز المتبقي من العقد (${remaining} د.ك)`);
    }
  }

  // مزامنة عدّاد INV مع أعلى invoiceNo قائمة (الفواتير المرحَّلة من أرشيف ما قبل
  // Task 107 حملت الأرقام نفسها والعدّاد قد يكون أدنى منها أو غير موجود أصلًا —
  // والتراجع داخل المعاملة الفاشلة كان يُعيد نفس الرقم في كل محاولة)
  const maxNoAgg = await db.invoice.aggregate({ _max: { invoiceNo: true } });
  const maxInvoiceNo = maxNoAgg._max.invoiceNo ?? 0;
  if (maxInvoiceNo > 0) {
    const seqRow = await db.numberSequence.findFirst({ where: { name: "voucher:INV" } });
    if (!seqRow) {
      await db.numberSequence.create({ data: { name: "voucher:INV", lastNo: maxInvoiceNo } });
    } else if (Number(seqRow.lastNo) < maxInvoiceNo) {
      await db.numberSequence.update({
        where: { companyId_name: { companyId: seqRow.companyId, name: "voucher:INV" } },
        data: { lastNo: maxInvoiceNo },
      });
    }
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await db.$transaction(
        async (tx) => {
          // INV-#### عدّاد لا يتراجع — invoiceNo التسلسلي من الرقم نفسه
          const invoiceNumber = await nextNumber("INV", 4, tx);
          const invoiceNo = intOr(invoiceNumber.replace(/^INV-/, ""), 0);
          const invoice = await tx.invoice.create({
            data: {
              invoiceNumber,
              invoiceNo,
              customerId,
              contractId,
              paymentId,
              invoiceDate,
              dueDate,
              description,
              subtotal: built.subtotal,
              discountTotal: built.discountTotal,
              total: built.total,
              notes,
            },
          });
          await tx.invoiceItem.createMany({
            data: built.items.map((it, i) => ({
              invoiceId: invoice.id,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              discountPct: it.discountPct,
              lineTotal: it.lineTotal,
              sortOrder: i,
            })),
          });

          // قيد الإصدار الآلي — فشله يتراجع عن الإصدار كله (لا فاتورة بلا قيد)
          const entry = await postInvoiceIssueEntry(
            tx,
            {
              id: invoice.id,
              invoiceNumber,
              invoiceDate,
              total: built.total,
              customerId,
              contractId,
            },
            customer.name,
            guard.user.username
          );

          if (contractId && contract) {
            await tx.contractEvent.create({
              data: {
                contractId,
                eventType: "إصدار فاتورة",
                description: `إصدار فاتورة ${invoiceNumber} بمبلغ ${built.total} (قيد #${entry.entryNo}) — العقد ${contract.contractNumber}`,
                username: guard.user.username,
              },
            });
          }
          await audit(tx, {
            username: guard.user.username,
            action: "إنشاء",
            entityType: "invoice",
            entityId: invoice.id,
            entityName: invoiceNumber,
          });
          return { invoice, entryNo: entry.entryNo };
        },
        { timeout: 30_000, maxWait: 10_000 }
      );
      return ok(
        {
          invoice: {
            id: created.invoice.id,
            invoiceNumber: created.invoice.invoiceNumber,
            customerId,
            customerName: customer.name,
            contractId,
            contractNumber: contract?.contractNumber ?? null,
            invoiceDate,
            total: built.total,
            entryNo: created.entryNo,
          },
          financials: core
            ? {
                current: core.current,
                invoiced: r3(invoicedBefore + built.total),
                remaining: r3(core.current - invoicedBefore - built.total),
              }
            : undefined,
        },
        201
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("مقفلة") || msg.includes("فاتورة غير صالحة") || msg.includes("بند")) {
        return jsonError(msg, 400); // أخطاء التحقق الدلالي (فترة مقفلة…) — لا إعادة محاولة
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        lastError = e; // تضارب رقم الفاتورة — أعِد المحاولة
        continue;
      }
      lastError = e;
      break;
    }
  }
  console.error("فشل إنشاء الفاتورة:", lastError);
  const msg = lastError instanceof Error ? lastError.message : "";
  if (msg.includes("مقفلة")) return jsonError(msg, 400);
  return jsonError("تعذر إنشاء الفاتورة، حاول مجددًا", 500);
}
