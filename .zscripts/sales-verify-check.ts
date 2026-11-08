/**
 * sales-verify-check — التحقق الحي المرحلي (docs/sales-design.md §8.5) بأرقام محسوبة:
 * phase1: بعد البيع الأول (المعاملة الكبرى) — القيود الثلاثة والأرصدة والبذر
 * phase2: بعد إلغاء الفاتورة — عكس الثلاثة والرصيد يعود
 * phase3: بعد تحويل العرض والبيع الآجل — الفاتورة بلا عقد والعلامة
 * الاستخدام: DATABASE_URL=... bun .zscripts/sales-verify-check.ts <phase>
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const phase = process.argv[2] || "phase1";
let fails = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "✅" : "❌"} ${label} — ${JSON.stringify(actual)}${ok ? "" : ` (المتوقع ${JSON.stringify(expected)})`}`);
}

async function main() {
  const companyId = 1;

  if (phase === "phase1") {
    // ===== المعاملة الكبرى: 4 قيود (إدخال مخزني + إصدار + قبض + صرف بيع) =====
    const entries = await db.journalEntry.findMany({
      where: { companyId },
      include: { lines: { orderBy: { sort: "asc" } } },
      orderBy: { id: "asc" },
    });
    check("عدد القيود (إدخال مخزني + إصدار + قبض + صرف بيع)", entries.length, 4);

    // حسم الحسابات بالكود (لا بالترتيب)
    const accByCode = new Map(
      (await db.account.findMany({ where: { companyId }, select: { id: true, code: true } })).map((a) => [a.code, a.id])
    );
    const AR = accByCode.get("1121");
    const REV = accByCode.get("4100");
    const CASH = accByCode.get("1111");
    const A5116 = accByCode.get("5116");
    const A1160 = accByCode.get("1160");

    const inv = entries.find((e) => e.sourceType === "invoice");
    check("قيد الإصدار موجود", !!inv, true);
    check("قيد الإصدار طرفاه (مدين ذمم 13/دائن إيراد 13)",
      inv?.lines.map((l) => ({ a: l.accountId, d: Number(l.debit), c: Number(l.credit) })),
      [{ a: AR, d: 13, c: 0 }, { a: REV, d: 0, c: 13 }]);
    const voucher = entries.find((e) => e.sourceType === "voucher");
    check("قيد السند موجود", !!voucher, true);
    check("قيد السند (صندوق مدين كامل + دائن ذمم بالتخصيص — بُعد العميل)", voucher?.lines.map((l) => ({ a: l.accountId, d: Number(l.debit), c: Number(l.credit), cust: l.customerId })),
      [{ a: CASH, d: 13, c: 0, cust: 1 }, { a: AR, d: 0, c: 13, cust: 1 }]);
    const stock = entries.find((e) => e.sourceType === "inventory_issue");
    check("قيد الصرف موجود", !!stock, true);
    check("قيد تكلفة المبيعات (مدين 5116 6.25/دائن 1160 6.25)", stock?.lines.map((l) => ({ a: l.accountId, d: Number(l.debit), c: Number(l.credit) })),
      [{ a: A5116, d: 6.25, c: 0 }, { a: A1160, d: 0, c: 6.25 }]);
    const acct5116 = await db.account.findFirst({ where: { companyId, code: "5116" } });
    check("حساب 5116 مبذور", acct5116 ? acct5116.name : null, "تكلفة المبيعات");
    const woRow = await db.stockDoc.findFirst({ where: { companyId, docNumber: "WO-0001" } });
    check("قيد الصرف مرتبط بالإذن عبر journalEntryId", woRow?.journalEntryId, stock?.id);

    // ===== الفاتورة والسند والإذن =====
    const invoice = await db.invoice.findFirst({ where: { companyId, invoiceNumber: "INV-0001" } });
    check("الفاتورة total", invoice ? Number(invoice.total) : null, 13);
    check("الفاتورة paidAmount", invoice ? Number(invoice.paidAmount) : null, 13);
    check("الفاتورة status", invoice?.status, "paid");
    check("الفاتورة بلا عقد", invoice?.contractId ?? null, null);
    check("وصف الفاتورة بيع النقطة", invoice?.description, "بيع نقاط البيع");
    const link = await db.invoicePaymentLink.findFirst({ where: { companyId, invoiceId: invoice?.id } });
    check("رابط التخصيص FIFO", link ? Number(link.amount) : null, 13);
    const rv = await db.voucher.findFirst({ where: { companyId, voucherNumber: "RV-0001" } });
    check("سند القبض RV-0001 قيمته", rv ? Number(rv.amount) : null, 13);
    check("سند القبض بوسيلة نقد", rv?.account, "صندوق");
    const wo = await db.stockDoc.findFirst({ where: { companyId, docNumber: "WO-0001" }, include: { lines: true } });
    check("إذن الصرف WO-0001 مرتبط بالفاتورة", wo ? wo.saleInvoiceId : null, invoice?.id ?? -1);
    check("إذن الصرف بلا عقد", wo?.contractId ?? null, null);
    check("لقطة السطر 1.25×5", wo?.lines.length ? [Number(wo.lines[0].snapUnitCost), Number(wo.lines[0].amount)] : null, [1.25, 6.25]);

    // ===== البذران =====
    const cashCustomer = await db.customer.findFirst({ where: { companyId, notes: { contains: "عميل نقدي" } } });
    check("العميل النقدي مبذور", [cashCustomer?.name, cashCustomer?.customerCode], ["عميل نقدي — نقاط البيع", "C-0001"]);
    check("الفاتورة لعميل النقدي", invoice?.customerId, cashCustomer?.id);

    // ===== الأرصدة الاشتقاقية =====
    const lines = await db.stockDocLine.findMany({ where: { companyId }, include: { doc: true } });
    const bal = new Map<string, { q: number; v: number }>();
    for (const l of lines) {
      if (l.doc.status === "cancelled") continue;
      const sign = l.doc.kind === "issue" ? -1 : 1;
      const key = `${l.itemId}:${l.doc.warehouseId}`;
      const acc = bal.get(key) ?? { q: 0, v: 0 };
      acc.q += sign * Number(l.qty);
      acc.v += sign * Number(l.amount);
      bal.set(key, acc);
    }
    const b1 = bal.get("1:1");
    check("رصيد إسمنت بالمستودع الرئيسي", [b1?.q, b1?.v], [5, 6.25]);

    // ===== مبيعات اليوم =====
    // (تُختبر عبر GET — أُثبتت بالاستجابة أعلاه)
  }

  if (phase === "phase2") {
    const entries = await db.journalEntry.findMany({ where: { companyId }, orderBy: { id: "asc" }, include: { lines: true } });
    // عكس قيود الإصدار والصرف المخزني بنوع reversal — وعكس قيد السند بنوع voucher_cancel (اصطلاح محرك السندات)
    const reversals = entries.filter((e) => e.sourceType === "reversal");
    const voucherCancels = entries.filter((e) => e.sourceType === "voucher_cancel");
    check("عدد قيود العكس (الصرف المخزني + الإصدار)", reversals.length, 2);
    check("عكس قيد السند بنوع voucher_cancel", voucherCancels.length, 1);
    const linked = entries.filter((e) => e.reversalOfId != null).length;
    check("عكسا الإصدار والصرف مرتبطان بالأصل (reversalOfId)", linked, 2);
    const invEntry = entries.find((e) => e.sourceType === "invoice");
    const woEntry = entries.find((e) => e.sourceType === "inventory_issue");
    const rvEntry = entries.find((e) => e.sourceType === "voucher");
    const allCancelled = [
      ...reversals.map((r) => r.reversalOfId),
      ...voucherCancels.map((c) => c.id),
    ];
    check("الإلغاء الثلاثي يغطي (إصدار الفاتورة + قيد السند + الصرف المخزني)",
      [invEntry ? allCancelled.includes(invEntry.id) : false, woEntry ? allCancelled.includes(woEntry.id) : false, rvEntry ? voucherCancels.length > 0 : false],
      [true, true, true]);
    const invoice = await db.invoice.findFirst({ where: { companyId, invoiceNumber: "INV-0001" } });
    check("الفاتورة ملغاة", invoice?.status, "void");
    const rv = await db.voucher.findFirst({ where: { companyId, voucherNumber: "RV-0001" } });
    check("السند ملغى", rv?.cancelled, true);
    const wo = await db.stockDoc.findFirst({ where: { companyId, docNumber: "WO-0001" } });
    check("إذن الصرف ملغى", wo?.status, "cancelled");
    const lines = await db.stockDocLine.findMany({ where: { companyId }, include: { doc: true } });
    const bal = new Map<string, { q: number; v: number }>();
    for (const l of lines) {
      if (l.doc.status === "cancelled") continue;
      const sign = l.doc.kind === "issue" ? -1 : 1;
      const key = `${l.itemId}:${l.doc.warehouseId}`;
      const acc = bal.get(key) ?? { q: 0, v: 0 };
      acc.q += sign * Number(l.qty);
      acc.v += sign * Number(l.amount);
      bal.set(key, acc);
    }
    const b1 = bal.get("1:1");
    check("الرصيد يعود بعد الإلغاء", [b1?.q, b1?.v], [10, 12.5]);
    const link = await db.invoicePaymentLink.findFirst({ where: { companyId, invoiceId: invoice?.id, voucher: { cancelled: false } } });
    check("لا روابط تخصيص سارية", link ?? null, null);
  }

  if (phase === "phase3") {
    const inv2 = await db.invoice.findFirst({ where: { companyId, invoiceNumber: "INV-0002" }, include: { items: true } });
    check("فاتورة التحويل total", inv2 ? Number(inv2.total) : null, 1000);
    check("فاتورة التحويل بلا عقد", inv2?.contractId ?? null, null);
    check("فاتورة التحويل من عرض", inv2?.description?.startsWith("تحويل عرض"), true);
    const q = await db.quotation.findFirst({ where: { companyId, quotationNumber: "QUO-0001" } });
    check("العرض موسوم بالتحويل", q?.notes?.includes("تحويل إلى الفاتورة INV-0002"), true);
    check("الفاتورة ببند التحويل", inv2?.items.length, 1);

    const inv3 = await db.invoice.findFirst({ where: { companyId, invoiceNumber: "INV-0003" }, include: { items: true } });
    check("البيع الآجل فاتورة 50", inv3 ? Number(inv3.total) : null, 50);
    check("الآجل بلا سند", (await db.invoicePaymentLink.count({ where: { companyId, invoiceId: inv3?.id ?? 0 } })), 0);
    check("الآجل بلا إذن صرف (سطر حر)", (await db.stockDoc.count({ where: { companyId, saleInvoiceId: inv3?.id ?? 0 } })), 0);
    check("آجل لعميل مسمّى", inv3?.customerId != null && inv3.customerId !== 1, true);
  }

  if (phase === "phase4") {
    // بعد بيع الواجهة تحت التكلفة: فاتورة 4 + سند 5 + إذن صرف + تحذير
    const inv4 = await db.invoice.findFirst({ where: { companyId, invoiceNumber: "INV-0004" }, include: { items: true } });
    check("بيع الواجهة 1 كيس @1.000", inv4 ? Number(inv4.total) : null, 1);
    const rv4 = await db.voucher.findFirst({ where: { companyId, voucherNumber: "RV-0002" } });
    check("سند الواجهة", rv4 ? Number(rv4.amount) : null, 1);
    const wo2 = await db.stockDoc.findFirst({ where: { companyId, saleInvoiceId: inv4?.id ?? 0 } });
    check("إذن صرف الواجهة", wo2?.docNumber, "WO-0002");
    check("لقطة الواجهة بالمتوسط", wo2 ? Number(wo2.totalAmount) : null, 1.25);
    const lines = await db.stockDocLine.findMany({ where: { companyId }, include: { doc: true } });
    const bal = new Map<string, { q: number; v: number }>();
    for (const l of lines) {
      if (l.doc.status === "cancelled") continue;
      const sign = l.doc.kind === "issue" ? -1 : 1;
      const key = `${l.itemId}:${l.doc.warehouseId}`;
      const acc = bal.get(key) ?? { q: 0, v: 0 };
      acc.q += sign * Number(l.qty);
      acc.v += sign * Number(l.amount);
      bal.set(key, acc);
    }
    const b1 = bal.get("1:1");
    check("الرصيد بعد بيع الواجهة", [b1?.q, b1?.v], [9, 11.25]);
  }

  console.log(fails === 0 ? `\n🎉 كل الفحوص ناجحة (${phase})` : `\n💥 ${fails} فحوص فاشلة (${phase})`);
  process.exit(fails === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
