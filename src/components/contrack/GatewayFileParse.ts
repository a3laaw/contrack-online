/**
 * تحليل ملفات نصية (comma/tab/semicolon) لبوابة الدفع — منقولة حرفيًا من GatewayView
 * عند تحويل نوافذ الرفع إلى صفحات كاملة (لا تغيير منطق).
 */

export interface ParsedOp {
  opDate: string;
  phone: string;
  amount: string;
  ref: string;
}

export interface ParsedBankLine {
  cdate: string;
  amount: string;
  descr: string;
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  if (line.includes(";")) return line.split(";").map((s) => s.trim());
  return line.split(",").map((s) => s.trim());
}

/** توحيد خلية التاريخ إلى YYYY-MM-DD إن أمكن */
function normalizeDateCell(raw: string): string {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return s;
}

function parseNumCell(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const OP_HEADER_HINTS: { field: keyof ParsedOp; re: RegExp }[] = [
  { field: "opDate", re: /تاريخ|date/i },
  { field: "phone", re: /هاتف|جوال|phone|mobile/i },
  { field: "amount", re: /مبلغ|amount|قيمة/i },
  { field: "ref", re: /مرجع|ref|رقم العملي|reference|رقم العملية/i },
];

/** تحليل نص ملف تسديد البوابة: كشف صف ترويسة إن وجد وإلا افتراض أعمدة (تاريخ/هاتف/مبلغ/مرجع) */
export function parseOpsText(text: string): ParsedOp[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ParsedOp[] = [];
  let map: Partial<Record<keyof ParsedOp, number>> | null = null;

  for (const line of lines) {
    const cells = splitLine(line);
    if (!map) {
      const joined = cells.join(" ");
      const hits = OP_HEADER_HINTS.filter((h) => h.re.test(joined));
      if (hits.length >= 2) {
        const m: Partial<Record<keyof ParsedOp, number>> = {};
        for (const h of hits) {
          const idx = cells.findIndex((c) => h.re.test(c));
          if (idx >= 0) m[h.field] = idx;
        }
        map = m;
        continue;
      }
    }
    const get = (f: keyof ParsedOp): string => {
      const i = map?.[f];
      return i !== undefined && i < cells.length ? cells[i] : "";
    };
    const opDate = normalizeDateCell(map ? get("opDate") : (cells[0] ?? ""));
    const phone = (map ? get("phone") : (cells[1] ?? "")).replace(/[^\d+]/g, "");
    const amount = map ? get("amount") : (cells[2] ?? "");
    const amountNum = parseNumCell(amount);
    const ref = map ? get("ref") : (cells[3] ?? "");
    if (!opDate || !phone || amountNum === null) continue;
    rows.push({ opDate, phone, amount: String(amountNum), ref: ref || "" });
  }
  return rows;
}

const BANK_HEADER_HINTS: { field: keyof ParsedBankLine; re: RegExp }[] = [
  { field: "cdate", re: /تاريخ|date|cdate/i },
  { field: "amount", re: /مبلغ|amount|credit|إيداع|ايداع/i },
  { field: "descr", re: /وصف|بيان|descr|details|remarque/i },
];

/** تحليل كشف بنك نصي: إيداعات فقط (تاريخ/مبلغ/وصف) */
export function parseBankText(text: string): ParsedBankLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ParsedBankLine[] = [];
  let map: Partial<Record<keyof ParsedBankLine, number>> | null = null;

  for (const line of lines) {
    const cells = splitLine(line);
    if (!map) {
      const joined = cells.join(" ");
      const hits = BANK_HEADER_HINTS.filter((h) => h.re.test(joined));
      if (hits.length >= 2) {
        const m: Partial<Record<keyof ParsedBankLine, number>> = {};
        for (const h of hits) {
          const idx = cells.findIndex((c) => h.re.test(c));
          if (idx >= 0) m[h.field] = idx;
        }
        map = m;
        continue;
      }
    }
    const get = (f: keyof ParsedBankLine): string => {
      const i = map?.[f];
      return i !== undefined && i < cells.length ? cells[i] : "";
    };
    const cdate = normalizeDateCell(map ? get("cdate") : (cells[0] ?? ""));
    const amount = map ? get("amount") : (cells[1] ?? "");
    const amountNum = parseNumCell(amount);
    const descr = map ? get("descr") : (cells[2] ?? "");
    if (!cdate || amountNum === null) continue;
    rows.push({ cdate, amount: String(amountNum), descr: descr || "" });
  }
  return rows;
}
