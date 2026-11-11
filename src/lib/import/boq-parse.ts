/**
 * المحلل النقي لملفات BOQ (جدول الكميات) — docs/boq-import-design.md §2.2.
 *
 * مدروس ومُعاير على ملف حقيقي (upload/PAYMENT_-10-2026_معدل.xlsx — 23 ورقة، مستوصف كويتي):
 *  - رؤوس تسعير بمرادفات متعددة (Item No./ITEM/No./ser. No. · Qty./QTY · Unit Price/UNIT RATE…)
 *    تتكرر مع كل «صفحة» داخل الورقة الواحدة (نمط POMI المطبوع).
 *  - صيغ ترقيم: مدني «03.30.01» · عشري «6.1» · حرفي-عددي «B1-2» (أقسام MEP يعاد
 *    ترقيمها داخل القسم) · حرفي مسعّر «F1»/«PE»/«a» (بند قسم بسطر واحد).
 *  - **المبلغ = قيمة عمود الإجمالي الرقمية حصراً** — مرآة صيغ الملف نفسه (SUM على F)؛
 *    بنود «INCLUDED»/فارغة الإجمالي تدخل بسعرها المرجعي ومبلغ 0.
 *  - **الخلايا المدمجة عمودياً تُطفأ تبعيتها** — بند المصعد A19:F22 مدمج وكل صف يحمل
 *    سطر وصفه الخاص؛ بلا الإطفاء تتضاعف قيم البند على كل صف.
 *  - **صفحات مخزّنة تُلتزم عند نهايتها** ليصبح كشف ما يلي ممكناً قبل الالتزام:
 *      · صفحة Recap (مجموعها ≈ مجموع كل ما سبقها — «HVAC Work - 01…») تسقط عمداً.
 *      · صفحة منسوخة حرفياً (توقيع بنودها مطابق لصفحة سابقة) تسقط عمداً.
 *    والسطر المكرر المشروع داخل صفحته (كابلان متطابقان لتغذية لوحتين) يبقى.
 *  - صفحات COLLECTION (No.|Description|Amount KD) و«TOTAL CARRIED TO COLLECTION»
 *    وملخص القسم — كلها تخطٍ.
 *  - أعمدة مزايددين متعددة (حتى 4 أزواج أسعار) ⇒ الزوج الأول حصراً.
 *  - أعمدة PERVIOUS/CURRENT للاسترداد ⇒ تُهمل (سحب حالة التعاقد لا الاسترداد).
 *  - دمج الوصف: سطور الشروح الملاصقة لبند سابق ذيلٌ لوصفه، والمودعة قبل بند بلا
 *    بند سابق ملاصق ديباجةٌ تصدر وصفه — بحد سطر 200 حرفاً و6 أسطر.
 *
 * نقية بلا db (نمط parse-core.ts القائم) — تُختبر على حافظة عمل ExcelJS تركيبية.
 */
import ExcelJS from "exceljs";

// ---------------- الأنواع ----------------

export interface BoqParsedItem {
  itemNo: string; // «03.30.01» / «6.1» / «B1-2» / «F1» / «AUTO-1»
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number; // قيمة عمود الإجمالي الرقمية (أو 0) — مطابقة لحساب الملف نفسه
}

export interface BoqParsedDivision {
  code: string; // «03» / «26»
  name: string; // «CONCRETE» — من الورقة أو الفهرس أو اسم الورقة
  sheet: string;
  items: BoqParsedItem[];
  total: number;
}

export interface BoqParseWarning {
  sheet: string;
  line: number; // 0 = رسالة عامة
  message: string;
}

export interface BoqParseResult {
  divisions: BoqParsedDivision[];
  grandTotal: number;
  warnings: BoqParseWarning[];
  meta: {
    sheets: number;
    importedSheets: string[];
    skippedSheets: string[];
    narrativeLines: number; // سطور شروح/مواصفات تُتخطى (غير مدمجة)
    mergedLines: number; // سطور دُمجت في أوصاف البنود
    sectionHeaders: number; // رؤوس أقسام حرفية (MEP)
    totalPages: number; // صفحات تسعير (TOTAL CARRIED)
    collectionPages: number; // صفحات تجميع
    recapPages: number; // صفحات إعادة عرض إجماليات (سقطت عمداً)
    duplicatePages: number; // صفحات منسوخة حرفياً (سقطت عمداً)
  };
}

// ---------------- أدوات خلايا ----------------

/** استخراج قيمة الخلية: نص/رقم، وكائنات الصيغ تُقرأ من نتيجتها المخبأة، والنص الغني يُجمع. */
function cv(v: ExcelJS.CellValue): string | number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" ? null : s;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") {
    if ("result" in v && v.result != null) {
      const r = v.result;
      if (typeof r === "number") return Number.isFinite(r) ? r : null;
      if (typeof r === "string") return r.trim() === "" ? null : r.trim();
    }
    if ("richText" in v && Array.isArray(v.richText)) {
      const s = v.richText.map((t) => t.text).join("").trim();
      return s === "" ? null : s;
    }
    if ("text" in v && typeof v.text === "string") {
      const s = v.text.trim();
      return s === "" ? null : s;
    }
    if ("hyperlink" in v && typeof v.text === "string") {
      const s = v.text.trim();
      return s === "" ? null : s;
    }
    if ("error" in v) return null; // #REF! ونحوها
  }
  return null;
}

/** رقم من قيمة خلية (يفك الفواصل) — null إن لم تكن رقمية. */
function num(v: string | number | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = v.replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** نص موحد للمقارنة: lowercase وإزالة فراغات زائدة. */
function norm(v: string | number | null): string {
  if (v == null) return "";
  return String(v).toLowerCase().replace(/\s+/g, " ").trim();
}

/** الوصف متعدد الأسطر ⇒ سطر واحد. */
function descOf(v: string | number | null): string {
  if (v == null) return "";
  return String(v).replace(/\s*\n\s*/g, " ").trim();
}

// ---------------- كشف الرؤوس ----------------

interface BoqCols {
  item: number; // فهارس 0
  desc: number;
  qty: number;
  unit: number;
  price: number;
  amount: number;
}

/** رأس تسعير: يلزم وصف + سعر وحدة، ومعها كمية أو وحدة (لتمييزه عن رأس COLLECTION). */
function detectPricingHeader(vals: (string | number | null)[]): BoqCols | null {
  let item = -1,
    desc = -1,
    qty = -1,
    unit = -1,
    price = -1,
    amount = -1;
  for (let i = 0; i < vals.length; i++) {
    const t = norm(vals[i]);
    if (!t) continue;
    if (item < 0 && (t === "item no" || t === "item no." || t === "item" || t === "no" || t === "no.")) item = i;
    else if (desc < 0 && (t.startsWith("descr") || t.startsWith("particul"))) desc = i;
    else if (qty < 0 && (t === "qty" || t === "qty." || t.startsWith("quantit"))) qty = i;
    else if (unit < 0 && (t === "unit" || t === "unit." || t === "units")) unit = i;
    else if (price < 0 && (t.startsWith("unit price") || t.startsWith("unit rate") || t.startsWith("rate"))) price = i;
    else if (amount < 0 && (t.startsWith("total price") || t.startsWith("total amount") || t.startsWith("amount"))) amount = i;
  }
  if (desc < 0 || price < 0) return null;
  if (qty < 0 && unit < 0) return null; // يشبه COLLECTION أو ورقة ملخص
  return { item, desc, qty, unit, price, amount };
}

/** رأس تجميع COLLECTION: رقم + وصف + مبلغ بلا كمية/وحدة — بعده تُتخطى الصفوف حتى رأس تسعير جديد. */
function detectCollectionHeader(vals: (string | number | null)[]): boolean {
  let hasNo = false,
    hasDesc = false,
    hasAmount = false,
    hasQty = false,
    hasUnit = false;
  for (const v of vals) {
    const t = norm(v);
    if (!t) continue;
    if (t === "no" || t === "no." || t === "item no" || t === "item no.") hasNo = true;
    else if (t.startsWith("descr")) hasDesc = true;
    else if (t.startsWith("amount")) hasAmount = true;
    else if (t === "qty" || t.startsWith("quantit")) hasQty = true;
    else if (t === "unit") hasUnit = true;
  }
  return hasNo && hasDesc && hasAmount && !hasQty && !hasUnit;
}

// ---------------- أنماط ----------------

const NUMBERED_RE = /^\d{1,2}(?:\.\d{1,3}){1,2}$/; // 03.30.01 مدني · 6.1 / 6.1.2 عشري
const INT_RE = /^\d{1,3}$/; // 1..999 (بنود داخل قسم حرفي)
const LETTER_RE = /^[A-Za-z]{1,2}\d{0,2}$/; // A / B1 / F1 / PG / a (أقسام وبنود حرفية)
const COLLECTION_REF_RE = /^div[-.\s]?\d+\s*[-–]\s*\d+$/i; // Div-3-1 (صفوف التجميع)
const DIVISION_TITLE_RE = /^division\s*#?\s*(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*[:–-]?\s*(.*)$/i; // DIVISION 26-28 - ELECTRICAL
const SUMMARY_SHEET_RE = /(summary|pyt|cert|tender|adjust)/i; // أوراق تُتخطى كلياً
const INDEX_SHEET_RE = /^index$/i;
/** سطر حدودي بنيوي — عنوان قسم/وثيقة: يبدأ بـ DIVISION/SECTION أو ينتهي بمرجع CSI
 *  («… Section 140000»). مرجع داخل الوصف بين قوسين — «Elevator (Section -14215)» —
 *  ليس حدّاً بل جزء من وصف البند فيبقى. */
function isBoundary(desc: string): boolean {
  return /^(division|section)\b/i.test(desc) || /\bsection\s*[-–:]?\s*\d{3,6}\s*$/i.test(desc);
}

const LINE_CAP = 200; // حد السطر المدمج
const BUFFER_CAP = 6; // حد أسطر الدمج في الوصف
const MAX_COLS = 40; // حد أعمدة المسح (أعمدة التسعير كلها ضمن أول 12)
const MAX_ROWS = 5000; // حارس أداء

/** حرف عمود إلى فهرس (A=1). */
function colToIdx(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** إحداثيات الخلايا التابعة لدمج (غير الخلية الأم) — قيمتها تُطفأ لأنها صدى لأمها. */
function mergeSlavesOf(ws: ExcelJS.Worksheet): Set<string> {
  const slaves = new Set<string>();
  const merges = (ws.model?.merges ?? []) as string[];
  for (const range of merges) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(range));
    if (!m) continue;
    const c1 = colToIdx(m[1]),
      c2 = colToIdx(m[3]);
    const r1 = Number(m[2]),
      r2 = Number(m[4]);
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue; // الخلية الأم تبقى
        slaves.add(`${r}:${c}`);
      }
    }
  }
  return slaves;
}

// ---------------- التحليل ----------------

export async function parseBoqWorkbook(buffer: Buffer): Promise<BoqParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const warnings: BoqParseWarning[] = [];
  const meta: BoqParseResult["meta"] = {
    sheets: wb.worksheets.length,
    importedSheets: [],
    skippedSheets: [],
    narrativeLines: 0,
    mergedLines: 0,
    sectionHeaders: 0,
    totalPages: 0,
    collectionPages: 0,
    recapPages: 0,
    duplicatePages: 0,
  };

  // 1) خريطة أسماء الأقسام من ورقة الفهرس (المصدر الأوثق)
  const indexNames = new Map<string, string>();
  // 2) الإجماليات المتوقعة من ورقة الملخص العام — أداة تحقق
  const expectedTotals = new Map<string, number>();
  let expectedGross: number | null = null;

  for (const ws of wb.worksheets) {
    if (INDEX_SHEET_RE.test(ws.name)) {
      scanRows(ws, mergeSlavesOf(ws), (vals) => {
        for (const v of vals) {
          const m = DIVISION_TITLE_RE.exec(String(v ?? ""));
          if (m && m[2] && /[A-Za-z]/.test(m[2]) && m[2].trim().length > 1) indexNames.set(m[1], m[2].trim());
        }
      });
    } else if (SUMMARY_SHEET_RE.test(ws.name)) {
      scanRows(ws, mergeSlavesOf(ws), (vals) => {
        const joined = vals.map(norm).join(" ");
        if (/gross total/.test(joined)) {
          const amountVal = vals.find((v) => num(v) != null);
          if (amountVal != null) expectedGross = num(amountVal);
          return;
        }
        const labelVal = vals.find((v) => DIVISION_TITLE_RE.test(String(v ?? "")));
        if (labelVal != null) {
          const m = DIVISION_TITLE_RE.exec(String(labelVal));
          if (m && m[2] && /[A-Za-z]/.test(m[2])) {
            const amountVal = vals.find((v) => num(v) != null);
            if (amountVal != null) expectedTotals.set(m[1], num(amountVal) ?? 0);
          }
        }
      });
    }
  }

  // 3) ماسح أوراق الأقسام
  const divisions: BoqParsedDivision[] = [];
  const seenCodes = new Map<string, BoqParsedDivision>();

  for (const ws of wb.worksheets) {
    const sheetName = ws.name.trim();
    if (INDEX_SHEET_RE.test(sheetName) || SUMMARY_SHEET_RE.test(sheetName)) {
      meta.skippedSheets.push(sheetName);
      continue;
    }

    // رقم القسم من اسم الورقة: Div. 1 / Mech Div. 22 / ELEC-Div.26-28 / HVAC Div. 23-
    const dm = /(\d{1,2})/.exec(sheetName);
    if (!dm) {
      meta.skippedSheets.push(sheetName);
      warnings.push({ sheet: sheetName, line: 0, message: "ورقة بلا رقم قسم في اسمها — تُتخطى" });
      continue;
    }
    const code = dm[1];

    const mergeSlaves = mergeSlavesOf(ws);

    let mode: "seek" | "items" | "collection" = "seek";
    let cols: BoqCols | null = null;
    let currentSection = ""; // حرف قسم MEP نشط
    let autoSeq = 0;
    let sheetDivisionName = "";
    const items: BoqParsedItem[] = [];

    // حالة دمج الأوصاف
    let buffer: string[] = [];
    let lastItem: BoqParsedItem | null = null;

    // حالة الصفحة المخزنة — تُلتزم عند نهايتها لا أثناءها، ليصبح كشف
    // «صفحات إعادة الإجمالي» و«النسخ المطابقة» ممكناً قبل الالتزام
    let pageItems: BoqParsedItem[] = [];
    let pageRawSum = 0; // Σ قيم عمود الإجمالي الرقمية (بنوداً وسطورَ تجميعٍ عُرضت كسطور)
    let pageDisplaySum = 0; // جزء المجموع الخام من سطور عرض (وصف+مبلغ بلا كمية/وحدة) — بصمة Recap
    let pageSig: string[] = [];
    let committedRaw = 0;
    const committedSigs = new Set<string>();
    let droppedRecap = 0;
    let droppedDup = 0;
    let sheetRecaps = 0;
    let sheetDups = 0;

    /** تفريغ المحتفظة: ذيل لبند سابق إن وُجد، وإلا تُعد شروحاً متخطاة. */
    const flushBuffer = () => {
      if (buffer.length === 0) return;
      if (lastItem) {
        appendDesc(lastItem, buffer);
        meta.mergedLines += buffer.length;
      } else {
        meta.narrativeLines += buffer.length;
      }
      buffer = [];
    };

    /** نهاية صفحة تسعير: كشف Recap (مجموعها ≈ كل ما سبقها وغالبه سطور عرض) أو نسخة مطابقة ثم الالتزام. */
    const endPage = () => {
      if (mode === "items" && (pageItems.length > 0 || pageRawSum > 0)) {
        // صفحة Recap: إعادة عرض إجماليات الصفحات السابقة كسطور «HVAC Work - 01…» —
        // تمييزها عن صفحة عادية صادف تساوي مجموعها: غالب مبلغها (≥90%) من سطور عرض لا بنود
        const isRecap =
          committedRaw > 0 &&
          pageRawSum > 0 &&
          Math.abs(pageRawSum - committedRaw) <= Math.max(0.5, committedRaw * 0.0005) &&
          pageDisplaySum >= pageRawSum * 0.9;
        const sig = pageSig.join("§");
        const isDuplicate = !isRecap && pageSig.length > 0 && committedSigs.has(sig);
        if (isRecap) {
          meta.recapPages++;
          sheetRecaps++;
          droppedRecap += pageItems.length;
          meta.narrativeLines += buffer.length; // سطور التجميع المعروضة لا تدخل الأوصاف
          buffer = [];
        } else if (isDuplicate) {
          meta.duplicatePages++;
          sheetDups++;
          droppedDup += pageItems.length;
          meta.narrativeLines += buffer.length;
          buffer = [];
        } else {
          if (pageSig.length > 0) committedSigs.add(sig);
          committedRaw += pageRawSum;
          items.push(...pageItems);
          flushBuffer(); // ذيل الصفحة يلحق بآخر بند فيها
        }
      }
      pageItems = [];
      pageRawSum = 0;
      pageDisplaySum = 0;
      pageSig = [];
    };

    scanRows(ws, mergeSlaves, (vals) => {
      // رأس تسعير (يتكرر مع كل صفحة داخل الورقة) — له الأولوية في كل الأوضاع
      const pricing = detectPricingHeader(vals);
      if (pricing) {
        endPage();
        lastItem = null; // صفحة جديدة: ما بعدها ديباجة لا ذيل
        cols = pricing;
        mode = "items";
        return;
      }
      if (detectCollectionHeader(vals)) {
        if (mode === "items") {
          meta.collectionPages++;
          endPage();
        }
        mode = "collection";
        return;
      }
      if (mode !== "items" || !cols) return;

      const c = cols as BoqCols;
      const desc = descOf(vals[c.desc] ?? null);
      if (!desc) return;

      // اسم القسم من متن الورقة (DIVISION 26 - ELECTRICAL)
      if (!sheetDivisionName) {
        const m = DIVISION_TITLE_RE.exec(desc);
        if (m && m[2] && /[A-Za-z]/.test(m[2]) && m[2].trim().length > 1 && Number(m[1]) === Number(code)) {
          sheetDivisionName = m[2].trim();
          return;
        }
      }

      const lower = desc.toLowerCase();
      if (lower.includes("total carried")) {
        meta.totalPages++;
        endPage(); // صف TOTAL نفسه لا يدخل المجموع الخام
        return;
      }
      if (vals.some((v) => COLLECTION_REF_RE.test(String(v ?? "").trim()))) return; // صفوف التجميع Div-3-1
      if (lower.includes("summary") || lower.includes("collection")) return;
      if (vals.some((v) => norm(v) === "page no" || norm(v) === "page no.")) return;

      const a = vals[c.item] != null ? String(vals[c.item]).trim() : "";
      const qtyCell = c.qty >= 0 ? (vals[c.qty] ?? null) : null;
      const unitCell = c.unit >= 0 ? (vals[c.unit] ?? null) : null;
      const priceCell = c.price >= 0 ? (vals[c.price] ?? null) : null;
      const amountCell = c.amount >= 0 ? (vals[c.amount] ?? null) : null;

      // المجموع الخام للصفحة — يشمل سطور التجميع المعروضة (وصف+F فقط) لكشف Recap
      const rawF = num(amountCell);
      if (rawF != null) pageRawSum += rawF;

      const hasSignal = qtyCell != null || unitCell != null || priceCell != null || amountCell != null;

      if (!hasSignal) {
        // وصف بلا أي إشارة — سطر عرض إن حمل مبلغاً (بصمة Recap)
        if (rawF != null) pageDisplaySum += rawF;
        if (a && LETTER_RE.test(a)) {
          // رأس قسم حرفي (A / B1 / PA) — حدّ بنيوي: ما قبله ذيل/شروح لا ديباجة له
          flushBuffer();
          lastItem = null;
          currentSection = a.toUpperCase();
          meta.sectionHeaders++;
        } else if (isBoundary(desc)) {
          // سطر حدودي (SECTION - 03 30 00 / DIVISION …) — بنيوي لا يدخل الأوصاف
          flushBuffer();
          lastItem = null;
          meta.narrativeLines++;
        } else {
          if (buffer.length < BUFFER_CAP) buffer.push(desc.slice(0, LINE_CAP));
          else meta.narrativeLines++;
        }
        return;
      }

      // صف بند: مرقم (03.30.01 / 6.1)، أو عدد داخل قسم حرفي، أو حرفي مسعّر (F1/PE/a)،
      // أو سطر مسعّر بلا رقم
      const isNumbered = a !== "" && NUMBERED_RE.test(a);
      const isInt = a !== "" && INT_RE.test(a);
      const isLetter = a !== "" && LETTER_RE.test(a) && !isInt && !isNumbered;
      const unnumberedPriced =
        a === "" && (num(priceCell) != null || num(amountCell) != null) && (qtyCell != null || unitCell != null);
      if (!isNumbered && !isInt && !isLetter && !unnumberedPriced) {
        // سطر غير مصنف كبند — سطر عرض إن حمل مبلغاً (بصمة Recap)
        if (rawF != null) pageDisplaySum += rawF;
        if (buffer.length < BUFFER_CAP) buffer.push(desc.slice(0, LINE_CAP));
        else meta.narrativeLines++;
        return;
      }

      let itemNo: string;
      if (isNumbered) itemNo = a;
      else if (isInt) itemNo = currentSection ? `${currentSection}-${a}` : a;
      else if (isLetter) {
        itemNo = a;
        currentSection = a.toUpperCase(); // بند حرفي يفتح سياقاً لما يليه من أعداد (PG ثم 1..7)
      } else itemNo = `AUTO-${++autoSeq}`;

      // المبلغ = قيمة عمود الإجمالي الرقمية حصراً (مرآة SUM الملف) — INCLUDED/فارغ ⇒ 0
      const amountNum = num(amountCell);
      const qty = num(qtyCell) ?? 1; // نص (Items/L.S) أو فارغ ⇒ 1
      const unitPrice = num(priceCell) ?? 0; // INCLUDED ⇒ 0

      const item: BoqParsedItem = {
        itemNo,
        description: desc,
        qty,
        unit: unitCell != null ? String(unitCell).trim() : "",
        unitPrice,
        amount: amountNum ?? 0,
      };

      // ديباجة مودعة قبل هذا البند (لا بند سابق ملاصق) تصدر وصفه
      if (buffer.length > 0 && !lastItem) {
        item.description = [...buffer, desc].join(" — ");
        meta.mergedLines += buffer.length;
        buffer = [];
      } else if (buffer.length > 0 && lastItem) {
        // سطور بعد بند سابق = ذيله
        appendDesc(lastItem, buffer);
        meta.mergedLines += buffer.length;
        buffer = [];
      }

      pageItems.push(item);
      pageSig.push(`${item.description}|${item.amount}`);
      lastItem = item;
    });

    endPage(); // نهاية الورقة
    flushBuffer(); // ما تبقى بعد آخر صفحة
    if (sheetRecaps > 0) {
      warnings.push({
        sheet: sheetName,
        line: 0,
        message: `تخطي ${sheetRecaps} صفحة إعادة إجماليات (Recap) تحمل مجموع الصفحات السابقة${droppedRecap > 0 ? ` — ${droppedRecap} سطراً` : ""}`,
      });
    }
    if (sheetDups > 0) {
      warnings.push({
        sheet: sheetName,
        line: 0,
        message: `تخطي ${sheetDups} صفحة منسوخة حرفياً (نسخة مكررة داخل الملف) — ${droppedDup} سطراً`,
      });
    }

    if (items.length === 0) {
      meta.skippedSheets.push(sheetName);
      continue;
    }

    const name = indexNames.get(code) || sheetDivisionName || sheetName;
    const total = round3(items.reduce((s, it) => s + it.amount, 0));

    // ورقة ثانية لنفس القسم (صفحات متفرقة) ⇒ تُدمج ببنودها
    const existing = seenCodes.get(code);
    if (existing) {
      existing.items.push(...items);
      existing.total = round3(existing.total + total);
      warnings.push({ sheet: sheetName, line: 0, message: `ورقة إضافية للقسم ${code} — دُمجت بنودها مع ورقته الأولى` });
    } else {
      const d: BoqParsedDivision = { code, name, sheet: sheetName, items, total };
      seenCodes.set(code, d);
      divisions.push(d);
    }
    meta.importedSheets.push(sheetName);
  }

  // 4) التحقق مقابل الملخص العام
  const grandTotal = round3(divisions.reduce((s, d) => s + d.total, 0));
  for (const d of divisions) {
    const expected = expectedTotals.get(d.code);
    if (expected == null) continue;
    const diff = Math.abs(round3(d.total) - round3(expected));
    if (diff > Math.max(0.5, expected * 0.0005)) {
      warnings.push({
        sheet: d.sheet,
        line: 0,
        message: `إجمالي القسم ${d.code} المستورد ${fmtNum(d.total)} د.ك يختلف عن الملخص العام ${fmtNum(expected)} د.ك (فرق ${fmtNum(diff)})`,
      });
    }
  }
  if (expectedGross != null) {
    const diff = Math.abs(grandTotal - round3(expectedGross));
    if (diff > Math.max(1, expectedGross * 0.001)) {
      warnings.push({
        sheet: "Summary",
        line: 0,
        message: `الإجمالي العام المستورد ${fmtNum(grandTotal)} د.ك يختلف عن GROSS TOTAL في الملخص ${fmtNum(expectedGross)} د.ك — قد يعود ذلك لتعديلات المزايد أو البنود المؤقتة`,
      });
    }
  }
  if (divisions.length > 0 && expectedTotals.size === 0 && expectedGross == null) {
    warnings.push({ sheet: "Summary", line: 0, message: "لا توجد ورقة ملخص عام للمطابقة — استُوردت البنود دون تحقق إجمالي" });
  }

  divisions.sort((x, y) => Number(x.code) - Number(y.code));
  return { divisions, grandTotal, warnings, meta };
}

// ---------------- مساعدات ----------------

/** إلحاق سطور ذيل بوصف بند قائم. */
function appendDesc(item: BoqParsedItem, lines: string[]) {
  const tail = lines.map((l) => l.slice(0, LINE_CAP)).join(" — ");
  const base = item.description;
  item.description = base.length + tail.length > 900 ? `${base} — ${tail.slice(0, 900 - base.length)}` : `${base} — ${tail}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function fmtNum(n: number): string {
  return round3(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** تكرار صفوف الورقة بقيم منظفة — vals فهارس 0 (أول عمود A)؛ خلايا الدمج التابعة تُطفأ. */
function scanRows(
  ws: ExcelJS.Worksheet,
  mergeSlaves: Set<string>,
  fn: (vals: (string | number | null)[], rowIdx: number) => void,
) {
  const count = Math.min(ws.rowCount, MAX_ROWS);
  const colLimit = Math.min(ws.columnCount + 1, MAX_COLS);
  for (let r = 1; r <= count; r++) {
    const row = ws.getRow(r);
    const raw = row.values as unknown[]; // raw[0] فارغ دائماً
    if (!raw || raw.length <= 1) continue;
    let hasAny = false;
    const vals: (string | number | null)[] = [];
    const len = Math.min(raw.length, colLimit);
    for (let i = 1; i < len; i++) {
      // خلية تابعة لدمج ⇒ صدى لأمها ⇒ تُطفأ (وإلا تكررت قيم البند على كل صف)
      const v = mergeSlaves.has(`${r}:${i}`) ? null : cv(raw[i] as ExcelJS.CellValue);
      vals.push(v);
      if (v != null) hasAny = true;
    }
    if (!hasAny) continue;
    fn(vals, r);
  }
}
