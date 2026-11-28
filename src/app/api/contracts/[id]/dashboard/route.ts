import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { datePart10 } from "@/lib/boq-state-core";
import { getSettingsRow } from "@/lib/contrack-server";
import { parseEvmThresholds } from "@/lib/evm-core";
import { deriveForecast, type ForecastExecutionInput, type ForecastInvoiceInput, type ForecastItemInput, type ForecastLineInput } from "@/lib/forecast-core";
import { deriveEvm, type EvmInvoiceInput, type EvmLaborInput, type EvmMaterialInput, type EvmPlanInput, type EvmVoucherInput } from "@/lib/evm-core";
import { deriveItemWindowFromActivities } from "@/lib/schedule-activities-core";

type P = { params: Promise<{ id: string }> };

/**
 * ج2 — لوحة قيادة المشروع (docs/project-dashboard-design.md §8):
 * GET /api/contracts/[id]/dashboard?asOf=YYYY-MM-DD
 *  • قراءة حصرًا — EVM مشتق لحظيًا (G9) فوق مخرجات م1 حصرًا (rows/sCurve من
 *    deriveForecast) — صفر جداول جديدة وصفر أعمدة (بطاقة §8 قبل الكود).
 *  • AC بثلاثة مكوّنات: سندات صرف (العقد + شهادات الباطن عبر subContract —
 *    سند صرف الباطن بلا contractId فالاستبعاد كان سيفقد أكبر تكلفة §8.1) +
 *    رواتب HR-3 (دفعات معتمد|مدفوع بشهرها) + مواد صرف المخزن posted (قرار §7.2).
 *  • بلا asOf: الحائم — بـ asOf: كل المقارنات ≤ التاريخ (النوافذ المخططة
 *    الحالية بلا دلالة تاريخية §8.2.11).
 *  • التدريجية §6: بلا بنود ⇒ EVM أصفار/null والمال يشتغل حصرًا.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      customerId: true,
      startDate: true,
      endDate: true,
      customer: { select: { name: true } },
    },
  });
  if (!contract) return jsonError("العقد غير موجود", 404);

  // asOf اختياري — لا يقبله إلا بصيغة التاريخ الموحدة (نمط م1 حرفيًا)
  const asOfRaw = (req.nextUrl.searchParams.get("asOf") || "").trim();
  let asOf: string | null = null;
  if (asOfRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw)) return jsonError("تاريخ asOf غير صالح — الصيغة المطلوبة YYYY-MM-DD");
    asOf = asOfRaw;
  }
  const today = asOf ?? new Date().toISOString().slice(0, 10);

  const [items, addendums, invoices, executions, paymentVouchers, receiptVouchers, laborAllocations, materialLines] =
    await Promise.all([
      // كل البنود بما فيها المحذوفة ناعمًا — البنية الزمنية تحتاج تاريخ الحذف (نمط ز3/م1)
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
          // ج2 — نوافذ البنود (ب1/ج1): PV والمنحنى المخطط منهما (§8.2.2)
          plannedStart: true,
          plannedFinish: true,
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      // الملاحق المعتمدة حصرًا هي مؤرخة البنية — الملغاة/المسودة لا أثر زمني لها
      db.addendum.findMany({
        where: { contractId, side: "client", status: "معتمد" },
        select: { id: true, addendumNumber: true, approvedDate: true },
      }),
      // غير الملغاة حصرًا — الملغاة مستبعدة من كل الاشتقاقات (§1) — وحقول المال ج2
      db.invoice.findMany({
        where: { contractId, status: { not: "void" } },
        select: {
          id: true,
          invoiceDate: true,
          state: true,
          status: true,
          approveAt: true,
          total: true,
          retentionAmount: true,
          retentionReleased: true,
        },
      }),
      db.fieldExecution.findMany({
        where: { contractId },
        select: { boqItemId: true, executionDate: true, qty: true, documented: true },
      }),
      // سندات صرف غير ملغاة: على العقد مباشرة + شهادات الباطن عبر عقود الباطن (§8.1)
      db.voucher.findMany({
        where: { cancelled: false, vtype: "payment", OR: [{ contractId }, { subContract: { contractId } }] },
        select: { vdate: true, amount: true },
      }),
      // سندات قبض غير ملغاة على العقد — المُحصّل (§8.2.10)
      db.voucher.findMany({
        where: { contractId, cancelled: false, vtype: "receipt" },
        select: { vdate: true, amount: true },
      }),
      // رواتب العمالة المحملة HR-3 — دفعات معتمد|مدفوع حصرًا بشهرها (§8.1)
      db.laborAllocation.findMany({
        where: { contractId, batch: { status: { in: ["approved", "paid"] } } },
        select: { amount: true, batch: { select: { month: true, status: true } } },
      }),
      // أسطر أذون صرف المخزن posted على العقد (قرار §7.2 — المواد في AC)
      db.stockDocLine.findMany({
        where: { doc: { contractId, kind: "issue", status: "posted" }, amount: { gt: 0 } },
        select: { amount: true, doc: { select: { vdate: true } } },
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

  // م1 حرفيًا — الأرضية المشتركة (rows/sCurve) لمؤشرات ج2 (§8.2.3)
  const forecast = deriveForecast({
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
    lines: lines.map((l): ForecastLineInput => ({ invoiceId: l.invoiceId, boqItemId: l.boqItemId, quantity: Number(l.quantity) })),
    executions: executions.map(
      (ex): ForecastExecutionInput => ({
        boqItemId: ex.boqItemId,
        executionDate: ex.executionDate,
        qty: Number(ex.qty),
        documented: ex.documented,
      })
    ),
  });

  // ج2 — مدخلات النواة كلها أعمدة قائمة (§8.1)
  // ب3 §13.2 — البند المربوط بنشطاته المؤرخة ⇒ نافذته من الأنشطة لا التخزين
  // (الربط المباشر يجري EVM بدقة الأنشطة — غير المربوط بنافذته المخزنة ب1/ج1)
  const latestImport = await db.scheduleImport.findFirst({
    where: { contractId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const linkedActs = latestImport
    ? await db.scheduleActivity.findMany({
        where: { importId: latestImport.id, contractId, isSummary: false, kind: "work", boqItemId: { not: null } },
        select: { boqItemId: true, earlyStart: true, earlyFinish: true },
      })
    : [];
  const actsByItem = new Map<number, { kind: string; isSummary: boolean; earlyStart: string; earlyFinish: string }[]>();
  for (const a of linkedActs) {
    if (a.boqItemId == null) continue;
    const arr = actsByItem.get(a.boqItemId) || [];
    arr.push({ kind: "work", isSummary: false, earlyStart: a.earlyStart, earlyFinish: a.earlyFinish });
    actsByItem.set(a.boqItemId, arr);
  }
  const plans: EvmPlanInput[] = items.map((it) => {
    const derived = deriveItemWindowFromActivities(actsByItem.get(it.id) || []);
    return derived
      ? { boqItemId: it.id, plannedStart: derived.start, plannedFinish: derived.finish }
      : { boqItemId: it.id, plannedStart: it.plannedStart, plannedFinish: it.plannedFinish };
  });
  const payments: EvmVoucherInput[] = paymentVouchers.map((v) => ({ vdate: v.vdate, amount: Number(v.amount) }));
  const receipts: EvmVoucherInput[] = receiptVouchers.map((v) => ({ vdate: v.vdate, amount: Number(v.amount) }));
  const labor: EvmLaborInput[] = laborAllocations.map((a) => ({
    amount: Number(a.amount),
    batchMonth: a.batch.month,
    batchStatus: a.batch.status,
  }));
  const materials: EvmMaterialInput[] = materialLines.map((l) => ({
    vdate: l.doc.vdate,
    amount: Number(l.amount),
    boqItemId: null,
  }));
  // المعتمد حصرًا (ز2: المسودة والمقدم لا يستهلكان) والاعتماد الفوري يُفك لتاريخ الفاتورة (قرار ز3)
  const approvedInvoices: EvmInvoiceInput[] = invoices
    .filter((inv) => inv.state === "معتمد")
    .map((inv): EvmInvoiceInput => ({
      total: Number(inv.total),
      retentionAmount: Number(inv.retentionAmount),
      retentionReleased: inv.retentionReleased,
      approveDate: datePart10(inv.approveAt) || datePart10(inv.invoiceDate),
    }));

  // ج3 §9.3 — العتبات من إعدادات الشركة المخزنة بتدقيق النواة النقية — بلا
  // سياق إعدادات أو بقيم فاسدة ⇒ الافتراضي (سقوط لا فشل — اللوحة لا تنكسر)
  let thresholds;
  try {
    const s = await getSettingsRow();
    thresholds = parseEvmThresholds({ spiMin: s.evmSpiMin, cpiMin: s.evmCpiMin, maxDelayDays: s.evmMaxDelayDays });
  } catch {
    thresholds = parseEvmThresholds();
  }

  const evm = deriveEvm({
    today,
    rows: forecast.rows,
    plans,
    paymentVouchers: payments,
    receiptVouchers: receipts,
    laborAllocations: labor,
    materialLines: materials,
    approvedInvoices,
    sCurve: forecast.sCurve,
    thresholds,
  });

  return ok({
    mode: asOf ? ("historical" as const) : ("live" as const),
    contract: {
      id: contract.id,
      contractNumber: contract.contractNumber,
      contractName: contract.contractName,
      customerId: contract.customerId,
      customerName: contract.customer.name,
      startDate: contract.startDate,
      endDate: contract.endDate,
    },
    ...forecast,
    evm,
    thresholds,
  });
}
