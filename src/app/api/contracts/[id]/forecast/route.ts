import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  deriveForecast,
  type ForecastExecutionInput,
  type ForecastInvoiceInput,
  type ForecastItemInput,
  type ForecastLineInput,
} from "@/lib/forecast-core";

type P = { params: Promise<{ id: string }> };

/**
 * م1 — المصالحة (docs/daily-report-forecast-design.md §9):
 * GET /api/contracts/[id]/forecast?asOf=YYYY-MM-DD
 *  • بلا asOf: الحائم — كل البيانات واليوم المرجعي يوم الخادم.
 *  • بـ asOf: الاسترجاع الزمني — الرسمي باعتماد ≤ التاريخ والميداني بتنفيذ ≤ التاريخ
 *    وبنية ظهور البنود من الملاحق المعتمدة (نفس بنية ز3).
 * كل شيء مشتق لحظيًا من الصفوف (G9 — لا عدادات تنبؤ مخزنة) — قراءة حصرًا لا تلمس
 * أي مسار كتابة، والمال يعبر حصرًا عبر اعتماد موقّع (آلة ز2) — «مقترحات لا أفعال».
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
  // اليوم المرجعي للمعدلات والتوقف: الحائم = يوم الخادم · التاريخي = التاريخ نفسه (§9.1)
  const today = asOf ?? new Date().toISOString().slice(0, 10);

  const [items, addendums, invoices, executions] = await Promise.all([
    // كل البنود بما فيها المحذوفة ناعمًا — البنية الزمنية تحتاج تاريخ الحذف (نمط ز3)
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
        deleted: true,
        deletedAddendumId: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    // الملاحق المعتمدة حصرًا هي مؤرخة البنية — الملغاة/المسودة لا أثر زمني لها
    db.addendum.findMany({
      where: { contractId, side: "client", status: "معتمد" },
      select: { id: true, addendumNumber: true, approvedDate: true },
    }),
    // غير الملغاة حصرًا — الملغاة مستبعدة من كل الاشتقاقات (§1)
    db.invoice.findMany({
      where: { contractId, status: { not: "void" } },
      select: { id: true, invoiceDate: true, state: true, status: true, approveAt: true },
    }),
    db.fieldExecution.findMany({
      where: { contractId },
      select: { boqItemId: true, executionDate: true, qty: true, documented: true },
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
      : Promise.resolve([]),
    invoiceIds.length
      ? db.invoiceItem.findMany({
          where: { invoiceId: { in: invoiceIds }, boqItemId: { not: null } },
          select: { invoiceId: true, boqItemId: true, quantity: true },
        })
      : Promise.resolve([] as ForecastLineInput[]),
  ]);

  const result = deriveForecast({
    asOf,
    today,
    items: items.map(
      (it): ForecastItemInput => ({
        id: it.id,
        itemNo: it.itemNo,
        divisionCode: it.divisionCode,
        divisionName: it.divisionName,
        description: it.description,
        qty: Number(it.qty),
        unit: it.unit,
        unitPrice: Number(it.unitPrice),
        deleted: it.deleted,
        deletedAddendumId: it.deletedAddendumId,
      })
    ),
    addendums,
    addendumItems,
    invoices: invoices.map(
      (inv): ForecastInvoiceInput => ({
        id: inv.id,
        invoiceDate: inv.invoiceDate,
        state: inv.state,
        status: inv.status,
        approveAt: inv.approveAt,
      })
    ),
    lines: lines.map(
      (l): ForecastLineInput => ({ invoiceId: l.invoiceId, boqItemId: l.boqItemId, quantity: Number(l.quantity) })
    ),
    executions: executions.map(
      (ex): ForecastExecutionInput => ({
        boqItemId: ex.boqItemId,
        executionDate: ex.executionDate,
        qty: Number(ex.qty),
        documented: ex.documented,
      })
    ),
  });

  return ok({ mode: asOf ? ("historical" as const) : ("live" as const), ...result });
}
