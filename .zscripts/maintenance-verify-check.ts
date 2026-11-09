/**
 * maintenance-verify-check — التحقق الحي المرحلي (docs/maintenance-design.md §8.5) بأرقام محسوبة:
 * phase1: بعد البذر والإدخال والعقد والخطة — البذر المؤجل + القيد + الأحداث الثلاثة + «متأخر»
 * phase2: بعد MO-0001 والصرف والإنهاء والفاتورة والسند — القيود الثلاثة والأرصدة والربط
 * phase3: بعد الرفض وإلغاء الإذن وإلغاء الأمر وتعديل الخطة والتخطي — العكس والاشتقاقية
 * الاستخدام: DATABASE_URL=... bun .zscripts/maintenance-verify-check.ts <phase>
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
  const companyId = Number(process.env.MAINT_VERIFY_COMPANY_ID || "1");

  if (phase === "phase1") {
    // ===== البذر المؤجل (د2) =====
    const maintType = await db.contractType.findFirst({ where: { companyId, isMaintenance: true } });
    check("نوع «صيانة دورية» مبذور وموسوم", maintType ? [maintType.name, maintType.manualTrack] : null, ["صيانة دورية", true]);

    // ===== الإدخال النقدي 20 @1.500 = 30.000 (قيد مدين 1160/دائن صندوق) =====
    const accByCode = new Map(
      (await db.account.findMany({ where: { companyId }, select: { id: true, code: true } })).map((a) => [a.code, a.id])
    );
    const STOCK = accByCode.get("1160");
    const CASH = accByCode.get("1111");
    check("حساب 1160 مبذور", !!STOCK, true);
    const wiEntry = await db.journalEntry.findFirst({
      where: { companyId, sourceType: "inventory_entry" },
      include: { lines: { orderBy: { sort: "asc" } } },
    });
    check("قيد الإدخال المخزني (مدين 1160 30/دائن صندوق 30)",
      wiEntry?.lines.map((l) => ({ a: l.accountId, d: Number(l.debit), c: Number(l.credit) })),
      [{ a: STOCK, d: 30, c: 0 }, { a: CASH, d: 0, c: 30 }]);
    const wi = await db.stockDoc.findFirst({ where: { companyId, kind: "entry", entrySource: "cash" }, include: { lines: true } });
    check("إذن الإدخالWI بقيمة 30", wi ? Number(wi.totalAmount) : null, 30);
    check("سطر الإدخال 20 @1.500", wi?.lines.length ? [Number(wi.lines[0].qty), Number(wi.lines[0].snapUnitCost)] : null, [20, 1.5]);

    // ===== عقد الصيانة 360.000 =====
    const contract = await db.contract.findFirst({ where: { companyId, contractType: "صيانة دورية" } });
    check("عقد الصيانة بقيمة 360", contract ? Number(contract.amount) : null, 360);
    check("العقد نشط وmanualTrack بلا مراحل", contract ? [contract.status, (await db.contractStage.count({ where: { contractId: contract.id } }))] : null, ["نشط", 0]);

    // ===== الخطة والأحداث (د5 — الفحص بعد كامل السيناريو: الفاصل عُدّل إلى 2 وأُعيد التوليد) =====
    const plan = await db.maintenancePlan.findFirst({ where: { companyId, contractId: contract?.id } });
    check("الخطة نشطة بعدد 3 والفاصل النهائي 2 (بعد تعديل د5)", plan ? [plan.active, plan.occurrencesCount, plan.intervalMonths] : null, [true, 3, 2]);
    const occs = await db.maintenanceOccurrence.findMany({
      where: { companyId, planId: plan?.id },
      orderBy: { dueDate: "asc" },
    });
    check("أحداث مولّدة ثلاثة", occs.length, 3);
    if (occs.length === 3 && contract && plan) {
      const addMonths = (iso: string, n: number) => {
        const [y, m, d] = iso.split("-").map(Number);
        const t = y * 12 + (m - 1) + n;
        const ny = Math.floor(t / 12);
        const nm = (t % 12) + 1;
        const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
        return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
      };
      const anchor = occs[0].dueDate;
      // المحفوظ من التوليد الأول = أصل الخطة، والمولّدان بعد التعديل بالفاصل الجديد من الارتكاز (د5)
      check("الأحداث النهائية: الارتكاز + فاصلان + أربعة أشهر", occs.map((o) => o.dueDate), [anchor, addMonths(anchor, 2), addMonths(anchor, 4)]);
      check("أصل الخطة = تاريخ بدايتها (المحفوظ من التوليد الأول)", anchor, plan.startDate);
      const today = new Date().toISOString().slice(0, 10);
      check("الحدث الأول متأخر (بلا أمر وخطة نشطة وتاريخه فات)", occs[0].dueDate < today, true);
    }
  }

  if (phase === "phase2") {
    // ===== MO-0001 من الحدث المتأخر (د3/د7) =====
    const contract = await db.contract.findFirst({ where: { companyId, contractType: "صيانة دورية" } });
    const plan = await db.maintenancePlan.findFirst({ where: { companyId, contractId: contract?.id } });
    const occ1 = (await db.maintenanceOccurrence.findMany({ where: { companyId, planId: plan?.id }, orderBy: { dueDate: "asc" } }))[0];
    const mo1 = await db.workOrder.findFirst({ where: { companyId, docNumber: "MO-0001" } });
    check("MO-0001 موجود ومرتبط بالحدث الأول", mo1 ? [mo1.contractId === contract?.id, mo1.occurrenceId === occ1?.id] : null, [true, true]);
    check("MO-0001 مجدول بموعد الحدث", mo1 ? mo1.scheduledDate : null, occ1?.dueDate);
    check("MO-0001 بفني", mo1 ? (mo1.technicianId ?? 0) > 0 : null, true);

    // ===== صرف المواد 4 فلتر @1.500 = 6.000 (د8 — بمحرك المخازن) =====
    const accByCode = new Map(
      (await db.account.findMany({ where: { companyId }, select: { id: true, code: true } })).map((a) => [a.code, a.id])
    );
    const M5110 = accByCode.get("5110");
    const STOCK = accByCode.get("1160");
    // إذن MO-0001 المنشور تحديدًا (إذن MO-0002 الملغى موجود أيضًا بعد كامل السيناريو) والقيد برقمه المرفق — حتمية
    const woDoc = await db.stockDoc.findFirst({ where: { companyId, kind: "issue", status: "posted" }, include: { lines: true } });
    const issueEntry = woDoc?.journalEntryId
      ? await db.journalEntry.findUnique({ where: { id: woDoc.journalEntryId }, include: { lines: { orderBy: { sort: "asc" } } } })
      : null;
    check("قيد الصرف (مدين 5110 ببُعد العقد 6/دائن 1160 6)",
      issueEntry?.lines.map((l) => ({ a: l.accountId, d: Number(l.debit), c: Number(l.credit), contract: l.contractId })),
      [{ a: M5110, d: 6, c: 0, contract: contract?.id }, { a: STOCK, d: 0, c: 6, contract: null }]);
    check("إذن الصرف بقيمة 6", woDoc ? Number(woDoc.totalAmount) : null, 6);
    check("لقطة السطر 4 @1.500", woDoc?.lines.length ? [Number(woDoc.lines[0].qty), Number(woDoc.lines[0].snapUnitCost)] : null, [4, 1.5]);
    check("الإذن مرتبط بالأمر وبقيد مرفق", woDoc ? [mo1?.materialsDocId === woDoc.id, !!woDoc.journalEntryId] : null, [true, true]);

    // ===== الأرصدة الاشتقاقية =====
    const lines = await db.stockDocLine.findMany({ where: { companyId }, include: { doc: true } });
    let q = 0, v = 0;
    for (const l of lines) {
      if (l.doc.status === "cancelled") continue;
      const sign = l.doc.kind === "issue" ? -1 : 1;
      q += sign * Number(l.qty);
      v += sign * Number(l.amount);
    }
    check("رصيد الفلتر 16/24.000", [Math.round(q * 1000) / 1000, Math.round(v * 1000) / 1000], [16, 24]);

    // ===== الإنهاء واشتقاق الحدث (د4/د6) =====
    const mo1b = await db.workOrder.findFirst({ where: { companyId, docNumber: "MO-0001" } });
    check("MO-0001 منجز بتاريخ اليوم", mo1b ? [mo1b.status, mo1b.completedAt] : null, ["منجزة", new Date().toISOString().slice(0, 10)]);
    const occ1b = await db.maintenanceOccurrence.findFirst({ where: { companyId, id: occ1?.id }, include: { workOrder: { select: { status: true } } } });
    check("الحدث الأول اشتقاقيًا «منجزة»", occ1b ? occ1b.workOrder?.status : null, "منجزة");

    // ===== فاتورة الزيارة 120.000 (=360÷3) وسقف الفوترة (د9) =====
    const inv = await db.invoice.findFirst({ where: { companyId, contractId: contract?.id } });
    check("الفاتورة على العقد بمبلغ 120", inv ? Number(inv.total) : null, 120);
    check("الفاتورة مرتبطة بالأمر", inv ? mo1b?.invoiceId === inv.id : null, true);
    const issueEntry2 = await db.journalEntry.findFirst({
      where: { companyId, sourceType: "invoice" },
      include: { lines: { orderBy: { sort: "asc" } } },
    });
    const AR = accByCode.get("1121");
    const REV = accByCode.get("4100");
    check("قيد الإصدار (مدين ذمم 120/دائن إيراد 120)",
      issueEntry2?.lines.map((l) => ({ a: l.accountId, d: Number(l.debit), c: Number(l.credit) })),
      [{ a: AR, d: 120, c: 0 }, { a: REV, d: 0, c: 120 }]);

    // ===== سند القبض 120 والتخصيص FIFO =====
    const rv = await db.voucher.findFirst({ where: { companyId, vtype: "receipt" } });
    check("سند القبض RV بقيمة 120", rv ? Number(rv.amount) : null, 120);
    const link = await db.invoicePaymentLink.findFirst({ where: { companyId } });
    check("رابط التخصيص FIFO 120", link ? Number(link.amount) : null, 120);
    const invB = await db.invoice.findFirst({ where: { companyId, contractId: contract?.id } });
    check("الفاتورة مدفوعة", invB?.status, "paid");

    // ===== تكلفة مواد العقد (من الأسطر المجففة — د8 المخازن) =====
    const docs = await db.stockDoc.findMany({ where: { companyId, status: "posted" } });
    let mcost = 0;
    for (const d of docs) {
      if (d.contractId !== contract?.id) continue;
      if (d.kind === "issue") mcost += Number(d.totalAmount);
      else if (d.kind === "entry" && d.entrySource === "return") mcost -= Number(d.totalAmount);
    }
    check("مواد العقد 6.000 (تقرأ بالربحية كما هي — د12)", Math.round(mcost * 1000) / 1000, 6);
  }

  if (phase === "phase3") {
    // ===== MO-0002: الرفض ثم إلغاء الإذن ثم إلغاء الأمر (د8) =====
    const mo2 = await db.workOrder.findFirst({ where: { companyId, docNumber: "MO-0002" } });
    check("MO-0002 ملغى بسبب موثق", mo2 ? [mo2.status, (mo2.cancelReason || "").length > 0] : null, ["ملغاة", true]);
    // إذنه أُلغي من المخازن بعكس قيده
    const accByCode = new Map(
      (await db.account.findMany({ where: { companyId }, select: { id: true, code: true } })).map((a) => [a.code, a.id])
    );
    const STOCK = accByCode.get("1160");
    const M5110 = accByCode.get("5110");
    const reversal = await db.journalEntry.findFirst({
      where: { companyId, sourceType: "reversal" },
      include: { lines: { orderBy: { sort: "asc" } } },
    });
    check("قيد العكس (مدين 1160 3/دائن 5110 3) — بمقارنة غير حساسة للترتيب",
      reversal?.lines.map((l) => ({ a: l.accountId, d: Number(l.debit), c: Number(l.credit) })).sort((x, y) => x.a - y.a),
      [{ a: STOCK, d: 3, c: 0 }, { a: M5110, d: 0, c: 3 }].sort((x, y) => x.a - y.a));
    const woDoc2 = await db.stockDoc.findFirst({ where: { companyId, kind: "issue", status: "cancelled" } });
    check("إذن MO-0002 ملغى", !!woDoc2, true);

    // ===== الأرصدة عادت (16/24) =====
    const lines = await db.stockDocLine.findMany({ where: { companyId }, include: { doc: true } });
    let q = 0, v = 0;
    for (const l of lines) {
      if (l.doc.status === "cancelled") continue;
      const sign = l.doc.kind === "issue" ? -1 : 1;
      q += sign * Number(l.qty);
      v += sign * Number(l.amount);
    }
    check("رصيد الفلتر عاد 16/24.000", [Math.round(q * 1000) / 1000, Math.round(v * 1000) / 1000], [16, 24]);

    // ===== تعديل الخطة (فاصل 2) — المنجز يبقى والمعلق يُعاد (د5) =====
    const plan = await db.maintenancePlan.findFirst({ where: { companyId } });
    check("الفاصل الجديد 2", plan?.intervalMonths, 2);
    const occs = await db.maintenanceOccurrence.findMany({
      where: { companyId, planId: plan?.id },
      orderBy: { dueDate: "asc" },
      include: { workOrder: { select: { status: true } } },
    });
    const done = occs.filter((o) => o.workOrder?.status === "منجزة");
    const skipped = occs.filter((o) => o.skipped);
    const pending = occs.filter((o) => !o.skipped && (!o.workOrder || o.workOrder.status === "ملغاة"));
    check("المنجز محفوظ (حدث واحد بأمر منجز)", done.length, 1);
    check("حدث متخطى بعلمه الصريح", skipped.length, 1);
    check("المجدول المتبقي واحد بعد التخطي (المتخطى يخرج من المجدولة)", pending.length, 1);
    if (pending.length === 1 && done.length === 1 && skipped.length === 1) {
      const anchor = done[0].dueDate;
      const addMonths = (iso: string, n: number) => {
        const [y, m, d] = iso.split("-").map(Number);
        const t = y * 12 + (m - 1) + n;
        const ny = Math.floor(t / 12);
        const nm = (t % 12) + 1;
        const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
        return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
      };
      check("المتخطى على أول موعد معاد (الارتكاز+فاصل)", skipped[0].dueDate, addMonths(anchor, 2));
      check("المتبقي على الموعد الثاني (الارتكاز+فاصلان)", pending[0].dueDate, addMonths(anchor, 4));
    }
  }

  await db.$disconnect();
  console.log(fails === 0 ? `\n🎉 ${phase}: كل الفحوص خضراء` : `\n💥 ${phase}: ${fails} فحصًا أحمر`);
  if (fails > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
