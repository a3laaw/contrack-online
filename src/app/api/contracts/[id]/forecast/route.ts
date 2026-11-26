import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  deriveCashForecast,
  deriveForecast,
  deriveLaborNeed,
  deriveMaterialsDemand,
  deriveSubMatch,
  type CashInvoiceInput,
  type ForecastExecutionInput,
  type ForecastInvoiceInput,
  type ForecastItemInput,
  type ForecastLineInput,
  type LaborAllocInput,
  type MaterialsIssueLineInput,
  type SubMatchCertLineInput,
} from "@/lib/forecast-core";

type P = { params: Promise<{ id: string }> };

/**
 * م1 — المصالحة (docs/daily-report-forecast-design.md §9):
 * GET /api/contracts/[id]/forecast?asOf=YYYY-MM-DD
 *  • بلا asOf: الحائم — كل البيانات واليوم المرجعي يوم الخادم.
 *  • بـ asOf: الاسترجاع الزمني — الرسمي باعتماد ≤ التاريخ والميداني بتنفيذ ≤ التاريخ
 *    وبنية ظهور البنود من الملاحق المعتمدة (نفس بنية ز3).
 * م2 §10 — المسودة المقترحة + مطابقة الباطن (subMatch/draftInvoice).
 * م3 §11 — التشغيل الكامل: materials (الطلب على المواد من سجل الصرف الفعلي:
 * StockDocLine.boqItemId القائم — الصرف مشرح والمرتجع entry بـentrySource=return
 * يُخصم) + labor (أفق الأطقم من أقصى إتمام متوقع × تكلفة توزيعات المسيرات
 * المعتمدة/المدفوعة) + cash (صيغة المالك: المستخلص المتوقع − محتجزات − استرداد
 * دفعة، والأرصدة الثلاثة من المعتمد حصرًا) + assignedCrew (سياق عرض حصرًا).
 * كل شيء مشتق لحظيًا من الصفوف (G9 — لا عدادات تنبؤ مخزنة ولا خرائط مخزنة) —
 * قراءة حصرًا لا تلمس أي مسار كتابة، والمال يعبر حصرًا عبر اعتماد موقّع (آلة ز2)
 * — «مقترحات لا أفعال».
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({
    where: { id: contractId },
    // م2 §10.2 — بيانات العقد لزر التحويل (عميل العقد حصرًا في إنشاء المسودة)
    // م3 §11.2 — حقلا الدفعة المقدمة ونسبة استردادها (المرحلة أ القائمة)
    select: {
      id: true,
      contractNumber: true,
      customerId: true,
      customer: { select: { name: true } },
      advanceAmount: true,
      advanceRecoveryPct: true,
    },
  });
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
    // م3 §11.2 — حقول الاحتجاز والاسترداد والسداد للنقد المتوقع
    db.invoice.findMany({
      where: { contractId, status: { not: "void" } },
      select: {
        id: true,
        invoiceDate: true,
        state: true,
        status: true,
        approveAt: true,
        retentionRate: true,
        retentionAmount: true,
        retentionReleased: true,
        retentionReleasedAt: true,
        total: true,
        paidAmount: true,
        advanceRecovered: true,
      },
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

  // م2 §10.2 — مطابقة الباطن بالميدان: بنود العقد الموكلة للباطن عبر SubContractItem.boqItemId
  // (القائم منذ مرحلة أ الباطن) وأسطر شهاداتها — والاشتقاق في النواة (المستهلك معتمد|مدفوع حصرًا)
  const subItems = await db.subContractItem.findMany({
    where: { subContract: { contractId }, boqItemId: { not: null } },
    select: { id: true, boqItemId: true },
  });
  const subItemIds = subItems.map((s) => s.id);
  const certLines: SubMatchCertLineInput[] = subItemIds.length
    ? (
        await db.subCertificateLine.findMany({
          where: { subItemId: { in: subItemIds } },
          select: {
            subItemId: true,
            qty: true,
            amount: true,
            certificate: { select: { certDate: true, status: true } },
          },
        })
      ).map((cl) => ({
        certDate: cl.certificate.certDate,
        status: cl.certificate.status,
        boqItemId: subItems.find((s) => s.id === cl.subItemId)?.boqItemId ?? null,
        qty: Number(cl.qty),
        amount: Number(cl.amount),
      }))
    : [];
  const subMatch = deriveSubMatch({
    rows: result.rows,
    subLinkedItemIds: subItems.map((s) => s.boqItemId as number),
    certLines,
    asOf,
  });

  // م2 §10.2 — المسودة القائمة للعقد (وضع حاضر — لا دلالة تاريخية): تحويل ثانٍ مرفوض
  // لأن المسودات لا تستهلك الفجوة (ز2) فكان سيقترح الفجوات نفسها مرتين
  const draftInvoice = asOf
    ? null
    : await db.invoice.findFirst({
        where: { contractId, state: "مسودة", status: { not: "void" } },
        select: { id: true, invoiceNumber: true, total: true },
        orderBy: { id: "desc" },
      });

  // م3 §11.2 — مواد: إذون الصرف (kind=issue) والمرتجع (entry بـentrySource=return)
  // المنشورة للعقد بأسطرها المرتبطة بالبنود والأصناف — القيد بعقد واحد موثق (د7 G8)
  const stockDocs = await db.stockDoc.findMany({
    where: {
      contractId,
      status: "posted",
      OR: [{ kind: "issue" }, { kind: "entry", entrySource: "return" }],
    },
    select: {
      vdate: true,
      kind: true,
      entrySource: true,
      lines: {
        where: { boqItemId: { not: null } },
        select: {
          boqItemId: true,
          itemId: true,
          qty: true,
          amount: true,
          item: { select: { id: true, name: true, unit: true } },
        },
      },
    },
  });
  const issueLines: MaterialsIssueLineInput[] = stockDocs.flatMap((doc) =>
    doc.lines.map((l) => ({
      docDate: doc.vdate,
      kind: doc.kind,
      entrySource: doc.entrySource,
      boqItemId: l.boqItemId,
      itemId: l.item.id,
      itemName: l.item.name,
      itemUnit: l.item.unit,
      qty: Number(l.qty),
      amount: Number(l.amount),
    }))
  );
  const materials = deriveMaterialsDemand({ rows: result.rows, issueLines, asOf });

  // م3 §11.2 — عمالة: توزيعات LaborAllocation عبر مسيراتها المعتمدة/المدفوعة حصرًا
  // (النواة تحصر أيضًا — المرآة هنا للحفظ غير الضروري)
  const laborAllocRows = await db.laborAllocation.findMany({
    where: { contractId, batch: { status: { in: ["approved", "paid"] } } },
    select: {
      amount: true,
      batch: { select: { month: true, status: true } },
      employee: { select: { id: true, name: true } },
    },
  });
  const allocations: LaborAllocInput[] = laborAllocRows.map((a) => ({
    month: a.batch.month,
    batchStatus: a.batch.status,
    employeeId: a.employee.id,
    employeeName: a.employee.name,
    amount: Number(a.amount),
  }));
  const labor = deriveLaborNeed({ today, rows: result.rows, allocations, asOf });

  // م3 §11.2 — النقد: نفس الفواتير المجلوبة بمدخلات النواة (الاعتماد المفكوك قرار ز3)
  const cashInvoices: CashInvoiceInput[] = invoices.map((inv) => ({
    id: inv.id,
    approveDate: (inv.approveAt || "").slice(0, 10) || inv.invoiceDate,
    state: inv.state,
    retentionRate: Number(inv.retentionRate),
    retentionAmount: Number(inv.retentionAmount),
    retentionReleased: inv.retentionReleased,
    retentionReleasedAt: inv.retentionReleasedAt,
    total: Number(inv.total),
    paidAmount: Number(inv.paidAmount),
    advanceRecovered: Number(inv.advanceRecovered),
  }));
  const cash = deriveCashForecast({
    grossExpected: result.totals.expectedNextIpc,
    advanceAmount: Number(contract.advanceAmount),
    advanceRecoveryPct: Number(contract.advanceRecoveryPct),
    invoices: cashInvoices,
    asOf,
  });

  // م3 §11.2 — الأطقم السارية (سياق عرض حصرًا — لا توليد تكليفات)
  const crewRows = await db.employeeAssignment.findMany({
    where: { contractId, status: "سارية" },
    select: { role: true, allocationPct: true, employee: { select: { id: true, name: true } } },
    orderBy: { id: "asc" },
  });

  return ok({
    mode: asOf ? ("historical" as const) : ("live" as const),
    contract: {
      id: contract.id,
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      customerName: contract.customer.name,
    },
    ...result,
    subMatch,
    draftInvoice: draftInvoice
      ? { id: draftInvoice.id, invoiceNumber: draftInvoice.invoiceNumber, total: Number(draftInvoice.total) }
      : null,
    materials,
    labor,
    cash,
    assignedCrew: crewRows.map((c) => ({
      employeeId: c.employee.id,
      name: c.employee.name,
      role: c.role,
      allocationPct: Number(c.allocationPct),
    })),
  });
}
