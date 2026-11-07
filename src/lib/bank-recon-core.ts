/**
 * Task 113 — التسوية البنكية: النواة النقية (بلا DB ولا جلسات)
 *
 * المنهجية المحاسبية:
 *  • كل بند كشف بنك (bank_lines.amount) إشارته: إيداع موجب / سحب سالب.
 *  • كل حركة دفتر على حساب البنك (JournalLine) إشارتها: مدين موجب / دائن سالب (اتفاقية debit-positive الموحدة).
 *  • بند متطابق = نفس الإشارة ونفس المبلغ (ضمن تسامح) ونافذة تاريخ مقبولة.
 *  • المعادلة: رصيد الكشف − رصيد الدفتر = Σ بنود الكشف غير المسجلة − Σ بنود الدفتر العالقة
 *    (تصلح متى ما اتفق الرصيدان الافتتاحيان — أي فائض يظهر «فرقًا غير مفسَّرًا» بصدق).
 *  • المطابقة حتمية (deterministic): نفس المدخلات ⇒ نفس النتيجة دائمًا.
 */

import { r3 } from "./accounting-journal";

// ==================== الأنواع ====================

export interface BankSideLine {
  id: number;
  cdate: string; // YYYY-MM-DD
  amount: number; // إشارة: إيداع + / سحب −
  descr: string;
}

export interface GlSideLine {
  id: number;
  entryId: number;
  entryNo: number;
  entryDate: string; // YYYY-MM-DD
  description: string;
  amount: number; // إشارة: مدين − دائن على حساب البنك
}

export interface BankMatchPair {
  bank: BankSideLine;
  gl: GlSideLine;
  diff: number; // r3(bank.amount − gl.amount)
  dayGap: number; // أيام بين تاريخي الكشف والقيد (قد يكون سالبًا)
}

export interface ReconTotals {
  bankLinesCount: number;
  glLinesCount: number;
  matchedCount: number;
  bankOnlyCount: number;
  bankOnlySum: number; // إشاري
  glOnlyCount: number;
  glOnlySum: number; // إشاري
  statementBalance: number;
  bookBalance: number;
  gap: number; // statementBalance − bookBalance
  explained: number; // bankOnlySum − glOnlySum
  unexplained: number; // gap − explained — يجب أن يكون صفرًا عند اتفاق الافتتاحيين
}

export interface ReconResult {
  pairs: BankMatchPair[];
  bankOnly: BankSideLine[];
  glOnly: GlSideLine[];
  totals: ReconTotals;
}

export interface ReconOptions {
  statementBalance: number;
  bookBalance: number;
  /** تسامح فرق المبلغ المقبول للمطابقة (0 = مطابقة تامة فقط) */
  tolerance?: number;
  /** نافذة فرق الأيام المقبولة بين تاريخ الكشف وتاريخ القيد */
  windowDays?: number;
}

// ==================== مساعدات ====================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** فرق الأيام بين تاريخين YYYY-MM-DD (a − b) */
export function dayDiff(a: string, b: string): number {
  const da = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const db = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((da - db) / 86_400_000);
}

function sortBank(lines: BankSideLine[]): BankSideLine[] {
  return [...lines].sort((a, b) => (a.cdate === b.cdate ? a.id - b.id : a.cdate < b.cdate ? -1 : 1));
}

function sortGl(lines: GlSideLine[]): GlSideLine[] {
  return [...lines].sort((a, b) =>
    a.entryDate === b.entryDate ? (a.entryNo === b.entryNo ? a.id - b.id : a.entryNo - b.entryNo) : a.entryDate < b.entryDate ? -1 : 1
  );
}

// ==================== المطابقة ====================

/**
 * المطابقة الحتمية على مرحلتين:
 *  1) مطابقة تامة: نفس المبلغ بالضبط (r3) — يُختار الأقرب تاريخًا ثم الأقدم.
 *  2) مطابقة متسامحة: |فرق المبلغ| ≤ tolerance — الأصغر فرقًا ثم الأقرب تاريخًا.
 * كل سطر يُطابق مرة واحدة (one-to-one) — لا يُطابق سطر دفتر مع بندين.
 */
export function reconcileBank(bankLines: BankSideLine[], glLines: GlSideLine[], opts: ReconOptions): ReconResult {
  const tolerance = Math.max(0, r3(opts.tolerance ?? 0));
  const windowDays = Math.max(0, Math.floor(opts.windowDays ?? 15));
  const bank = sortBank(bankLines).filter((l) => DATE_RE.test(l.cdate) && Number.isFinite(l.amount));
  const gl = sortGl(glLines).filter((l) => DATE_RE.test(l.entryDate) && Number.isFinite(l.amount));

  const glUsed = new Array<boolean>(gl.length).fill(false);
  const pairs: BankMatchPair[] = [];
  const matchedBankIds = new Set<number>();
  const bankOnly: BankSideLine[] = [];

  const inWindow = (bankDate: string, glDate: string) => Math.abs(dayDiff(bankDate, glDate)) <= windowDays;

  const pickGl = (b: BankSideLine, mode: "exact" | "tolerant"): number => {
    let best = -1;
    let bestKey: [number, number] | null = null; // [|فرق المبلغ|, |فرق الأيام|] — مقارنة معجمية
    for (let i = 0; i < gl.length; i++) {
      if (glUsed[i]) continue;
      if (!inWindow(b.cdate, gl[i].entryDate)) continue;
      const diff = r3(b.amount - gl[i].amount);
      if (mode === "exact" ? diff !== 0 : Math.abs(diff) > tolerance) continue;
      const key: [number, number] = [Math.abs(diff), Math.abs(dayDiff(b.cdate, gl[i].entryDate))];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = i;
        bestKey = key;
      }
    }
    return best;
  };

  // المرحلة 1 — المطابقة التامة أولًا (تحل الغموض قبل التسامح)
  for (const b of bank) {
    const i = pickGl(b, "exact");
    if (i >= 0) {
      glUsed[i] = true;
      matchedBankIds.add(b.id);
      pairs.push({ bank: b, gl: gl[i], diff: 0, dayGap: dayDiff(b.cdate, gl[i].entryDate) });
    }
  }
  // المرحلة 2 — المتسامح لما بقي
  for (const b of bank) {
    if (matchedBankIds.has(b.id)) continue;
    const i = pickGl(b, "tolerant");
    if (i >= 0) {
      glUsed[i] = true;
      matchedBankIds.add(b.id);
      pairs.push({ bank: b, gl: gl[i], diff: r3(b.amount - gl[i].amount), dayGap: dayDiff(b.cdate, gl[i].entryDate) });
    }
  }

  const matchedIds = new Set(pairs.map((p) => p.bank.id));
  for (const b of bank) if (!matchedIds.has(b.id)) bankOnly.push(b);
  const glOnly: GlSideLine[] = [];
  for (let i = 0; i < gl.length; i++) if (!glUsed[i]) glOnly.push(gl[i]);

  const bankOnlySum = r3(bankOnly.reduce((s, l) => s + l.amount, 0));
  const glOnlySum = r3(glOnly.reduce((s, l) => s + l.amount, 0));
  const statementBalance = r3(opts.statementBalance);
  const bookBalance = r3(opts.bookBalance);
  const gap = r3(statementBalance - bookBalance);
  const explained = r3(bankOnlySum - glOnlySum);

  const totals: ReconTotals = {
    bankLinesCount: bank.length,
    glLinesCount: gl.length,
    matchedCount: pairs.length,
    bankOnlyCount: bankOnly.length,
    bankOnlySum,
    glOnlyCount: glOnly.length,
    glOnlySum,
    statementBalance,
    bookBalance,
    gap,
    explained,
    unexplained: r3(gap - explained),
  };

  return { pairs, bankOnly, glOnly, totals };
}

// ==================== فحص الإقفال ====================

/** الإقفال الموثق يُرفض مع أي فرق غير مفسَّر — الصرامة هنا حماية لا عائق */
export function validateReconClose(totals: ReconTotals): { ok: boolean; error?: string } {
  if (totals.unexplained !== 0) {
    return {
      ok: false,
      error: `يوجد فرق غير مفسَّر قدره ${totals.unexplained} — سوِّ البنود المعلّقة أو صحّح رصيد الكشف قبل الإقفال.`,
    };
  }
  return { ok: true };
}

// ==================== النشر السريع لبنود الكشف غير المسجلة ====================

/**
 * بناء سطري القيد لبند كشف غير مسجل:
 *  • إيداع (+): مدين البنك / دائن الحساب المقابل (رسوم واردة؟ لا — الإيداع يعني دخل أو تحويل لنا)
 *  • سحب (−): مدين الحساب المقابل / دائن البنك (رسوم بنكية، فوائد مخصومة…)
 * اتجاه واحد صحيح محاسبيًا لكل إشارة — لا خيار يدوي للتقلب.
 */
export function buildQuickPostLines(
  bankAmount: number,
  bankAccountId: number,
  counterpartAccountId: number,
  lineDescription: string
): { accountId: number; debit: number; credit: number; description: string }[] {
  const amt = r3(Math.abs(bankAmount));
  if (amt === 0) throw new Error("بند الكشف صفر — لا معنى لقيد عليه.");
  if (bankAccountId === counterpartAccountId) throw new Error("الحساب المقابل يجب أن يختلف عن حساب البنك.");
  const desc = (lineDescription || "").trim();
  return bankAmount > 0
    ? [
        { accountId: bankAccountId, debit: amt, credit: 0, description: desc },
        { accountId: counterpartAccountId, debit: 0, credit: amt, description: desc },
      ]
    : [
        { accountId: counterpartAccountId, debit: amt, credit: 0, description: desc },
        { accountId: bankAccountId, debit: 0, credit: amt, description: desc },
      ];
}

// ==================== استيراد نص الكشف (عميل/خادم — نقي) ====================

export interface ParsedStatementLine {
  cdate: string; // YYYY-MM-DD
  amount: number; // إشاري: إيداع + / سحب −
  descr: string;
  raw: string;
}

export interface ParseStatementResult {
  lines: ParsedStatementLine[];
  skipped: number;
  skippedSamples: string[];
}

const DATE_CANDIDATE = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})/;

function normalizeStatementDate(raw: string): string | null {
  const t = raw.trim().replace(/\./g, "/");
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return null;
  }
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return null;
  }
  return null;
}

function parseStatementAmount(raw: string): number | null {
  let t = raw.trim();
  if (!t) return null;
  // أقواس = سالب (صيغة كشوف شائعة) — والأرقام العربية لا تُقبل هنا (الكشوف لاتينية)
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith("-")) { neg = true; t = t.slice(1); }
  t = t.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n === 0) return null;
  return neg ? -r3(n) : r3(n);
}

/**
 * تحليل نص كشف بنك ملصوق/CSV: سطر لكل بند — الأعمدة بفاصلة أو Tab.
 * يتعرف على التاريخ (يوم/شهر/سنة أو العكس) والمبلغ (بإشارته أو أقواس) والباقي بيانًا.
 * صارم: السطور غير المفهومة تُتخطى وتُعاد عيناتها للمراجعة — لا تخمين مالي.
 */
export function parseStatementText(text: string): ParseStatementResult {
  const lines: ParsedStatementLine[] = [];
  const skippedSamples: string[] = [];
  let skipped = 0;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw) continue;
    const cells = raw.includes("\t") ? raw.split("\t") : raw.split(",");
    if (cells.length < 2) { skipped += 1; if (skippedSamples.length < 5) skippedSamples.push(raw.slice(0, 60)); continue; }

    let dateStr = "";
    let amount = null as number | null;
    const rest: string[] = [];
    for (const c of cells) {
      const cell = c.trim();
      if (!dateStr && DATE_CANDIDATE.test(cell)) {
        const norm = normalizeStatementDate(cell);
        if (norm) { dateStr = norm; continue; }
      }
      if (amount === null) {
        const n = parseStatementAmount(cell);
        if (n !== null) { amount = n; continue; }
      }
      rest.push(cell);
    }
    if (!dateStr || amount === null) {
      skipped += 1;
      if (skippedSamples.length < 5) skippedSamples.push(raw.slice(0, 60));
      continue;
    }
    lines.push({ cdate: dateStr, amount, descr: rest.join(" ").replace(/\s+/g, " ").trim().slice(0, 160), raw: raw.slice(0, 160) });
  }

  return { lines, skipped, skippedSamples };
}
