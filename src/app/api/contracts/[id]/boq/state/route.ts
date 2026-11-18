import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  deriveBoqState,
  type BoqStateAddendumInput,
  type BoqStateAddendumItemInput,
  type BoqStateInvoiceInput,
  type BoqStateItemInput,
  type BoqStateLineInput,
} from "@/lib/boq-state-core";

type P = { params: Promise<{ id: string }> };

/**
 * ز3 — محرك الحالة الزمنية لـ BOQ (docs/boq-state-timeline-design.md §5):
 * GET /api/contracts/[id]/boq/state?asOf=YYYY-MM-DD
 *  • بلا asOf: الحالة الحالية (مطابق لعدادات GET /boq والفواتير — المعتمد سابق والمسودة/المقدم حالي)
 *  • بـ asOf: الاسترجاع الزمني — بنية البنود كما كانت (الملاحق المعتمدة) + سابق/حالي لكل بند
 *    + أدوار المستخلصات عند التاريخ بشارة «ساق» (من أغلقته اعتمادات أحدث).
 * كل شيء مشتق لحظيًا من الصفوف المؤرخة (G9 — لا عدادات مخزنة) — القراءة لا تلمس أي مسار كتابة.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  // asOf اختياري — لا يقبله إلا بصيغة التاريخ الموحدة
  const asOfRaw = (req.nextUrl.searchParams.get("asOf") || "").trim();
  let asOf: string | null = null;
  if (asOfRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw)) return jsonError("تاريخ asOf غير صالح — الصيغة المطلوبة YYYY-MM-DD");
    asOf = asOfRaw;
  }

  const [items, addendums, invoices] = await Promise.all([
    // كل البنود بما فيها المحذوفة ناعمًا — البنية الزمنية تحتاج تاريخ الحذف (deletedAddendumId)
    db.boqItem.findMany({
      where: { contractId },
      select: {
        id: true,
        itemNo: true,
        divisionCode: true,
        divisionName: true,
        description: true,
        qty: true,
        unit: true,
        unitPrice: true,
        amount: true,
        deleted: true,
        deletedAddendumId: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    // الملاحق المعتمدة حصرًا هي مؤرخة البنية (approvedDate) — الملغاة/المسودة لا أثر زمني لها
    db.addendum.findMany({
      where: { contractId, side: "client", status: "معتمد" },
      select: { id: true, addendumNumber: true, approvedDate: true },
    }),
    // غير الملغاة حصرًا — الملغاة مستبعدة من كل الاشتقاقات (§1)
    db.invoice.findMany({
      where: { contractId, status: { not: "void" } },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        state: true,
        status: true,
        submitAt: true,
        approveAt: true,
        total: true,
      },
    }),
  ]);

  const addendumIds = addendums.map((a) => a.id);
  const invoiceIds = invoices.map((i) => i.id);

  const [addendumItems, lines] = await Promise.all([
    addendumIds.length
      ? db.addendumItem.findMany({
          where: { addendumId: { in: addendumIds } },
          select: { addendumId: true, action: true, createdItemId: true, boqItemId: true, restoreDeletedBy: true },
        })
      : Promise.resolve([] as BoqStateAddendumItemInput[]),
    invoiceIds.length
      ? db.invoiceItem.findMany({
          where: { invoiceId: { in: invoiceIds }, boqItemId: { not: null } },
          select: { invoiceId: true, boqItemId: true, quantity: true },
        })
      : Promise.resolve([] as BoqStateLineInput[]),
  ]);

  const result = deriveBoqState({
    asOf,
    items: items.map(
      (it): BoqStateItemInput => ({
        id: it.id,
        itemNo: it.itemNo,
        divisionCode: it.divisionCode,
        divisionName: it.divisionName,
        description: it.description,
        qty: Number(it.qty),
        unit: it.unit,
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
        deleted: it.deleted,
        deletedAddendumId: it.deletedAddendumId,
      })
    ),
    addendums: addendums.map(
      (a): BoqStateAddendumInput => ({ id: a.id, addendumNumber: a.addendumNumber, approvedDate: a.approvedDate })
    ),
    addendumItems,
    invoices: invoices.map(
      (inv): BoqStateInvoiceInput => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        state: inv.state,
        status: inv.status,
        submitAt: inv.submitAt,
        approveAt: inv.approveAt,
        total: Number(inv.total),
      })
    ),
    lines: lines.map(
      (l): BoqStateLineInput => ({ invoiceId: l.invoiceId, boqItemId: l.boqItemId, quantity: Number(l.quantity) })
    ),
  });

  return ok({ mode: asOf ? ("historical" as const) : ("live" as const), ...result });
}
