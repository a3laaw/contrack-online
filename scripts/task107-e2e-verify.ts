/**
 * تحقق E2E شامل لمهمة 107 — جلسة واحدة (درس T106: العمليات الخلفية تُقتل بين الاستدعاءات).
 * الدورة كاملة: فاتورة ببنود → قيد إصدار → سند قبض → تخصيص FIFO → دائن ذمم →
 * إلغاء سند → إعادة فتح → سند ثانٍ → سداد كامل → إلغاء فاتورة بقيد عكسي → PDF → ميزان.
 */
const BASE = "http://localhost:3000";
const KWD_EPS = 0.001;

let token = "";
async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function step(name: string, ok: boolean, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function glBalance(): Promise<{ dr: number; cr: number }> {
  // من قاعدة البيانات مباشرة عبر Prisma (نفس القاعدة المحلية)
  const { PrismaClient } = await import("@prisma/client");
  const p = new PrismaClient();
  const agg = await p.journalLine.aggregate({
    where: { entry: { status: "posted" } },
    _sum: { debit: true, credit: true },
  });
  await p.$disconnect();
  return { dr: Number(agg._sum.debit ?? 0), cr: Number(agg._sum.credit ?? 0) };
}

async function main() {
  // 1) دخول
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "raheem", password: "Raheem@107" }),
  }).then((r) => r.json());
  token = login.token;
  step("دخول raheem", !!token);

  const gl0 = await glBalance();
  console.log(`   ميزان ما قبل الفحص: مدين ${gl0.dr} / دائن ${gl0.cr} (فرق ${(gl0.dr - gl0.cr).toFixed(3)})`);

  // 2) بذر الدليل وقواعد الترحيل (قراءة أولى)
  const accounts = await api("/api/accounts");
  const chart = accounts.accounts ?? accounts.items ?? [];
  step("بذر الدليل", chart.length > 0, `${chart.length} حسابًا`);
  const acc1121 = chart.find((a: { code: string }) => a.code === "1121");
  const acc4100 = chart.find((a: { code: string }) => a.code === "4100");
  step("حسابات الذمم والإيراد موجودتان", !!acc1121 && !!acc4100, `${acc1121?.code}/${acc4100?.code}`);
  const rules = await api("/api/posting-rules");
  const invRule = (rules.rules ?? []).find((r: { ruleKey: string }) => r.ruleKey === "invoice_issue");
  step("قاعدة invoice_issue مبذورة", !!invRule, `مدين ${invRule?.debitCode} / دائن ${invRule?.creditCode}`);

  // 3) قائمة الفواتير — المرحّلتان
  const invList = await api("/api/invoices");
  const legacy = invList.invoices.filter((i: { legacy: boolean }) => i.legacy);
  step("الفاتورتان المرحّلتان ظاهرتان", legacy.length === 2, legacy.map((i: { invoiceNumber: string }) => i.invoiceNumber).join(" + "));

  // 4) إصدار فاتورة ببنود + خصم
  const cust = await api("/api/customers");
  const customerId = cust.customers[0].id;
  const inv1 = await api("/api/invoices", {
    method: "POST",
    body: {
      customerId,
      contractId: undefined,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: undefined,
      description: "فاتورة فحص — أعمال تشطيب",
      items: [
        { description: "أعمال جبس بورد", quantity: 120, unitPrice: 2.5, discountPct: 10 },
        { description: "دهانات وتشطيبات", quantity: 1, unitPrice: 500, discountPct: 0 },
      ],
    },
  });
  const inv1Total = inv1.invoice.total;
  const expected = 120 * 2.5 * 0.9 + 500; // 770
  step("إصدار فاتورة 1 ببنود وخصم", Math.abs(inv1Total - expected) < KWD_EPS, `الصافي ${inv1Total} متوقع ${expected} · قيد #${inv1.invoice.entryNo}`);

  // 5) تفاصيل الفاتورة + القيد المرتبط
  const det = await api(`/api/invoices/${inv1.invoice.id}`);
  step("تفاصيل الفاتورة ببنودها", det.items.length === 2, `بنود ${det.items.length}`);
  const entry = det.entry;
  step("القيد المرتبط منشور", entry?.status === "posted", `#${entry?.entryNo}`);

  // 6) فاتورة 2 (للتخصيص والسداد الكامل) — بدون عقد
  const inv2 = await api("/api/invoices", {
    method: "POST",
    body: {
      customerId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      items: [{ description: "أعمال كهرباء", quantity: 1, unitPrice: 2000, discountPct: 0 }],
    },
  });
  step("إصدار فاتورة 2", inv2.invoice.total === 2000, `#INV ${inv2.invoice.invoiceNumber} · قيد #${inv2.invoice.entryNo}`);

  // 7) سند قبض 3,000 مرتبط بعقد العميل (القبض بلا عقد يفرغ الطرف — سلوك قديم موثق)
  // التخصيص FIFO: عقد السند أولًا ثم البقية بالأقدمية — المرحَّلة مستبعدة
  const contracts = await api("/api/customers");
  const custId = contracts.customers[0].id;
  const custDetail = await api(`/api/customers/${custId}`);
  const contractId = custDetail.contracts[0].id;
  const voucher = await api("/api/vouchers", {
    method: "POST",
    body: {
      vtype: "receipt",
      vdate: new Date().toISOString().slice(0, 10),
      contractId,
      amount: 3000,
      method: "نقدًا",
      description: "تحصيل فواتير فحص",
    },
  });
  step("سند قبض 3,000 بعقد", !!voucher.voucher?.id || !!voucher.id, JSON.stringify(voucher).slice(0, 120));
  const vid = voucher.voucher?.id ?? voucher.id;

  // فحص التخصيص والحالات
  const listAfter = await api("/api/invoices");
  const i1 = listAfter.invoices.find((i: { id: number }) => i.id === inv1.invoice.id);
  const i2 = listAfter.invoices.find((i: { id: number }) => i.id === inv2.invoice.id);
  step("تخصيص FIFO على فاتورة 1", Math.abs(i1.paidAmount - 770) < KWD_EPS && i1.status === "paid", `مسدد ${i1.paidAmount} · ${i1.status}`);
  step("تخصيص FIFO على فاتورة 2", Math.abs(i2.paidAmount - 2000) < KWD_EPS && i2.status === "paid", `مسدد ${i2.paidAmount} · ${i2.status}`);
  step("المرحَّلة مستبعدة من التخصيص", listAfter.invoices.filter((i: { legacy: boolean; paidAmount: number }) => i.legacy && i.paidAmount > 0).length === 0);

  // 8) قيد السند: مدين صندوق 3000 + دائن ذمم 2770 (سطر لكل فاتورة) + دائن إيراد العقود 230
  const vdet = await api(`/api/vouchers/${vid}`);
  const jrow = vdet.voucher?.journals?.find((j: { sourceType: string }) => j.sourceType === "voucher");
  const entryNo = jrow?.entryNo;
  step("قيد السند مرتبط", !!entryNo, `#${entryNo}`);
  const jdet = await api(`/api/journal-entries/${entryNo}`);
  const lines = jdet.entry?.lines ?? [];
  const totalCreditAR = lines.filter((l: { accountCode: string }) => l.accountCode === "1121").reduce((s: number, l: { credit: number }) => s + Number(l.credit), 0);
  const totalCreditRev = lines.filter((l: { accountCode: string }) => l.accountCode === "4100").reduce((s: number, l: { credit: number }) => s + Number(l.credit), 0);
  step("دائن الذمم = المخصص", Math.abs(totalCreditAR - 2770) < KWD_EPS, `${totalCreditAR}`);
  step("دائن الإيراد = الفائض", Math.abs(totalCreditRev - 230) < KWD_EPS, `${totalCreditRev}`);
  const jBal = lines.reduce((s: number, l: { debit: number; credit: number }) => s + Number(l.debit) - Number(l.credit), 0);
  step("قيد السند متوازن", Math.abs(jBal) < KWD_EPS, `فرق ${jBal.toFixed(3)}`);

  // 9) إلغاء السند → يجب أن تعود الفاتورتان غير مسددتين
  await api(`/api/vouchers/${vid}/cancel`, { method: "POST", body: { reason: "فحص إعادة الفتح" } });
  const listAfterCancel = await api("/api/invoices");
  const c1 = listAfterCancel.invoices.find((i: { id: number }) => i.id === inv1.invoice.id);
  const c2 = listAfterCancel.invoices.find((i: { id: number }) => i.id === inv2.invoice.id);
  step("إلغاء السند يعيد الحالة", c1.paidAmount === 0 && c1.status === "unpaid" && c2.paidAmount === 0 && c2.status === "unpaid", `${c1.status}/${c2.status}`);

  // 10) سند قبض ثانٍ 2,500 (بالعقد) → تخصيص جزئي على فاتورة 2
  const v2 = await api("/api/vouchers", {
    method: "POST",
    body: {
      vtype: "receipt",
      vdate: new Date().toISOString().slice(0, 10),
      contractId,
      amount: 2500,
      method: "تحويل بنكي",
      description: "تحصيل جزئي",
    },
  });
  const v2id = v2.voucher?.id ?? v2.id;
  const listAfter2 = await api("/api/invoices");
  const p1 = listAfter2.invoices.find((i: { id: number }) => i.id === inv1.invoice.id);
  const p2 = listAfter2.invoices.find((i: { id: number }) => i.id === inv2.invoice.id);
  step("سند 2,500: فاتورة 1 كاملة + فاتورة 2 جزئية", Math.abs(p1.paidAmount - 770) < KWD_EPS && p1.status === "paid" && Math.abs(p2.paidAmount - 1730) < KWD_EPS && p2.status === "partial", `p2=${p2.paidAmount}`);

  // 11) تعديل فاتورة 2 (بنود جديدة) — عكس وإعادة نشر القيد
  const edited = await api(`/api/invoices/${inv2.invoice.id}`, {
    method: "PATCH",
    body: { items: [{ description: "أعمال كهرباء معدلة", quantity: 1, unitPrice: 1800, discountPct: 0 }] },
  });
  step("تعديل الصافي يقرأ القيد", Math.abs(edited.invoice.total - 1800) < KWD_EPS, `الصافي ${edited.invoice.total}`);
  const det2 = await api(`/api/invoices/${inv2.invoice.id}`);
  step("القيد الجديد منشور بعد التعديل", det2.entry?.status === "posted" && det2.entry.entryNo !== entry?.entryNo, `#${det2.entry?.entryNo}`);
  // المسدد 1730 ≤ 1800 — الحالة جزئية
  const p2b = det2.invoice;
  step("الحالة بعد التعديل محفوظة", p2b.status === "partial" && Math.abs(p2b.paidAmount - 1730) < KWD_EPS, `${p2b.status} · ${p2b.paidAmount}`);

  // 12) إلغاء فاتورة 1 (مسددة) يجب أن يُرفض
  let blocked = false;
  try {
    await api(`/api/invoices/${inv1.invoice.id}?action=void`, { method: "PATCH", body: { reason: "فحص الحاجز" } });
  } catch (e) {
    blocked = String(e).includes("مسددة");
  }
  step("رفض إلغاء فاتورة مسددة", blocked);

  // 13) إلغاء فاتورة 2 (جزئية 1730) يجب أن يُرفض أيضًا… المسددة جزئيًا محجوبة أيضًا
  let blocked2 = false;
  try {
    await api(`/api/invoices/${inv2.invoice.id}?action=void`, { method: "PATCH", body: { reason: "فحص الحاجز 2" } });
  } catch (e) {
    blocked2 = String(e).includes("مسددة");
  }
  step("رفض إلغاء فاتورة جزئية", blocked2);

  // 14) فاتورة 3 للإلغاء بقيد عكسي
  const inv3 = await api("/api/invoices", {
    method: "POST",
    body: {
      customerId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      items: [{ description: "أعمال ملغاة", quantity: 1, unitPrice: 999, discountPct: 0 }],
    },
  });
  const voided = await api(`/api/invoices/${inv3.invoice.id}?action=void`, {
    method: "PATCH",
    body: { reason: "فحص الإلغاء بقيد عكسي" },
  });
  step("إلغاء فاتورة بقيد عكسي", voided.voided === true, `عكس #${voided.reversedEntryId}`);
  const det3 = await api(`/api/invoices/${inv3.invoice.id}`);
  step("حالة الملغاة + القيد العكسي", det3.invoice.status === "void", det3.invoice.voidReason?.slice(0, 30));

  // 15) PDF
  const pdfRes = await fetch(`${BASE}/api/invoices/${inv1.invoice.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
  const isPdf = pdfRes.headers.get("content-type") === "application/pdf";
  const size = (await pdfRes.arrayBuffer()).byteLength;
  step("طباعة PDF برأس الشركة", isPdf && size > 5000, `${size} بايت`);

  // 16) ميزان الأستاذ: فرق 0
  const gl = await glBalance();
  const diff = Math.abs(gl.dr - gl.cr);
  step("ميزان الأستاذ متوازن", diff < KWD_EPS, `مدين ${gl.dr.toFixed(3)} / دائن ${gl.cr.toFixed(3)} · فرق ${diff.toFixed(3)}`);
  console.log(`   (قبل: ${gl0.dr.toFixed(3)}/${gl0.cr.toFixed(3)} — بعد: ${gl.dr.toFixed(3)}/${gl.cr.toFixed(3)})`);

  console.log("\n===== نهاية التحقق E2E =====");
}

main().catch((e) => {
  console.error("فشل التحقق:", e);
  process.exitCode = 1;
});
