/**
 * المحلل النقي للبرنامج الزمني (CPM Schedule) — docs/schedule-import-design.md §3.
 *
 * معاير على الملف الحقيقي (upload/البرنامج الزمني للمشروع.pdf — CPM Detailed Schedule-R01،
 * 24 صفحة، ≈600 نشطة، مستوصف صباح السالم الجنوبي — نفس مشروع BOQ المستورد CON-0001):
 *  - سطر النشطة: [كود] [اسم] [مدة] [ES] [EF] [LS] [LF] — بفواصل مسافات/Tab، وبعضها
 *    بتواريخ ناقصة (Milestones صفرية المدة تصل بسطرين فقط) فتُستكمل Late من Early.
 *  - أكواد ملتوية يجب تحمّلها (من الملف الحقيقي حرفياً):
 *      · اسم ملتصق بالكود: «U-GE-KMU-01006MUNICIPALITY CLEARANCE…» · «E-SD-G-SS-00110SUB.OF…»
 *      · شرطة ناقصة قبل الرقم: «P-GF-GR15004» → GR-15004
 *      · كود بلا شرطات كلياً: «ESDGSS-00310» (E-SD) · «PFFGG-16315» (P-FF) · «PFFF2-09000» (P-FF)
 *  - سطر الـband (WBS summary): بلا كود — الاسم + مدة + تواريخ (ويسبقه سطر الاسم وحده
 *    بلا تواريخ من الخلية المدمجة — يُسقط)، وآخر band قبل النشطة = المجموعة الحاوية.
 *  - زخارف الصفحة تُسقط كلها: رؤوس الأعمدة، أسطر شهر Gantt «N D J F M …» وسنواته،
 *    أزواج تواريخ الأشرطة بلا أسماء، Legend، تذييل الصفحة، سطر تاريخ المراجعة.
 *  - الميتا تُلتقط من التذييل: Project Start/Finish · Data Date · Revision (Detailed Schedule-R01).
 *
 * المطابقة بالأقسام (§4 — إشارتان بالترتيب):
 *  1. البند الحاوي — قاموس مرادفات الأسماء (CONCRETE WORK → «3» …).
 *  2. رقم النشطة نفسه — الأرقام في الملف الحقيقي من عائلة MasterFormat: 15100→صحي «22»،
 *     15200→إطفاء «23»، 15300→تكييف «21»، 16xxx→كهرباء «26»، 04100→بلوك «4» …
 *     (الرقم يحسم التفاصيل داخل band ميكانيكي واحد يضم الأسر الثلاثة).
 * الأكواد من عائلات بلا قيمة (E-SC/E-MA/E-SD/G/U/R-GE) بلا قسم — المرجع: جدول §1.
 *
 * نقية بلا db (مرآة boq-parse.ts) — تُختبر على حافظة نصية تركيبية.
 */

// ---------------- الأنواع ----------------

export interface ScheduleParsedActivity {
  activityCode: string; // كما ورد (بعد فصل الاسم الملتصق وتنظيف الشرطات)
  name: string;
  kind: ScheduleKind;
  family: string; // P-FL | E-MA | U-GE … من البادئة (المطبَّعة)
  durationDays: number;
  earlyStart: string; // YYYY-MM-DD
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  isSummary: boolean;
  groupName: string; // أقرب band حاوي (تقريبي — الـPDF يفقد الإزاحة)
  divisionCode: string; // من مطابقة القسم — فارغ لغير work أو غير المطابق
}

export type ScheduleKind =
  | "work" | "submittal" | "approval" | "procurement" | "shopdrawing"
  | "testing" | "authority" | "closeout" | "general" | "summary";

export interface ScheduleParseWarning {
  line: number; // 0 = عامة
  message: string;
}

export interface ScheduleParseMeta {
  projectStart: string;
  projectFinish: string;
  dataDate: string;
  revision: string; // R01 من تذييل الملف إن وُجد
  totalPages: number;
}

export interface ScheduleParseResult {
  activities: ScheduleParsedActivity[];
  meta: ScheduleParseMeta;
  warnings: ScheduleParseWarning[];
  counts: {
    total: number; // نشطة + bands
    work: number;
    summary: number;
    withDates: number; // نشاطات بتاريخين على الأقل
  };
}

// ---------------- أدوات التواريخ ----------------

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** «28-Feb-26» → «2026-02-28» — بلا اعتماد على locale (جدول أشهر ثابت) */
export function parseCpmDate(raw: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  const dd = m[1].padStart(2, "0");
  const yy = 2000 + Number(m[3]);
  return `${yy}-${mm}-${dd}`;
}

const DATE_RE = /\d{1,2}-[A-Za-z]{3}-\d{2}/g;

/** «GR15004» → «GR-15004» — شرطة ناقصة بين الحروف والرقم داخل مقطع الكود */
function fixMissingDash(seg: string): string {
  const m = /^([A-Z]{2,})(\d{2,})$/.exec(seg);
  return m ? `${m[1]}-${m[2]}` : seg;
}

/**
 * فصل الكود عن الاسم من بداية السطر — يلتزم الحالات الحقيقية:
 * «G-GE-GR-000 PROJECT…» · «U-GE-KMU-01006MUNICIPALITY…» · «P-GF-GR15004 EMBEDDED…»
 * «ESDGSS-00310 SUB. OF…» · «E-SD-G-SS-00110SUB.OF…» · «PFFGG-16315 INST. OF…»
 * يعيد null إن لم يبدأ السطر بكود نشطة (سطر band أو زخرفة).
 */
function splitCode(line: string): { code: string; rest: string } | null {
  // كود = حروف/أرقام/شرطات ثم رقم ختامي (2-6) ثم فراغ أو اسم ملتصق بحرف.
  // الأرقام الداخلية مسموحة (P-FA-D1-08310) — الكسل يوقف عند أول رقم ختامي يتبعه فراغ/حرف.
  const m = /^([A-Z][A-Z0-9-]{0,14}?)(\d{2,6})(?:\s+|(?=[A-Z]))(.*)$/.exec(line);
  if (!m) return null;
  const segs = m[1].replace(/-+$/, "").split("-").filter(Boolean).map(fixMissingDash);
  if (segs.length === 0) return null;
  const name = m[3].trim();
  if (!name) return null; // كود بلا اسم — زخرفة لا نشطة
  // الرقم الختامي جزء من الكود (كان مفقوداً — G-GE-GR-000 لا يصير G-GE-GR)
  return { code: `${segs.join("-")}-${m[2]}`, rest: name };
}

// ---------------- تصنيف العائلات ----------------

/** أمقطة العائلة من الكود المطبَّع — شرطات مفقودة تُلاحق بمطابقة بادئة بلا شرطات */
export function classifyFamily(code: string): { family: string; kind: ScheduleKind } {
  const flat = code.replace(/-/g, "");
  const tryFamily = (fam: string): boolean => flat.startsWith(fam.replace(/-/g, ""));
  const families: Array<[string, ScheduleKind]> = [
    ["P-FL", "work"], ["P-GF", "work"], ["P-FF", "work"], ["P-RF", "work"],
    ["P-ST", "work"], ["P-CV", "work"], ["P-FA", "work"], ["P-GE", "work"], ["X-GE", "work"],
    ["E-SC", "submittal"], ["E-MA", "procurement"], ["E-SD", "shopdrawing"],
    ["G-GE", "general"], ["U-GE", "authority"], ["R-GE", "closeout"], ["T-GE", "testing"],
  ];
  for (const [fam, kind] of families) {
    if (tryFamily(fam)) {
      // تفصيل الأنواع الفرعية داخل E-SC/E-MA: SS تسليم · AP اعتماد · PR شراء
      if (fam === "E-SC" || fam === "E-MA") {
        const rest = flat.slice(fam.replace(/-/g, "").length);
        if (rest.startsWith("AP")) return { family: fam, kind: "approval" };
        if (rest.startsWith("PR")) return { family: fam, kind: "procurement" };
        if (rest.startsWith("SS")) return { family: fam, kind: "submittal" };
      }
      return { family: fam, kind };
    }
  }
  return { family: flat.slice(0, 4), kind: "general" };
}

// ---------------- مطابقة الأقسام (§4) ----------------

/**
 * قاموس أسماء الـbands → قسم BOQ (divisionCode بالصيغة المخزنة: «3»/«22»/«26» …).
 * مطابقة نصية جزئية (بلا ربط بالبداية) لأن أسماء الملف الحقيقي مركّبة:
 * «MECH. (PLUMBING WORK)» · «ELEC. (FIRE ALARM)» · «WALL FINISHES (PLASTER)».
 */
const BAND_DIVISION: Array<[RegExp, string]> = [
  [/CONCRETE/i, "3"],
  [/MASONRY/i, "4"],
  [/METAL/i, "5"],
  [/THERMAL|MOISTURE|WATER PROOF|WATERPROOF|INSULATION/i, "7"],
  [/WOODEN|STEEL|ALUMINUM|CURTAIN|DOORS|WINDOWS|OPENINGS/i, "8"],
  [/FINISH|PAINT|TILING|FLOORING|CEILING|WALL FINISH/i, "9"],
  [/SPECIALT/i, "10"],
  [/FURNISH|FURNITURE/i, "12"],
  [/RADIATION|SPECIAL CONSTRUCTION/i, "13"],
  [/CONVEYING|ELEVATOR/i, "14"],
  [/HVAC|AIR COND/i, "21"],
  [/PLUMBING|DRAIN|WATER SUPPLY|STORM/i, "22"],
  // كهرباء قبل الإطفاء — «ELEC. (FIRE ALARM)» قسم كهرباء (26) في BOQ الحقيقي، والإطفاء 23 ميكيائي
  [/ELEC|POWER|LIGHTING|DATA|TELEPH|CCTV|PUBLIC ADDRESS|FIRE ALARM/i, "26"],
  [/F\.?F\b|FIRE (FIGHT|SUPPRESS)/i, "23"],
  [/EARTH|EXCAVATION|BACKFILL|SITE WORK|LANDSCAPE/i, "31"],
  [/EXTERIOR|EXTERNAL|CURBSTONE|INTERLOCK|PAVING/i, "32"],
  [/GENERAL|ENGINEERING|MOBILIZATION/i, "1"],
];

/**
 * مطابقة رقم النشطة — أرقام الملف الحقيقي من عائلة MasterFormat:
 * 151→صحي «22» · 152→إطفاء «23» · 153→تكييف «21» · 16→كهرباء «26» · 14→مصاعد «14»
 * · 01x→1x (01221→«12» · 01310→«13» · 01400→«14») · 005→«5» · 007→«7» · 0x→x (03000→«3»). 
 * يعيد قسمه أو "" — لا تخمين بعيد.
 */
export function numberDivision(num: string): string {
  if (/^151/.test(num)) return "22";
  if (/^152/.test(num)) return "23";
  if (/^153/.test(num)) return "21";
  if (/^16/.test(num)) return "26";
  if (/^14/.test(num)) return "14";
  const m01 = /^01(\d)/.exec(num); // 01221→12 · 01310→13 · 01400→14 · 01000→10
  if (m01) return m01[1] === "1" ? "" : `1${m01[1] === "0" ? "0" : m01[1]}`;
  if (/^005/.test(num)) return "5";
  if (/^007/.test(num)) return "7";
  if (/^008/.test(num)) return "8";
  if (/^009/.test(num)) return "9";
  const m0 = /^0(\d)/.exec(num); // 03000→3 · 04100→4 · 08100→8
  if (m0) return m0[1] === "0" ? "" : m0[1];
  return "";
}

/** رقم النشطة الختامي (آخر مقطع رقمي 4-5) — مفتاح المطابقة الرقمية */
function activityNumber(activityCode: string): string {
  return (/\d{4,5}$/.exec(activityCode) ?? [])[0] ?? "";
}

/** المطابقة النهائية — البند الحاوي أولاً، ثم الرقم يحسم، ثم اسم النشطة */
export function matchDivision(bandName: string, activityCode: string, name: string): string {
  for (const [re, div] of BAND_DIVISION) if (re.test(bandName)) return div;
  const num = activityNumber(activityCode);
  if (num) {
    const d = numberDivision(num);
    if (d) return d;
  }
  for (const [re, div] of BAND_DIVISION) if (re.test(name)) return div;
  return "";
}

// ---------------- الماسح النصي (PDF) ----------------

const NOISE_RE = [
  /^--\s*\d+\s*of\s*\d+\s*--$/i,
  /^Project (Start|Finish):/i,
  /^Data Date:/i,
  /^SABAH AL SALEM/i, // عنوان المشروع المتكرر (بالتواريخ أيضاً)
  /^CPM Detailed/i,
  /^Remaining (Work|Level)/i,
  /^Critical Remaining/i,
  /^Baseline Milestone/i,
  /^HISTORY OF/i,
  /^(Date|Revision|Checked|Approved)\b/i,
  /^(Activity ID|Activity Name|Original|Duration|Early Start|Late Start|Early Finish|Late Finish)\b/i,
  /^Legend/i,
];

/** سطر أشهر Gantt «N D J F M A M J J A S O …» — حروف مفردة مفصولة بمسافات */
const MONTH_LETTERS_RE = /^(?:[A-Z]\s+){4,}[A-Z]\s*$/;

function isNoise(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (NOISE_RE.some((re) => re.test(t))) return true;
  if (MONTH_LETTERS_RE.test(t)) return true;
  if (/^\d{4}(\s+\d{4})*$/.test(t)) return true; // سطر السنوات
  // أزواج تواريخ أشرطة Gantt بلا اسم: «28-Feb-26       27-May-27»
  const firstDate = DATE_RE.exec(t);
  if (firstDate && firstDate.index === 0) return true;
  return false;
}

/** آخر عدد صحيح مستقل قبل أول تاريخ — المدة */
function extractDuration(beforeDate: string): number | null {
  const m = /(?:^|\s)(\d{1,3})\s*$/.exec(beforeDate.trim());
  return m ? Number(m[1]) : null;
}

function cutNameBeforeDates(t: string): { namePart: string; dates: string[] } {
  const dates = t.match(DATE_RE) ?? [];
  const first = DATE_RE.exec(t);
  const namePart = (first ? t.slice(0, first.index) : t).trim();
  return { namePart, dates };
}

/**
 * المسح الرئيسي لنص PDF مستخرج (pdf-parse) — مرآة scanSheet في boq-parse.
 */
export function scanScheduleText(text: string): ScheduleParseResult {
  const activities: ScheduleParsedActivity[] = [];
  const warnings: ScheduleParseWarning[] = [];
  const meta: ScheduleParseMeta = { projectStart: "", projectFinish: "", dataDate: "", revision: "", totalPages: 0 };

  let currentGroup = "";
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) return;

    // ميتا التذييل — قبل فلترة الزخارف
    const ps = /^Project Start:\s*(\d{1,2}-[A-Za-z]{3}-\d{2})/.exec(line);
    if (ps) { meta.projectStart = parseCpmDate(ps[1]) ?? ""; return; }
    const pf = /^Project Finish:\s*(\d{1,2}-[A-Za-z]{3}-\d{2})/.exec(line);
    if (pf) { meta.projectFinish = parseCpmDate(pf[1]) ?? ""; return; }
    const dd = /^Data Date:\s*(\d{1,2}-[A-Za-z]{3}-\d{2})/.exec(line);
    if (dd) { meta.dataDate = parseCpmDate(dd[1]) ?? ""; return; }
    const rev = /Detailed Schedule-(R\d+)/i.exec(line);
    if (rev && !meta.revision) { meta.revision = rev[1]; }
    const pages = /CPM Detailed Schedule\s*\(\s*(\d+)\s*of\s*(\d+)\s*\)/i.exec(line);
    if (pages && Number(pages[2]) > meta.totalPages) meta.totalPages = Number(pages[2]);

    if (isNoise(line)) return;

    // 1) سطر نشطة بكود
    const withCode = splitCode(line.trim());
    if (withCode) {
      const { namePart, dates } = cutNameBeforeDates(withCode.rest);
      const duration = extractDuration(namePart);
      if (duration == null || dates.length < 2) {
        warnings.push({ line: i + 1, message: `سطر نشطة بتواريخ/مدة ناقصة: «${withCode.code}»` });
        return;
      }
      const es = parseCpmDate(dates[0]) ?? "";
      const ef = parseCpmDate(dates[1]) ?? "";
      const ls = dates.length > 2 ? (parseCpmDate(dates[2]) ?? es) : es;
      const lf = dates.length > 3 ? (parseCpmDate(dates[3]) ?? ef) : ef;
      const { family, kind } = classifyFamily(withCode.code);
      // استخراج الرقم التسلسلي للمطابقة
      activities.push({
        activityCode: withCode.code,
        name: namePart.replace(/\s*\d{1,3}\s*$/, "").trim() || namePart,
        kind, family,
        durationDays: duration,
        earlyStart: es, earlyFinish: ef, lateStart: ls, lateFinish: lf,
        isSummary: false,
        groupName: currentGroup,
        divisionCode: kind === "work" ? matchDivision(currentGroup, withCode.code, namePart) : "",
      });
      return;
    }

    // 2) سطر band بلا كود — اسم + مدة + تواريخ (سطر الاسم المجرد بلا تواريخ يُسقط هنا تلقائياً)
    const t = line.trim();
    const { namePart, dates } = cutNameBeforeDates(t);
    if (dates.length >= 2 && /[A-Za-z]{3}/.test(namePart)) {
      const duration = extractDuration(namePart) ?? 0;
      const es = parseCpmDate(dates[0]) ?? "";
      const ef = parseCpmDate(dates[1]) ?? "";
      const ls = dates.length > 2 ? (parseCpmDate(dates[2]) ?? es) : es;
      const lf = dates.length > 3 ? (parseCpmDate(dates[3]) ?? ef) : ef;
      const bandName = namePart.replace(/\s*\d{1,3}\s*$/, "").trim();
      currentGroup = bandName; // المجموعة الحاوية للأنشطة التالية
      activities.push({
        activityCode: "",
        name: bandName,
        kind: "summary", family: "",
        durationDays: duration,
        earlyStart: es, earlyFinish: ef, lateStart: ls, lateFinish: lf,
        isSummary: true, groupName: currentGroup, divisionCode: "",
      });
      return;
    }
    // 3) ما عدا ذلك: زخرفة بلا تواريخ (رؤوس/شروح) — تخطٍ صامت
  });

  // تحقق ختامي
  if (!meta.projectStart || !meta.projectFinish) {
    warnings.push({ line: 0, message: "لم تُلتقط تواريخ المشروع من التذييل (Project Start/Finish)" });
  }
  if (activities.filter((a) => !a.isSummary).length === 0) {
    warnings.push({ line: 0, message: "لا أنشطة في الملف — تأكد أن هذا ملف برنامج زمني CPM" });
  }

  const nonSummary = activities.filter((a) => !a.isSummary);
  return {
    activities,
    meta,
    warnings,
    counts: {
      total: activities.length,
      work: nonSummary.filter((a) => a.kind === "work").length,
      summary: activities.filter((a) => a.isSummary).length,
      withDates: nonSummary.filter((a) => a.earlyStart && a.earlyFinish).length,
    },
  };
}

// ---------------- قارئ Excel من Primavera ----------------

/**
 * قراءة Excel مصدَّر من Primavera — رؤوس متوقعة:
 * Activity ID · Activity Name · Original Duration · Early Start · Early Finish · Late Start · Late Finish
 * التواريخ كائنات Date أو نصوص DD-MMM-YY — كلاهما مقبول.
 */
export async function scanScheduleExcel(
  buffer: ArrayBuffer,
): Promise<ScheduleParseResult> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    return {
      activities: [], meta: { projectStart: "", projectFinish: "", dataDate: "", revision: "", totalPages: 0 },
      warnings: [{ line: 0, message: "ورقة فارغة" }],
      counts: { total: 0, work: 0, summary: 0, withDates: 0 },
    };
  }

  // خلية نص/تاريخ — التواريخ كائنات ExcelJS Date
  const cellText = (v: ExcelJS.CellValue): string => {
    if (v == null) return "";
    if (v instanceof Date) return fmtExcelDate(v);
    if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "").trim();
    if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "").trim();
    return String(v).trim();
  };
  const fmtExcelDate = (d: Date): string => {
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  // إيجاد صف الرؤوس — أول صف يحوي «Activity ID» أو «Activity Name»
  let headerRow = 0;
  const colIdx: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
    const row = ws.getRow(r);
    let found = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const t = String(cell.value ?? "").trim().toLowerCase();
      if (t === "activity id") { colIdx.code = col; found = true; }
      if (t === "activity name") colIdx.name = col;
      if (t.includes("duration")) colIdx.duration = col;
      if (t === "early start") colIdx.es = col;
      if (t === "early finish") colIdx.ef = col;
      if (t === "late start") colIdx.ls = col;
      if (t === "late finish") colIdx.lf = col;
    });
    if (found && colIdx.name) { headerRow = r; break; }
  }

  const activities: ScheduleParsedActivity[] = [];
  const warnings: ScheduleParseWarning[] = [];
  const meta: ScheduleParseMeta = { projectStart: "", projectFinish: "", dataDate: "", revision: "", totalPages: 0 };
  if (!headerRow) {
    return {
      activities: [], meta,
      warnings: [{ line: 0, message: "لم يُعثر على رؤوس Primavera (Activity ID / Activity Name)" }],
      counts: { total: 0, work: 0, summary: 0, withDates: 0 },
    };
  }

  let currentGroup = "";
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = colIdx.code ? cellText(row.getCell(colIdx.code).value) : "";
    const name = colIdx.name ? cellText(row.getCell(colIdx.name).value) : "";
    const durRaw = colIdx.duration ? cellText(row.getCell(colIdx.duration).value) : "";
    const esRaw = colIdx.es ? cellText(row.getCell(colIdx.es).value) : "";
    const efRaw = colIdx.ef ? cellText(row.getCell(colIdx.ef).value) : "";
    const lsRaw = colIdx.ls ? cellText(row.getCell(colIdx.ls).value) : "";
    const lfRaw = colIdx.lf ? cellText(row.getCell(colIdx.lf).value) : "";
    if (!code && !name) continue;
    if (!code) {
      // band — يعيّن المجموعة الحاوية
      if (name && /[A-Za-z]{3}/.test(name)) currentGroup = name;
      continue;
    }
    const duration = Number(durRaw) || 0;
    const es = parseCpmDate(esRaw) ?? (esRaw || "");
    const ef = parseCpmDate(efRaw) ?? (efRaw || "");
    const ls = parseCpmDate(lsRaw) ?? (lsRaw || es);
    const lf = parseCpmDate(lfRaw) ?? (lfRaw || ef);
    if (!es || !ef) warnings.push({ line: r, message: `نشطة بتواريخ ناقصة: «${code}»` });
    const { family, kind } = classifyFamily(code);
    activities.push({
      activityCode: code, name, kind, family, durationDays: duration,
      earlyStart: es, earlyFinish: ef, lateStart: ls, lateFinish: lf,
      isSummary: false, groupName: currentGroup,
      divisionCode: kind === "work" ? matchDivision(currentGroup, code, name) : "",
    });
  }

  if (activities.length === 0) warnings.push({ line: 0, message: "لا أنشطة في الورقة" });
  const nonSummary = activities;
  return {
    activities, meta, warnings,
    counts: {
      total: activities.length,
      work: nonSummary.filter((a) => a.kind === "work").length,
      summary: 0,
      withDates: nonSummary.filter((a) => a.earlyStart && a.earlyFinish).length,
    },
  };
}
