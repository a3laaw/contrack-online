import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, nextNumber, normalizeArabic, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { intOr, loadContractCore, numOr } from "@/lib/contrack-server";

/**
 * الفواتير INV-#### (عدّاد عالمي):
 * - يجب أن تخص عميلَ عقدِها، ولا تتجاوز المتبقي من العقد (القيمة الحالية − المفوتر سابقًا).
 * - الفاتورة مستند «للعلم» فقط — لا تخفض المديونية (كشف الحساب يعرضها محايدة).
 */

/** GET: فواتير بفلاتر q/customerId/contractId مع الأسماء */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const customerId = intOr(sp.get("customerId"), 0);
  const contractId = intOr(sp.get("contractId"), 0);

  const where: Prisma.InvoiceWhereInput = {};
  if (customerId) where.customerId = customerId;
  if (contractId) where.contractId = contractId;

  const rows = await db.invoice.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true, status: true } },
    },
    orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
    take: 2000,
  });

  const nq = normalizeArabic(q);
  const invoices = rows
    .filter((r) => {
      if (!nq) return true;
      const hay = normalizeArabic(`${r.invoiceNumber} ${r.description} ${r.notes} ${r.customer.name} ${r.contract.contractNumber}`);
      return hay.includes(nq);
    })
    .map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      customerId: r.customerId,
      customerName: r.customer.name,
      contractId: r.contractId,
      contractNumber: r.contract.contractNumber,
      contractName: r.contract.contractName,
      contractStatus: r.contract.status,
      invoiceDate: r.invoiceDate,
      description: r.description,
      amount: Number(r.amount),
      notes: r.notes,
      createdAt: r.createdAt,
    }));

  return ok({ invoices });
}

/** POST: إصدار فاتورة — تطابق العميل مع عميل العقد + منع تجاوز المتبقي + ContractEvent «إصدار فاتورة» */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const customerId = intOr(body.customerId, 0);
  const contractId = intOr(body.contractId, 0);
  if (!customerId) return jsonError("العميل مطلوب");
  if (!contractId) return jsonError("العقد مطلوب");
  const invoiceDate = parseDay(body.invoiceDate);
  if (!invoiceDate) return jsonError("تاريخ الفاتورة مطلوب بصيغة YYYY-MM-DD");
  const amount = r3(numOr(body.amount, 0));
  if (!(amount > 0)) return jsonError("مبلغ الفاتورة يجب أن يكون أكبر من صفر");

  const [customer, contract] = await Promise.all([
    db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } }),
    db.contract.findUnique({ where: { id: contractId }, select: { id: true, customerId: true, contractNumber: true } }),
  ]);
  if (!customer) return jsonError("العميل غير موجود", 404);
  if (!contract) return jsonError("العقد غير موجود", 404);
  if (contract.customerId !== customerId) {
    return jsonError("الفاتورة يجب أن تخص عميل العقد");
  }

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);
  const invoicedAgg = await db.invoice.aggregate({ where: { contractId }, _sum: { amount: true } });
  const invoiced = r3(Number(invoicedAgg._sum.amount || 0));
  const remaining = r3(core.current - invoiced);
  if (amount > remaining + EPS) {
    return jsonError(`الفاتورة تتجاوز المتبقي من العقد (${remaining} د.ك)`);
  }

  const description = String(body.description || "").trim();
  const notes = String(body.notes || "").trim();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        // INV-#### عدّاد عالمي (لا يعاد الرقم عند الحذف — العدّاد لا يتراجع)
        const invoiceNumber = await nextNumber("INV", 4, tx);
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            customerId,
            contractId,
            invoiceDate,
            description,
            amount,
            notes,
          },
        });
        await tx.contractEvent.create({
          data: {
            contractId,
            eventType: "إصدار فاتورة",
            description: `إصدار فاتورة ${invoiceNumber} بمبلغ ${amount} — العقد ${contract.contractNumber}`,
            username: guard.user.username,
          },
        });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء",
          entityType: "invoice",
          entityId: invoice.id,
          entityName: invoiceNumber,
        });
        return invoice;
      });
      return ok(
        {
          invoice: {
            id: created.id,
            invoiceNumber: created.invoiceNumber,
            customerId,
            customerName: customer.name,
            contractId,
            contractNumber: contract.contractNumber,
            invoiceDate: created.invoiceDate,
            description: created.description,
            amount: Number(created.amount),
            notes: created.notes,
          },
          financials: { current: core.current, invoiced: r3(invoiced + amount), remaining: r3(remaining - amount) },
        },
        201
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        lastError = e; // تضارب رقم الفاتورة — أعِد المحاولة
        continue;
      }
      lastError = e;
      break;
    }
  }
  console.error("فشل إنشاء الفاتورة:", lastError);
  return jsonError("تعذر إنشاء الفاتورة، حاول مجددًا", 500);
}
