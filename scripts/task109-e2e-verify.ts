/**
 * تحقق E2E شامل لمهمة 109 — جلسة واحدة (درس T106: العمليات الخلفية تُقتل بين الاستدعاءات).
 * الدورة كاملة: قراءة الفترات → قفل/فتح شهر → إقفال سنوي ذري (قيد + قفل فترات + افتتاح 2027
 * + سجل موثق) → رفض النشر على فترة مقفلة من المحرك → افتتاحية 2027 متوازنة → حواجز إعادة
 * الفتح → إعادة فتح موثقة → إقفال نهائي يُترك حالة عرض حية.
 */
const BASE = "http://localhost:3000";
const EPS = 0.001;

let token = "";
async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, ok: res.ok };
}

function step(name: string, cond: boolean, detail = "") {
  const mark = cond ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function glTotal(): Promise<{ dr: number; cr: number }> {
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
    body: JSON.stringify({ username: "raheem", password: "Contrack@108" }),
  }).then((r) => r.json());
  token = login.token;
  step("دخول raheem (مدير)", !!token, login.user?.role || "");

  const gl0 = await glTotal();
  step("ميزان الأستاذ متوازن قبل الإجراءات", Math.abs(gl0.dr - gl0.cr) < EPS, `مدين ${gl0.dr} / دائن ${gl0.cr}`);

  // 2) قراءة الفترات
  const fp = await api("/api/fiscal-periods");
  step("GET /api/fiscal-periods 200", fp.ok, `${fp.data?.years?.length || 0} سنة`);
  const y2026 = (fp.data.years as Array<{ year: number; status: string; periods: Array<{ id: number; periodDate: string; status: string; entriesCount: number }> }>).find((y) => y.year === 2026);
  const y2027 = fp.data.years.find((y: { year: number }) => y.year === 2027);
  step("سنة 2026 بفتراتها الاثني عشر", !!y2026 && y2026.periods.length === 12);
  step("نتيجة 2026 من الأستاذ = 2620 / 0.150 / 2619.850", y2026 && Math.abs(y2026.pnl?.totalRevenue - 2620) < EPS && Math.abs(y2026.pnl?.totalExpense - 0.15) < EPS, JSON.stringify(y2026?.pnl));
  step("سنة 2027 موجودة مفتوحة", !!y2027 && y2027.status === "open");

  // 3) قفل شهر بلا قيود ثم إعادة فتحه بسبب موثق
  const aug = y2026!.periods.find((p) => p.periodDate === "2026-08")!;
  const closeAug = await api("/api/fiscal-periods", { method: "POST", body: { periodId: aug.id, action: "close" } });
  step("قفل أغسطس 2026 (مدير)", closeAug.ok, JSON.stringify(closeAug.data?.period || closeAug.data));
  const reopenAug = await api("/api/fiscal-periods", {
    method: "POST",
    body: { periodId: aug.id, action: "open", reason: "اختبار إعادة الفتح — سكربت التحقق" },
  });
  step("إعادة فتح أغسطس بسبب موثق", reopenAug.ok);
  const augAfter = await api("/api/fiscal-periods");
  const aug2 = augAfter.data.years.find((y: { year: number }) => y.year === 2026).periods.find((p: { periodDate: string }) => p.periodDate === "2026-08");
  step("أغسطس مفتوح مجددًا بعد الدورة", aug2?.status === "open");

  // 4) الإقفال السنوي الذري لسنة 2026
  const closeY = await api("/api/fiscal-periods/close-year", {
    method: "POST",
    body: { action: "close", year: 2026, notes: "إقفال التحقق الآلي — سنة الاختبار" },
  });
  step("POST close-year 2026", closeY.ok, JSON.stringify(closeY.data || closeY.data?.error));
  const cl = closeY.data;
  step("نتيجة الإقفال موثقة بأرقامها", cl?.closed && Math.abs(cl.totalRevenue - 2620) < EPS && Math.abs(cl.totalExpense - 0.15) < EPS && Math.abs(cl.net - 2619.85) < EPS, `entryNo ${cl?.entryNo} · أسطر ${cl?.linesCount}`);

  // 5) فحوص القاعدة بعد الإقفال
  const gl1 = await glTotal();
  step("الميزان ما زال متوازنًا بعد الإقفال", Math.abs(gl1.dr - gl1.cr) < EPS, `فرق ${(gl1.dr - gl1.cr).toFixed(3)}`);
  const { PrismaClient } = await import("@prisma/client");
  const p = new PrismaClient();
  const closingEntry = await p.journalEntry.findFirst({
    where: { sourceType: "closing", status: "posted" },
    include: { lines: { orderBy: { sort: "asc" }, include: { account: { select: { code: true, name: true, type: true } } } } },
  });
  step("قيد إغلاق منشور بتاريخ 2026-12-31", !!closingEntry && closingEntry.entryDate === "2026-12-31", `#${closingEntry?.entryNo}`);
  const eDr = closingEntry ? closingEntry.lines.reduce((s, l) => s + Number(l.debit), 0) : 0;
  const eCr = closingEntry ? closingEntry.lines.reduce((s, l) => s + Number(l.credit), 0) : 0;
  step("قيد الإغلاق متوازن 2620/2620", Math.abs(eDr - 2620) < EPS && Math.abs(eCr - 2620) < EPS, `مدين ${eDr.toFixed(3)} / دائن ${eCr.toFixed(3)}`);
  const revLine = closingEntry?.lines.find((l) => l.account.code === "4100");
  const expLine = closingEntry?.lines.find((l) => l.account.type === "expense");
  const retLine = closingEntry?.lines.find((l) => l.account.code === "3300");
  step("أسطر الإقفال: مدين الإيراد / دائن المصروف / دائن المحتجزة", revLine?.debit?.toNumber?.() === 2620 && Number(expLine?.credit ?? 0) === 0.15 && Math.abs(Number(retLine?.credit ?? 0) - 2619.85) < EPS);
  const fp2026 = await p.fiscalPeriod.findMany({ where: { periodDate: { startsWith: "2026" } }, select: { periodDate: true, status: true } });
  step("فترات 2026 كلها مقفلة", fp2026.length === 12 && fp2026.every((x) => x.status === "closed"));
  const fy2026 = await p.fiscalYear.findFirst({ where: { year: 2026 }, select: { status: true } });
  step("صف السنة 2026 مقفل", fy2026?.status === "closed");
  const fy2027p = await p.fiscalYear.findFirst({ where: { year: 2027 }, include: { periods: true } });
  step("سنة 2027 افتُتحت بـ12 فترة مفتوحة", fy2027p?.periods.length === 12 && fy2027p.periods.every((x) => x.status === "open"));
  const rec = await p.fiscalClosing.findFirst({ where: { year: 2026 } });
  step("سجل الإقفال موثق بلاSnapshot افتتاحية", !!rec && rec.status === "closed" && rec.openingSnapshot != null && Math.abs(Number(rec.netResult) - 2619.85) < EPS, `بواسطة ${rec?.closedBy}`);
  const audits = await p.auditLog.findMany({ where: { action: { in: ["fiscal_year_close", "fiscal_period_toggle"] } }, orderBy: { id: "desc" }, take: 5 });
  step("تدقيق الإقفال وتبديل الفترات موثق", audits.length >= 2, audits.map((a) => a.action).join(","));

  // 6) المحرك يرفض النشر على فترة مقفلة
  const manual = await api("/api/journal-entries", {
    method: "POST",
    body: {
      entryDate: "2026-06-15",
      description: "محاولة نشر على سنة مقفلة",
      lines: [
        { accountId: retLine!.accountId, debit: 10, credit: 0, description: "مدين" },
        { accountId: revLine!.accountId, debit: 0, credit: 10, description: "دائن" },
      ],
    },
  });
  step("المحرك يرفض قيدًا جديدًا بتاريخ 2026 (فترة مقفلة)", manual.status === 400 && String(manual.data?.error || "").includes("مقفلة"), manual.data?.error || `status ${manual.status}`);

  // 7) افتتاحية 2027
  const opening = await api("/api/fiscal-periods/opening?year=2027");
  step("GET opening 2027", opening.ok, `${opening.data?.result?.rows?.length || 0} سطرًا`);
  const ot = opening.data.result.totals;
  step("افتتاحية 2027 متوازنة وبلا أسطر دخل", Math.abs(ot.diff) < EPS && !(opening.data.result.rows as Array<{ type: string }>).some((r) => r.type === "revenue" || r.type === "expense"), `مدين ${ot.debit.toFixed(3)} / دائن ${ot.credit.toFixed(3)}`);
  step("الافتتاحية تحمل الأرباح المحتجزة 2619.85+", (opening.data.result.rows as Array<{ code: string; net: number }>).some((r) => r.code === "3300" && r.net > 2619));

  // 8) حواجز إعادة الفتح
  const reopenWrongOrder = await api("/api/fiscal-periods/close-year", { method: "POST", body: { action: "reopen", year: 2027, reason: "x" } });
  step("رفض إعادة فتح سنة غير مقفلة", !reopenWrongOrder.ok, reopenWrongOrder.data?.error || `status ${reopenWrongOrder.status}`);

  // 9) إعادة فتح 2026 بسبب موثق
  const reopenY = await api("/api/fiscal-periods/close-year", {
    method: "POST",
    body: { action: "reopen", year: 2026, reason: "اختبار إعادة الفتح — سكربت التحقق" },
  });
  step("إعادة فتح 2026", reopenY.ok, JSON.stringify(reopenY.data || reopenY.data?.error));
  const cancelled = await p.journalEntry.findFirst({ where: { id: closingEntry!.id }, select: { status: true, cancelReason: true } });
  step("قيد الإغلاق أُلغي بسبب موثق", cancelled?.status === "cancelled" && (cancelled.cancelReason || "").includes("2026"));
  const periodsAfterReopen = await p.fiscalPeriod.findMany({ where: { periodDate: { startsWith: "2026" } }, select: { status: true } });
  step("فترات 2026 فُتحت كلها", periodsAfterReopen.every((x) => x.status === "open"));
  const recAfter = await p.fiscalClosing.findFirst({ where: { year: 2026 } });
  step("السجل معلَّم معادًا للفتح بسبب موثق", recAfter?.status === "reverted" && !!recAfter.revertedAt && (recAfter.revertReason || "").length > 0);
  const gl2 = await glTotal();
  step("الميزان متوازن بعد إعادة الفتح (الإلغاء استبعد القيد)", Math.abs(gl2.dr - gl2.cr) < EPS, `فرق ${(gl2.dr - gl2.cr).toFixed(3)}`);

  // 10) الإقفال النهائي — حالة عرض حية تُترك للشاشة
  const finalClose = await api("/api/fiscal-periods/close-year", {
    method: "POST",
    body: { action: "close", year: 2026, notes: "إقفال سنة العرض النهائي — Task 109" },
  });
  step("إقفال نهائي لسنة 2026 (حالة الشاشة الحية)", finalClose.ok, `entryNo ${finalClose.data?.entryNo}`);
  const recFinal = await p.fiscalClosing.findFirst({ where: { year: 2026 } });
  step("السجل النهائي مقفل من جديد بقيد جديد", recFinal?.status === "closed" && recFinal.closingEntryId !== closingEntry!.id);
  const gl3 = await glTotal();
  step("الميزان النهائي متوازن", Math.abs(gl3.dr - gl3.cr) < EPS, `مدين ${gl3.dr.toFixed(3)} / دائن ${gl3.cr.toFixed(3)}`);
  await p.$disconnect();

  console.log(`\n=== ملخص: ${process.exitCode ? "فشل جزئي" : "كل الفحوص خضراء"} ===`);
}

main().catch((e) => {
  console.error("فشل السكربت:", e);
  process.exitCode = 1;
});
