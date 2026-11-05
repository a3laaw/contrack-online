import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { EPS, r3 } from "@/lib/contrack-core";
import {
  resolvePostingSide,
  type RuleChartAccount,
} from "@/lib/posting-rules-core";
import { loadChartCandidates, loadPostingRules, type VoucherJournalInvoiceAllocation } from "@/lib/posting-rules-server";
import { postNamedEntry, reverseJournalEntry } from "@/lib/journal-server";

/** تحويل آمن لرقم (مرآة numOr — محلية لكسر دورة الاستيراد مع contrack-server) */
const numOr = (v: unknown, d: number): number => {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) ? n : d;
};

type Tx = Prisma.TransactionClient;

/**
 * invoice-server.ts — نواة الفواتير — Task 107 (منهج النواة الواحدة).
 *  • postInvoiceIssueEntry: قيد الإصدار الآلي (مدين ذمم / دائن إيراد) عبر قاعدة
 *    invoice_issue المعلنة + بوابة الأطراف المسمّاة (الحساب → الدليل → التسوية).
 *  • reallocateVoucherInvoiceLinks: تخصيص سند القبض على فواتير العميل المفتوحة
 *    FIFO (عقد السند أولًا ثم الأقدمية بالرقم) — المصدر الوحيد لحالة السداد،
 *    وpaidAmount يُجمَّع من الروابط داخل نفس معاملة تغيّرها (لا انحراف ممكن).
 *  • voidInvoiceTx: الإلغاء بقيد عكسي مرتبط — لا حذف للفاتورة الصادرة قيدًا.
 * صفوف legacy=true: أرشيفية بلا قيد ومستبعدة من التخصيص (أموالها حُصّلت
 * تحت نموذج النصوص قبل النواة المزدوجة).
 */

type DbClient = Prisma.TransactionClient | PrismaClient;

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  unpaid: "غير مسددة",
  partial: "مسددة جزئيًا",
  paid: "مسددة",
  void: "ملغاة",
};

/** حالة الفاتورة المشتقة من المسدد مقابل الصافي — الملغاة تظل ملغاة */
export function deriveInvoiceStatus(total: number, paid: number, current?: string): string {
  if (current === "void") return "void";
  if (paid >= r3(total) - EPS) return "paid";
  if (paid > EPS) return "partial";
  return "unpaid";
}

// ==================== بناء وتحقق البنود ====================

export interface InvoiceItemInputRow {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  lineTotal: number;
}

export interface BuiltInvoiceItems {
  items: InvoiceItemInputRow[];
  subtotal: number;
  discountTotal: number;
  total: number;
}

interface RawItemInput {
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  discountPct?: unknown;
}

/** بناء وتحقق بنود الفاتورة — يعيد الأسطر الجاهزة + الإجماليات المحصلة (r3 لكل سطر) */
export function buildInvoiceItems(raw: unknown): { ok: true } & BuiltInvoiceItems | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "الفاتورة يجب أن تحوي بندًا واحدًا على الأقل" };
  const items: (InvoiceItemInputRow & { gross: number })[] = [];
  for (const it of raw as RawItemInput[]) {
    const description = String(it?.description ?? "").trim();
    if (!description) return { ok: false, error: "كل بند يحتاج وصفًا" };
    const quantity = r3(numOr(it?.quantity, 0));
    if (!(quantity > 0)) return { ok: false, error: "كمية كل بند يجب أن تكون أكبر من صفر" };
    const unitPrice = r3(numOr(it?.unitPrice, 0));
    if (!(unitPrice >= 0)) return { ok: false, error: "سعر الوحدة لا يكون سالبًا" };
    const discountPct = r3(numOr(it?.discountPct, 0));
    if (discountPct < 0 || discountPct > 100) return { ok: false, error: "نسبة الخصم بين 0 و 100" };
    const gross = r3(quantity * unitPrice);
    const lineTotal = r3(gross * (1 - discountPct / 100));
    items.push({ description, quantity, unitPrice, discountPct, lineTotal, gross });
  }
  const subtotal = r3(items.reduce((s, i) => s + i.gross, 0));
  const total = r3(items.reduce((s, i) => s + i.lineTotal, 0));
  if (!(total > 0)) return { ok: false, error: "صافي الفاتورة يجب أن يكون أكبر من صفر" };
  return {
    ok: true,
    items: items.map(({ description, quantity, unitPrice, discountPct, lineTotal }) => ({ description, quantity, unitPrice, discountPct, lineTotal })),
    subtotal,
    discountTotal: r3(subtotal - total),
    total,
  };
}

// ==================== قيد الإصدار ====================

/**
 * حسم طرفَي قيد الإصدار من قاعدة invoice_issue المعلنة:
 * كود القاعدة (ورقي نشط) → الاسم المدمج («العملاء»/«إيرادات العقود» يحسمه
 * الحاسم النصي عبر الدليل/الخريطة الثابتة) → التسوية (داخل postNamedEntry).
 */
export async function resolveInvoiceIssueSides(
  tx: DbClient
): Promise<{ debit: { accountId: number | null; name: string }; credit: { accountId: number | null; name: string } }> {
  const [chart, rules] = await Promise.all([
    loadChartCandidates(tx) as Promise<RuleChartAccount[]>,
    loadPostingRules(tx),
  ]);
  const rule = rules.find((r) => r.ruleKey === "invoice_issue" && r.enabled);
  const debitRes = resolvePostingSide(
    { ruleCode: rule?.debitCode || "", builtinName: "العملاء" },
    chart
  );
  const creditRes = resolvePostingSide(
    { ruleCode: rule?.creditCode || "", builtinName: "إيرادات العقود" },
    chart
  );
  return {
    debit: { accountId: debitRes?.accountId ?? null, name: debitRes?.name || "العملاء" },
    credit: { accountId: creditRes?.accountId ?? null, name: creditRes?.name || "إيرادات العقود" },
  };
}

/**
 * نشر قيد إصدار الفاتورة وتحديث entryId — يُستدعى داخل معاملة إنشاء/تعديل
 * الفاتورة (فشل النشر = تراجع الإصدار كله: لا فاتورة بلا قيد).
 */
export async function postInvoiceIssueEntry(
  tx: Tx,
  invoice: {
    id: number;
    invoiceNumber: string;
    invoiceDate: string;
    total: number;
    customerId: number;
    contractId: number | null;
  },
  customerName: string,
  actor = "النظام (آلي)"
): Promise<{ id: number; entryNo: number }> {
  const sides = await resolveInvoiceIssueSides(tx);
  const amount = r3(invoice.total);
  const dims = { customerId: invoice.customerId, contractId: invoice.contractId ?? null };
  const result = await postNamedEntry(tx, {
    entryDate: invoice.invoiceDate,
    description: `فاتورة ${invoice.invoiceNumber} — ${customerName}`,
    debit: { name: sides.debit.name, accountId: sides.debit.accountId },
    credit: { name: sides.credit.name, accountId: sides.credit.accountId },
    amount,
    dims,
    sourceType: "invoice",
    sourceId: invoice.id,
    actor,
  });
  await tx.invoice.update({ where: { id: invoice.id }, data: { entryId: result.id } });
  return { id: result.id, entryNo: result.entryNo };
}

/** عكس قيد الإصدار الحالي ونشر قيد جديد بقيم الفاتورة بعد التعديل (تعديل شفاف) */
export async function repostInvoiceEntry(
  tx: Tx,
  invoice: {
    id: number;
    invoiceNumber: string;
    invoiceDate: string;
    total: number;
    customerId: number;
    contractId: number | null;
    entryId: number | null;
  },
  customerName: string,
  reason: string,
  actor = "النظام (آلي)"
): Promise<void> {
  if (invoice.entryId) {
    await reverseJournalEntry(tx, invoice.entryId, reason, actor);
  }
  await postInvoiceIssueEntry(tx, invoice, customerName, actor);
}

// ==================== تخصيص السداد (المصدر الوحيد لحالة الفاتورة) ====================

/**
 * إعادة تخصيص سند على فواتير العميل المفتوحة — تُستدعى داخل معاملة إنشاء/تعديل
 * وإلغاء السند: تمسح روابط السند ثم تخصص FIFO (فواتير عقد السند أولًا ثم البقية
 * بالأقدمية) على غير المرحَّلة وغير الملغاة التي لم تسدد بعد، ثم تعيد حساب
 * paidAmount/status لكل فاتورة متأثرة. تُرجع التخصيصات لبناء قيد السند.
 */
export async function reallocateVoucherInvoiceLinks(
  tx: Tx,
  v: {
    id: number;
    voucherNumber: string;
    vtype: string;
    cancelled: boolean;
    amount: number;
    customerId: number | null;
    contractId: number | null;
  }
): Promise<VoucherJournalInvoiceAllocation[]> {
  // الفواتير المتأثرة قبل المسح (تُعاد أرصدتها ولو لم يخصص شيء جديد)
  const oldLinks = await tx.invoicePaymentLink.findMany({
    where: { voucherId: v.id },
    select: { invoiceId: true },
  });
  await tx.invoicePaymentLink.deleteMany({ where: { voucherId: v.id } });

  const allocs: VoucherJournalInvoiceAllocation[] = [];
  let left = r3(v.amount);

  if (v.vtype === "receipt" && !v.cancelled && left > EPS) {
    // عميل السند: الطرف الصريح → عميل العقد
    let customerId = v.customerId;
    if (customerId == null && v.contractId != null) {
      const contract = await tx.contract.findUnique({
        where: { id: v.contractId },
        select: { customerId: true },
      });
      customerId = contract?.customerId ?? null;
    }

    if (customerId != null) {
      const open = await tx.invoice.findMany({
        where: {
          customerId,
          legacy: false,
          status: { not: "void" },
        },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceNo: true,
          total: true,
          paidAmount: true,
          contractId: true,
        },
        orderBy: { invoiceNo: "asc" },
      });
      // المفتوح فعليًا (paidAmount كاش يحفظه هذا المحرك نفسه في المعاملة نفسها)
      const candidates = open.filter((i) => r3(Number(i.total) - Number(i.paidAmount)) > EPS);
      // عقد السند أولًا ثم البقية بالأقدمية (ترتيب invoiceNo محفوظ بالفلترة)
      const sameContract = v.contractId != null ? candidates.filter((i) => i.contractId === v.contractId) : [];
      const others = v.contractId != null ? candidates.filter((i) => i.contractId !== v.contractId) : candidates;

      for (const inv of [...sameContract, ...others]) {
        if (left <= EPS) break;
        const openAmt = r3(Number(inv.total) - Number(inv.paidAmount));
        const t = r3(Math.min(left, openAmt));
        if (t > EPS) {
          await tx.invoicePaymentLink.create({
            data: { voucherId: v.id, invoiceId: inv.id, amount: t },
          });
          allocs.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, amount: t });
          left = r3(left - t);
        }
      }
    }
  }

  await recalcInvoices(
    tx,
    Array.from(new Set([...oldLinks.map((o) => o.invoiceId), ...allocs.map((a) => a.invoiceId)]))
  );
  void v.voucherNumber;
  return allocs;
}

/**
 * إعادة حساب paidAmount/status من الروابط حصرًا (سندات غير ملغاة) — الكاش الوحيد
 * الذي يحفظه هذا المحرك داخل معاملة تغيّر الروابط، فلا انحراف عن المصدر.
 */
export async function recalcInvoices(tx: Tx, invoiceIds: number[]): Promise<void> {
  for (const id of Array.from(new Set(invoiceIds))) {
    const inv = await tx.invoice.findUnique({
      where: { id },
      select: { total: true, status: true },
    });
    if (!inv) continue;
    const agg = await tx.invoicePaymentLink.aggregate({
      where: { invoiceId: id, voucher: { cancelled: false } },
      _sum: { amount: true },
    });
    const paid = r3(Number(agg._sum.amount || 0));
    await tx.invoice.update({
      where: { id },
      data: {
        paidAmount: paid,
        status: deriveInvoiceStatus(Number(inv.total), paid, inv.status),
      },
    });
  }
}

// ==================== إلغاء الفاتورة (بقيد عكسي مرتبط) ====================

/**
 * إلغاء فاتورة داخل معاملة: يمنع إلغاء المسددة، ويعكس قيد الإصدار للصادرة
 * قيدًا، والمرحَّلة تُلغى بلا قيد (أرشيفية). حدث العقد والتدقيق على المستدعي.
 */
export async function voidInvoiceTx(
  tx: Tx,
  invoiceId: number,
  reason: string,
  actor: string
): Promise<{ invoiceNumber: string; reversedEntryId: number | null }> {
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, status: true, total: true, paidAmount: true, entryId: true },
  });
  if (!inv) throw new Error("الفاتورة غير موجودة");
  if (inv.status === "void") throw new Error("الفاتورة ملغاة من قبل");
  if (r3(Number(inv.paidAmount)) > EPS) {
    throw new Error("لا يمكن إلغاء فاتورة مسددة جزئيًا أو كليًا — راجع سندات السداد أولًا");
  }
  let reversedEntryId: number | null = null;
  if (inv.entryId) {
    const reversal = await reverseJournalEntry(
      tx,
      inv.entryId,
      `إلغاء فاتورة ${inv.invoiceNumber} — ${reason}`,
      actor
    );
    reversedEntryId = reversal.id;
  }
  await tx.invoice.update({
    where: { id: inv.id },
    data: { status: "void", voidReason: (reason || "").trim() },
  });
  return { invoiceNumber: inv.invoiceNumber, reversedEntryId };
}

// ==================== مساعدات القراءة ====================

/** مجموع المفوتر لغير الملغاة على عقد — سقف الفوترة (القيمة الحالية − المفوتر) */
export async function invoicedTotalForContract(client: DbClient, contractId: number): Promise<number> {
  const agg = await client.invoice.aggregate({
    where: { contractId, status: { not: "void" } },
    _sum: { total: true },
  });
  return r3(Number(agg._sum.total || 0));
}
