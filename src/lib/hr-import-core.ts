// ============================================================
// ConTrack Online — HR-2: نواة محلل بصمة الحضور النقية (bun test فقط)
// قالب CSV/TXT: رقم وظيفي, التاريخ (YYYY-MM-DD), دخول, خروج, دخول2, خروج2
// — د6/د7 المعتمدان: نصي بلا مكتبات · الاستيراد لا يلمس الأيام اليدوية (تقرر في الخادم)
// docs/hr-2-design.md §5
// ============================================================

import { minutesOfTime } from "./hr-constants";

export interface ImportPunchRow {
  line: number; // رقم السطر في الملف (1-based — للتقرير)
  jobNumber: string; // كما ورد — يُحل لمعرف الموظف في الخادم
  workDate: string; // YYYY-MM-DD بعد التطبيع
  checkIn: string; // HH:MM بعد الدمج (الأبكر) — قد يكون ""
  checkOut: string; // HH:MM بعد الدمج (الأحدث) — قد يكون ""
}

export interface ImportRejectedRow {
  line: number;
  reason: string;
}

export interface ImportParseResult {
  rows: ImportPunchRow[];
  rejected: ImportRejectedRow[];
  totalLines: number; // أسطر البيانات المقروءة (بلا الفراغات)
}

/** تطبيع وقت متسامح: «8:5» ⇒ «08:05» · «08:05» كما هو · غير صالح ⇒ "" */
export function normalizeTimeToken(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (!m) return "";
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** تطبيع التاريخ: YYYY-MM-DD أو YYYY/MM/DD — غير ذلك "" (القالب موثق — لا تخمين اتجاهات) */
export function normalizeDateToken(s: string): string {
  const t = String(s ?? "").trim();
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * دمج البصمات: دخول = الأبكر من غير الفارغات · خروج = الأحدث — الوسطى تُتجاهل (موثق §5).
 * كلاهما فارغ ⇒ null (سطر بلا فائدة).
 */
export function mergePunches(
  ins: string[],
  outs: string[]
): { checkIn: string; checkOut: string } | null {
  const inMinutes = ins.map(minutesOfTime).filter((m): m is number => m != null);
  const outMinutes = outs.map(minutesOfTime).filter((m): m is number => m != null);
  if (inMinutes.length === 0 && outMinutes.length === 0) return null;
  const checkIn = inMinutes.length ? minutesToToken(Math.min(...inMinutes)) : "";
  const checkOut = outMinutes.length ? minutesToToken(Math.max(...outMinutes)) : "";
  return { checkIn, checkOut };
}

function minutesToToken(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * تحليل النص الكامل — نقي بلا DB:
 * • الفاصل: «;» إن وُجد بالسطر وإلا «,»
 * • سطر الترويجة يُكتشف (يحوي «رقم» أو «job» أو «date») ويُتخطى
 * • الأعمدة: رقم وظيفي [1] · التاريخ [2] · دخول/خروج/دخول2/خروج2 اختيارية
 */
export function parseAttendanceCsv(text: string): ImportParseResult {
  const rows: ImportPunchRow[] = [];
  const rejected: ImportRejectedRow[] = [];
  let totalLines = 0;
  const lines = String(text ?? "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    totalLines++;
    const lineNo = i + 1;
    const sep = raw.includes(";") ? ";" : ",";
    const cells = raw.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));

    if (cells.length < 3) {
      rejected.push({ line: lineNo, reason: `أعمدة غير كافية (${cells.length}) — القالب 3 أعمدة على الأقل` });
      continue;
    }
    // ترويجة؟
    const first = cells[0];
    if (/رقم|وظيفي|job|employee/i.test(first) && !/^\d+$/.test(first)) {
      continue; // ترويجة — لا تُعد ولا تُرفض
    }
    if (!/^\d+$/.test(first)) {
      rejected.push({ line: lineNo, reason: "الرقم الوظيفي يجب أن يكون رقمًا" });
      continue;
    }
    const workDate = normalizeDateToken(cells[1]);
    if (!workDate) {
      rejected.push({ line: lineNo, reason: "صيغة التاريخ غير صالحة — المطلوب YYYY-MM-DD أو YYYY/MM/DD" });
      continue;
    }
    const times = cells.slice(2, 6).map(normalizeTimeToken);
    const t4 = [times[0] ?? "", times[1] ?? "", times[2] ?? "", times[3] ?? ""];
    const badTime = cells.slice(2, 6).some((t, idx) => t.trim() && !times[idx]);
    if (badTime) {
      rejected.push({ line: lineNo, reason: "صيغة وقت غير صالحة — المطلوب HH:MM" });
      continue;
    }
    const merged = mergePunches([t4[0], t4[2]], [t4[1], t4[3]]);
    if (!merged) {
      rejected.push({ line: lineNo, reason: "سطر بلا أي بصمة صالحة" });
      continue;
    }
    rows.push({ line: lineNo, jobNumber: first, workDate, checkIn: merged.checkIn, checkOut: merged.checkOut });
  }

  return { rows, rejected, totalLines };
}
