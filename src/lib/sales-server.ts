// ============================================================
// ConTrack Online — موديول المبيعات: طبقة الخادم (docs/sales-design.md §5)
// صفر جداول جديدة — كل شيء عبر المحركات القائمة حصرًا:
//   الفاتورة (buildInvoiceItems + postInvoiceIssueEntry) · السند (prepareVoucher +
//   createVoucherTx بتخصيصه FIFO) · المخازن (postStockDocJournal بفرع تكلفة المبيعات 5116)
// المعاملة الواحدة الكبرى: فاتورة + سند قبض آلي + إذن صرف مخزني آلي + audit
// — وبذران مؤجلان بنمط ensureOne (العميل النقدي د6 · حساب 5116 د4).
// ============================================================

import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, nextNumber, todayStr } from "@/lib/api-utils";
import { intOr, nextNumberByKey } from "@/lib/contrack-server";
import { TX_OPTS, reverseJournalEntry, type Tx } from "@/lib/journal-server";
import { buildInvoiceItems, postInvoiceIssueEntry } from "@/lib/invoice-server";
import { cancelVoucherTx, createVoucherTx, prepareVoucher, VoucherError } from "@/lib/voucher-server";
import { loadBalances, loadStockMovements, postStockDocJournal } from "@/lib/warehouses-server";
import { DOC_PREFIXES } from "@/lib/warehouses-constants";
import { validateAvailability, type MovementInput } from "@/lib/warehouses-core";
import {
  CASH_CUSTOMER_NAME,
  CASH_CUSTOMER_NOTE,
  POS_INVOICE_DESCRIPTION,
  QUOTE_CONVERT_MARKER,
  SALES_ACCOUNTS,
  r3,
} from "@/lib/sales-constants";
import {
  cleanPosLines,
  mapQuotationToInvoiceItems,
  quoteConvertible,
  quoteInvoiceTotal,
  underCostLines,
  validatePosSale,
  type UnderCostRow,
} from "@/lib/sales-core";

type Client = Tx | PrismaClient;

type PreparedVoucher = Awaited<ReturnType<typeof prepareVoucher>>;

/** خطأ المبيعات برمز حالة — تترجمه المسارات إلى jsonError */
export class SalesError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ==================== البذران المؤجلان (نمط ensureOne — د4/د6) ====================

async function accountByCode(client: Client, code: string, type: string) {
  return client.account.findFirst({ where: { code, type }, select: { id: true, code: true, name: true } });
}

/**
 * ضمان حساب «5116 تكلفة المبيعات» في دليل الشركة — بذر مؤجل عند أول بيع (د4):
 * شقيق 5110 «مواد وأدوات» بنفس الأب وبنفس بنية الشجرة — نمط ensureWarehouseAccounts حرفيًا.
 */
export async function ensureSalesAccounts(client: Client): Promise<{ salesCost: { id: number; name: string } }> {
  const existing = await accountByCode(client, SALES_ACCOUNTS.salesCost.code, SALES_ACCOUNTS.salesCost.type);
  if (existing) return { salesCost: { id: existing.id, name: existing.name } };
  const def = SALES_ACCOUNTS.salesCost;
  const sibling = await client.account.findFirst({ where: { code: "5110", type: def.type }, select: { parentId: true } });
  if (!sibling) {
    throw new SalesError(`حساب «${def.name}» (${def.code}) مطلوب وغير موجود في الدليل — بذِر الدليل القياسي أولًا`);
  }
  const created = await client.account.create({
    data: {
      code: def.code,
      name: def.name,
      type: def.type,
      nature: "debit",
      parentId: sibling.parentId,
      isLeaf: true,
      allowPosting: true,
      isActive: true,
      isSystem: true,
      notes: "المبيعات — بذر مؤجل عند أول بيع (docs/sales-design.md §5 — د4)",
      xbrlElement: def.xbrl,
    },
  });
  return { salesCost: { id: created.id, name: created.name } };
}

/** العميل النقدي المبذور — تمييزه بعلامة الملاحظات الثابتة لا بالاسم حصرًا (د6) */
async function findCashCustomer(client: Client): Promise<{ id: number; name: string; notes: string } | null> {
  const rows = await client.customer.findMany({
    where: { name: CASH_CUSTOMER_NAME },
    select: { id: true, name: true, notes: true },
    take: 5,
  });
  return rows.find((r) => r.notes.includes(CASH_CUSTOMER_NOTE)) ?? null;
}

/**
 * ضمان العميل النقدي «عميل نقدي — نقاط البيع» برمز آلي من التسلسل القائم —
 * بذر مؤجل عند أول بيع بلا عميل مسمّى (د6). لا يُمس customerId الإلزامي في الفواتير.
 */
export async function ensureCashCustomer(client: Client): Promise<{ id: number; name: string }> {
  const found = await findCashCustomer(client);
  if (found) return { id: found.id, name: found.name };
  const customerCode = await nextNumberByKey("customer:code", "C", 4, client);
  const created = await client.customer.create({
    data: {
      customerCode,
      name: CASH_CUSTOMER_NAME,
      notes: CASH_CUSTOMER_NOTE,
    },
  });
  return { id: created.id, name: created.name };
}

// ==================== كتالوج نقاط البيع (GET) ====================

export interface PosCatalogItem {
  id: number;
  name: string;
  unit: string;
  category: string;
  qty: number; // الرصيد الاشتقاقي بالمستودع المحدد
  wac: number; // المتوسط المرجحي — للعرض مع تحذير البيع تحت التكلفة (د9)
}

/**
 * كتالوج النقطة: المستودعات النشطة + الأصناف النشطة بكمية ومتوسط لمستودع البيع —
 * والعميل النقدي المبذور إن وجد (للتمهيد في الواجهة). الأرصدة اشتقاقية من الخادم حصرًا (درس G9).
 */
export async function loadPosCatalog(warehouseId?: number): Promise<{
  warehouses: { id: number; name: string; location: string }[];
  defaultWarehouseId: number;
  items: PosCatalogItem[];
  cashCustomerId: number | null;
  cashCustomerName: string;
}> {
  const warehouses = await db.warehouse.findMany({
    where: { active: true },
    orderBy: { id: "asc" },
    select: { id: true, name: true, location: true },
  });
  const targetId = warehouseId && warehouses.some((w) => w.id === warehouseId) ? warehouseId : (warehouses[0]?.id ?? 0);
  const [{ balances }, items, cash] = await Promise.all([
    loadBalances(),
    db.stockItem.findMany({
      where: { active: true },
      orderBy: { id: "asc" },
      select: { id: true, name: true, unit: true, category: true },
    }),
    findCashCustomer(db),
  ]);
  const whBalances = balances.filter((b) => b.warehouseId === targetId);
  return {
    warehouses,
    defaultWarehouseId: targetId,
    items: items.map((it) => {
      const b = whBalances.find((x) => x.itemId === it.id);
      return {
        id: it.id,
        name: it.name,
        unit: it.unit,
        category: it.category,
        qty: b ? r3(b.qty) : 0,
        wac: b && b.qty > 0 ? b.wac : 0,
      };
    }),
    cashCustomerId: cash?.id ?? null,
    cashCustomerName: cash?.name ?? "",
  };
}

// ==================== مبيعات اليوم (للعرض حصرًا — §5) ====================

/** فواتير اليوم المولدة من النقطة: فواتير العميل النقدي + فواتير بأسطر صرف مخزني مرتبط */
export async function loadPosSalesOfDay(date: string): Promise<{
  count: number;
  total: number;
  invoices: {
    id: number;
    invoiceNumber: string;
    customerName: string;
    total: number;
    paidAmount: number;
    status: string;
    saleDocNumbers: string[];
  }[];
}> {
  const cash = await findCashCustomer(db);
  const where: Prisma.InvoiceWhereInput = {
    invoiceDate: date,
    OR: [...(cash ? [{ customerId: cash.id }] : []), { saleDocs: { some: {} } }],
  };
  const rows = await db.invoice.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      saleDocs: { where: { kind: "issue" }, select: { docNumber: true } },
    },
    orderBy: { invoiceNo: "desc" },
    take: 100,
  });
  const invoices = rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    customerName: r.customer.name,
    total: r3(Number(r.total)),
    paidAmount: r3(Number(r.paidAmount)),
    status: r.status,
    saleDocNumbers: r.saleDocs.map((d) => d.docNumber),
  }));
  return {
    count: invoices.length,
    total: r3(invoices.reduce((s, i) => s + (i.status === "void" ? 0 : i.total), 0)),
    invoices,
  };
}

// ==================== إذن الصرف المخزني الآلي للبيع (د4) ====================

/**
 * إنشاء إذن صرف بيع آلي داخل المعاملة: بلا عقد ومرتبط بالفاتورة (saleInvoiceId)،
 * لقطة التكلفة من المتوسط المرجحي الخادمي حصرًا، والقيد مدين 5116/دائن 1160 عبر
 * postStockDocJournal بفرع البيع — نفس بنية أذون المخازن حرفيًا.
 */
async function createSaleIssueDocTx(
  tx: Tx,
  p: {
    invoiceId: number;
    invoiceNumber: string;
    vdate: string;
    warehouseId: number;
    customerName: string;
    stockLines: { itemId: number; qty: number; snapUnitCost: number }[];
    saleCostAccountId: number;
    actor: string;
  }
): Promise<string> {
  const docNumber = await nextNumber(DOC_PREFIXES.issue, 4, tx);
  const lines = p.stockLines.map((l) => ({
    itemId: l.itemId,
    boqItemId: null,
    qty: l.qty,
    snapUnitCost: l.snapUnitCost,
    amount: r3(l.qty * l.snapUnitCost),
  }));
  const totalAmount = r3(lines.reduce((s, l) => s + l.amount, 0));
  const doc = await tx.stockDoc.create({
    data: {
      docNumber,
      kind: "issue",
      entrySource: "",
      vdate: p.vdate,
      warehouseId: p.warehouseId,
      contractId: null,
      saleInvoiceId: p.invoiceId,
      party: p.customerName,
      totalAmount,
      status: "posted",
      notes: `صرف بيع آلي — فاتورة ${p.invoiceNumber}`,
      createdBy: p.actor,
    },
  });
  await tx.stockDocLine.createMany({
    data: lines.map((l) => ({
      docId: doc.id,
      itemId: l.itemId,
      boqItemId: null,
      qty: l.qty,
      countedQty: 0,
      snapUnitCost: l.snapUnitCost,
      amount: l.amount,
      note: "",
    })),
  });
  const journal = await postStockDocJournal(
    tx,
    {
      docNumber,
      kind: "issue",
      entrySource: "",
      vdate: p.vdate,
      warehouseId: p.warehouseId,
      contractId: null,
      saleInvoiceId: p.invoiceId,
      saleInvoiceNumber: p.invoiceNumber,
      saleCostAccountId: p.saleCostAccountId,
      party: p.customerName,
      payAccountId: null,
      payAccountName: "",
      totalAmount,
    },
    lines,
    p.actor
  );
  if (journal.journalEntryId) {
    await tx.stockDoc.update({ where: { id: doc.id }, data: { journalEntryId: journal.journalEntryId } });
  }
  await audit(tx, {
    username: p.actor,
    action: "إنشاء",
    entityType: "stock_doc",
    entityId: doc.id,
    entityName: `${docNumber} (صرف بيع آلي ${p.invoiceNumber})`,
    newStatus: "posted",
  });
  return docNumber;
}

// ==================== مزامنة عدّاد INV (مرآة مسار الفواتير — العدّاد لا يتراجع) ====================

async function syncInvoiceCounter(): Promise<void> {
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
}

// ==================== المعاملة الواحدة الكبرى — «إتمام البيع» (د3) ====================

export interface PosSaleResult {
  invoiceId: number;
  invoiceNumber: string;
  total: number;
  entryNo: number;
  voucherNumber: string | null;
  issueDocNumber: string | null;
  customerId: number;
  customerName: string;
  underCost: UnderCostRow[];
}

export interface ExecutePosSaleInput {
  warehouseId: number;
  customerId?: number | null;
  payNow: boolean;
  payMethod?: string;
  payAccount?: string;
  invoiceDate: string;
  description?: string;
  notes?: string;
  rawLines: unknown;
  user: { id: number; username: string; role: string };
}

/**
 * تنفيذ البيع الكامل بمعاملة واحدة — كل خطوة عبر محركها القائم حصرًا:
 *  1. بذر مؤجل: العميل النقدي إن لم يُسمَّ عميل (د6) + حساب 5116 (د4)
 *  2. فحص المتاح لكل الأسطر المخزنية بإعادة تشغيل الخط الزمني (د5) — الرفض يلغي البيع كله
 *  3. الفاتورة بمحرك الفواتير (بلا عقد — بلا سقف فوترة) ⇒ قيد الإصدار invoice_issue
 *  4. سند القبض الآلي عند الدفع الفوري (محرك السندات) ⇒ تخصيص FIFO على الفاتورة فورًا (د7)
 *  5. إذن الصرف المخزني الآلي للأسطر المخزنية (لقطة خادمية + قيد تكلفة مبيعات 5116/1160) (د4)
 *  6. audit واحد شامل — والتحذير تحت التكلفة يعاد غير مانع (د9)
 */
export async function executePosSale(input: ExecutePosSaleInput): Promise<PosSaleResult> {
  // 1) المستودع
  const warehouse = await db.warehouse.findFirst({
    where: { id: input.warehouseId },
    select: { id: true, name: true, active: true },
  });
  if (!warehouse) throw new SalesError("المستودع غير موجود", 404);
  if (!warehouse.active) throw new SalesError("المستودع موقوف — لا بيع عليه", 400);

  // 2) البذران المؤجلان قبل المعاملة (مكرران بلا أثر — والعميل يلزمه prepareVoucher)
  let customer: { id: number; name: string };
  let isCashCustomer = false;
  if (input.customerId) {
    const c = await db.customer.findFirst({
      where: { id: input.customerId },
      select: { id: true, name: true, notes: true },
    });
    if (!c) throw new SalesError("العميل غير موجود", 404);
    customer = { id: c.id, name: c.name };
    isCashCustomer = c.notes.includes(CASH_CUSTOMER_NOTE) || c.name === CASH_CUSTOMER_NAME;
  } else {
    const c = await ensureCashCustomer(db);
    customer = c;
    isCashCustomer = true;
  }
  const salesAccounts = await ensureSalesAccounts(db);

  // 3) تطبيع الأسطر وتعبئة بيانات الصنف
  const posLines = cleanPosLines(input.rawLines);
  const itemIds = Array.from(
    new Set(posLines.filter((l) => l.itemId != null && l.itemId > 0).map((l) => l.itemId as number))
  );
  const items = itemIds.length
    ? await db.stockItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, active: true } })
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const l of posLines) {
    if (l.itemId != null && l.itemId > 0) {
      const it = itemById.get(l.itemId);
      if (!it) throw new SalesError("أحد الأصناف غير موجود", 404);
      l.itemName = it.name;
      l.itemActive = it.active;
      if (!l.description) l.description = it.name;
    }
  }

  // 4) التحقق النقي المغلق (G8 — د3)
  const errors = validatePosSale({
    warehouseId: warehouse.id,
    customerId: customer.id,
    isCashCustomer,
    vdate: input.invoiceDate,
    lines: posLines,
    payment: { payNow: input.payNow, payMethod: input.payMethod, payAccount: input.payAccount },
  });
  if (errors.length > 0) throw new SalesError(errors[0], 400);

  // 5) بناء بنود الفاتورة بمحركها (itemId يمر عبره — د4)
  const built = buildInvoiceItems(
    posLines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      ...(l.itemId != null ? { itemId: l.itemId } : {}),
    }))
  );
  if (!built.ok) throw new SalesError(built.error, 400);
  const stockLines = built.items.filter((i) => i.itemId != null && i.itemId > 0);

  // 6) اللقطات الخادمية + فحص السالب بإعادة تشغيل الخط الزمني (د5 — درس G9 حرفيًا)
  const snapByItem = new Map<number, number>();
  const wacByItem = new Map<number, number>();
  if (stockLines.length > 0) {
    const { balances } = await loadBalances();
    for (const l of stockLines) {
      const b = balances.find((x) => x.itemId === l.itemId && x.warehouseId === warehouse.id);
      const snap = b && b.qty > 0 ? b.wac : 0;
      snapByItem.set(l.itemId as number, snap);
      wacByItem.set(l.itemId as number, b ? b.wac : 0);
    }
    const existingMovements = await loadStockMovements();
    const incoming: MovementInput[] = stockLines.map((l) => ({
      itemId: l.itemId as number,
      warehouseId: warehouse.id,
      date: input.invoiceDate,
      qty: -l.quantity,
      value: 0,
    }));
    const violations = validateAvailability(existingMovements, incoming);
    if (violations.length > 0) {
      const v = violations[0];
      const name = itemById.get(v.itemId)?.name ?? `#${v.itemId}`;
      throw new SalesError(
        `الكمية غير متوفرة — الصنف «${name}» بمستودع «${warehouse.name}»: المتاح ${v.available} والمطلوب ${v.required}`,
        400
      );
    }
  }

  // 7) تحذير البيع تحت التكلفة — غير مانع (د9)
  const underCost = underCostLines(posLines, (id) => wacByItem.get(id) ?? 0);

  // 8) تجهيز سند القبض الفوري بمحرك السندات (قبل المعاملة — د7)
  let prep: PreparedVoucher | null = null;
  if (input.payNow && built.total > 0) {
    prep = await prepareVoucher(
      {
        vtype: "receipt",
        amount: built.total,
        vdate: input.invoiceDate,
        method: input.payMethod || "",
        account: input.payAccount || "",
        party: customer.name,
        // توجيه تخصيص FIFO لعميل الفاتورة (المحرك القائم — القبض بلا عقد يقرأ expenseCustomerId)
        expenseCustomerId: customer.id,
        description: "سداد فوري — بيع نقاط البيع",
        notes: input.notes?.trim() || "",
      },
      input.user
    );
  }

  // 9) مزامنة عدّاد INV (مرآة مسار الفواتير)
  await syncInvoiceCounter();

  // 10) المعاملة الواحدة الكبرى (فواتير + سند + إذن صرف + audit) مع إعادة محاولة P2002 ×5
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await db.$transaction(
        async (tx) => {
          const invoiceNumber = await nextNumber("INV", 4, tx);
          const invoiceNo = intOr(invoiceNumber.replace(/^INV-/, ""), 0);
          const invoice = await tx.invoice.create({
            data: {
              invoiceNumber,
              invoiceNo,
              customerId: customer.id,
              contractId: null,
              invoiceDate: input.invoiceDate,
              dueDate: "",
              description: (input.description || "").trim() || POS_INVOICE_DESCRIPTION,
              subtotal: built.subtotal,
              discountTotal: built.discountTotal,
              total: built.total,
              notes: (input.notes || "").trim(),
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
              itemId: it.itemId != null && it.itemId > 0 ? it.itemId : null,
            })),
          });

          // قيد الإصدار (مدين ذمم/دائن إيراد — محرك الفواتير القائم)
          const entry = await postInvoiceIssueEntry(
            tx,
            {
              id: invoice.id,
              invoiceNumber,
              invoiceDate: input.invoiceDate,
              total: built.total,
              customerId: customer.id,
              contractId: null,
            },
            customer.name,
            input.user.username
          );

          // سند القبض الآلي (محرك السندات القائم — FIFO يخصص فورًا داخل نفس المعاملة)
          let voucherNumber: string | null = null;
          if (prep) {
            const rv = await createVoucherTx(tx, prep, input.user, {});
            voucherNumber = rv.voucherNumber;
          }

          // إذن الصرف المخزني الآلي للأسطر المخزنية (د4 — قيد تكلفة المبيعات)
          let issueDocNumber: string | null = null;
          if (stockLines.length > 0) {
            issueDocNumber = await createSaleIssueDocTx(tx, {
              invoiceId: invoice.id,
              invoiceNumber,
              vdate: input.invoiceDate,
              warehouseId: warehouse.id,
              customerName: customer.name,
              stockLines: stockLines.map((l) => ({
                itemId: l.itemId as number,
                qty: l.quantity,
                snapUnitCost: snapByItem.get(l.itemId as number) ?? 0,
              })),
              saleCostAccountId: salesAccounts.salesCost.id,
              actor: input.user.username,
            });
          }

          await audit(tx, {
            username: input.user.username,
            action: "إنشاء",
            entityType: "invoice",
            entityId: invoice.id,
            entityName: `${invoiceNumber} (بيع نقاط البيع)`,
          });
          return {
            invoiceId: invoice.id,
            invoiceNumber,
            total: built.total,
            entryNo: entry.entryNo,
            voucherNumber,
            issueDocNumber,
            customerId: customer.id,
            customerName: customer.name,
          };
        },
        TX_OPTS
      );
      return { ...result, underCost };
    } catch (e) {
      if (e instanceof SalesError || e instanceof VoucherError) throw new SalesError(e.message, e instanceof VoucherError ? e.status : e.status);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        lastError = e; // تضارب الترقيم — أعِد المحاولة
        continue;
      }
      lastError = e;
      break;
    }
  }
  console.error("فشل إتمام البيع:", lastError);
  const msg = lastError instanceof Error ? lastError.message : "";
  if (msg.includes("مقفلة")) throw new SalesError(msg, 400);
  throw new SalesError("تعذر إتمام البيع، حاول مجددًا", 500);
}

// ==================== تحويل عرض → فاتورة بيع (د2 — أول مستدعٍ واجهة) ====================

export interface ConvertQuotationResult {
  invoiceId: number;
  invoiceNumber: string;
  total: number;
  quotationNumber: string;
  entryNo: number;
}

/**
 * تحويل عرض سعر إلى فاتورة بيع عامة (بلا عقد — تصب في شاشة الفواتير القائمة):
 * بنود العرض تُترجم أسطرًا بخصم صفري، والعرض يُوسم بملاحظة التحويل ويُدقق —
 * المرفوض/المنتهي/المرسل غير قابل للتحويل، والمحوَّل سابقًا يمنع التكرار (د2).
 */
export async function convertQuotationToInvoice(
  quotationId: number,
  user: { id: number; username: string; role: string },
  invoiceDate?: string
): Promise<ConvertQuotationResult> {
  const q = await db.quotation.findFirst({
    where: { id: quotationId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      customer: { select: { id: true, name: true } },
    },
  });
  if (!q) throw new SalesError("عرض السعر غير موجود", 404);
  if (!quoteConvertible(q.status)) {
    throw new SalesError(`العرض بحالة «${q.status}» — التحويل إلى فاتورة للبيع للمقبول والجديد فقط (د2)`, 400);
  }
  if (q.notes.includes(QUOTE_CONVERT_MARKER)) {
    throw new SalesError("تم تحويل هذا العرض إلى فاتورة سابقًا — راجع ملاحظات العرض", 409);
  }
  const rows = mapQuotationToInvoiceItems(
    q.items.map((it) => ({ description: it.description, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice) }))
  );
  if (rows.length === 0) throw new SalesError("العرض بلا بنود — لا يُحوَّل لفاتورة", 400);
  const total = quoteInvoiceTotal(rows);
  if (!(total > 0)) throw new SalesError("إجمالي العرض صفر — لا يُصدَر عنه فاتورة", 400);

  await syncInvoiceCounter();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await db.$transaction(
        async (tx) => {
          const invoiceNumber = await nextNumber("INV", 4, tx);
          const invoiceNo = intOr(invoiceNumber.replace(/^INV-/, ""), 0);
          const vdate = invoiceDate || todayStr();
          const invoice = await tx.invoice.create({
            data: {
              invoiceNumber,
              invoiceNo,
              customerId: q.customerId,
              contractId: null,
              invoiceDate: vdate,
              dueDate: "",
              description: `تحويل عرض ${q.quotationNumber}`,
              subtotal: total,
              discountTotal: 0,
              total,
              notes: `محوَّل من عرض السعر ${q.quotationNumber}`,
            },
          });
          await tx.invoiceItem.createMany({
            data: rows.map((r, i) => ({
              invoiceId: invoice.id,
              description: r.description,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              discountPct: 0,
              lineTotal: r.lineTotal,
              sortOrder: i,
              itemId: null,
            })),
          });

          // قيد الإصدار الآلي (محرك الفواتير القائم)
          const entry = await postInvoiceIssueEntry(
            tx,
            { id: invoice.id, invoiceNumber, invoiceDate: vdate, total, customerId: q.customerId, contractId: null },
            q.customer.name,
            user.username
          );

          // وسم العرض بملاحظة التحويل (علامة منع التكرار — د2) + التدقيق
          const marked = `${q.notes ? `${q.notes}\n` : ""}${QUOTE_CONVERT_MARKER} ${invoiceNumber} بتاريخ ${todayStr()}`;
          await tx.quotation.update({ where: { id: q.id }, data: { notes: marked } });
          await audit(tx, {
            username: user.username,
            action: "تحويل عرض إلى فاتورة",
            entityType: "quotation",
            entityId: q.id,
            entityName: `${q.quotationNumber} ⇒ ${invoiceNumber}`,
          });
          return { invoiceId: invoice.id, invoiceNumber, total, quotationNumber: q.quotationNumber, entryNo: entry.entryNo };
        },
        TX_OPTS
      );
      return result;
    } catch (e) {
      if (e instanceof SalesError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        lastError = e;
        continue;
      }
      lastError = e;
      break;
    }
  }
  console.error("فشل تحويل العرض:", lastError);
  const msg = lastError instanceof Error ? lastError.message : "";
  if (msg.includes("مقفلة")) throw new SalesError(msg, 400);
  throw new SalesError("تعذر تحويل العرض، حاول مجددًا", 500);
}

// ==================== الإلغاء الشامل (د8 — يسحب الثلاثة معًا) ====================

/**
 * التراجع الشامل المرتبط بفاتورة بيع داخل معاملة الإلغاء القائمة:
 *  1. أذون الصرف المخزنية الآلية المرتبطة (saleInvoiceId) — عكس قيدِها والملغاة شفافة فتعود الأرصدة اشتقاقيًا (درس G9)
 *  2. سندات القبض المرتبطة بالفاتورة — عكس قيودها ومسح تخصيصها وإعادة فتح الفاتورة (cancelVoucherTx القائم)
 * الفاتورة بلا saleDocs ولا سندات = السلوك القائم حرفيًا بلا أي تغيير (لا فحص إضافي).
 * يُستدعى قبل voidInvoiceTx حصرًا — بترتيب التصميم: الصرف أولًا ثم السند ثم عكس الإصدار.
 */
export async function voidPosLinkedTx(
  tx: Tx,
  invoiceId: number,
  reason: string,
  actor: string
): Promise<{ saleDocs: number; receipts: number }> {
  const saleDocs = await tx.stockDoc.findMany({
    where: { saleInvoiceId: invoiceId, status: "posted" },
    select: { id: true, docNumber: true, journalEntryId: true },
  });
  const links = await tx.invoicePaymentLink.findMany({
    where: { invoiceId, voucher: { cancelled: false } },
    select: { voucherId: true, voucher: { select: { vtype: true } } },
  });
  const receiptIds = Array.from(
    new Set(links.filter((l) => l.voucher.vtype === "receipt").map((l) => l.voucherId))
  );
  if (saleDocs.length === 0 && receiptIds.length === 0) return { saleDocs: 0, receipts: 0 };

  // 1) إذن الصرف المخزني الآلي — عكس قيده (الأرصدة تعود تلقائيًا — G9)
  for (const d of saleDocs) {
    if (d.journalEntryId) {
      await reverseJournalEntry(tx, d.journalEntryId, `إلغاء فاتورة البيع المرتبطة — ${reason}`, actor);
    }
    await tx.stockDoc.update({
      where: { id: d.id },
      data: { status: "cancelled", cancelReason: `إلغاء الفاتورة المرتبطة — ${reason}`, cancelledAt: new Date() },
    });
    await audit(tx, {
      username: actor,
      action: "إلغاء",
      entityType: "stock_doc",
      entityId: d.id,
      entityName: d.docNumber,
      reason: `إلغاء الفاتورة المرتبطة — ${reason}`,
    });
  }

  // 2) سندات القبض المرتبطة — عكسها ومسح تخصيصها (المحرك القائم cancelVoucherTx)
  for (const vid of receiptIds) {
    await cancelVoucherTx(tx, vid, `إلغاء فاتورة البيع المرتبطة — ${reason}`, actor);
  }
  return { saleDocs: saleDocs.length, receipts: receiptIds.length };
}
