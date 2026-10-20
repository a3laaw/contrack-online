/**
 * محرك النماذج النقي — Word First (بند 56: مركز النماذج Word).
 *
 * مرآة حرفية للمكتبي (قراءة فقط):
 *   • app/services/form_service.py — TEMPLATE_STATUSES/FIELD_TYPES/SOURCE_TYPES/
 *     DATA_SOURCES/scan_word_placeholders/_field_text/_calc_value/_norm_calc_name/
 *     _address_placeholder_key/_resolve_system/list_templates ORDER/analyze.
 *   • app/services/word_forms_service.py — _norm/SYNONYMS/guess_field.
 * انحرافات الويب الموثقة:
 *   • مصدر «مالية العقد» (financial) غير متاح في الويب حالياً — تجميعه يعتمد
 *     سندات القبض وخطة الدفعات بالمكتبي؛ وسومه الشهيرة (قيمة العقد/مبلغ العقد/
 *     المبلغ/الإجمالي) حُوّطت إلى contracts.amount (قيمة العقد موجودة كيانياً).
 *   • حسابات نموذج الإدخال (_apply_input_calculations/_validate_input_calculations
 *     وجدول الدفعات) غير منفذة في الويب حالياً — حقول الإجمالي/التفقيط تبقى إدخال يدوي.
 *   • PDF غير متاح في الويب حالياً — التوليد Word فقط (تحويل المكتبي LibreOffice).
 *   • هوية المطبوعات printIdentity تبقى "none" — غير متاح في الويب حالياً كالإعدادات.
 * تخزين القوالب والمستندات: الملفات على القرص غير متاحة في الاستضافة الويبية،
 * فخُزّن docx كنص base64 داخل عمود wordPath النصي الموجود أصلًا مع prefix
 * بروتوكولي "base64:" (موثق في worklog 56) — القالب الأصلي والمستند المولد على السواء.
 */

/** الحالات الأربع الحرفية (form_service.TEMPLATE_STATUSES) */
export const TEMPLATE_STATUSES = ["مسودة", "معتمد", "معطل", "مؤرشف"] as const;

/** نوع الحقول الحرفي (form_service.FIELD_TYPES) */
export const FIELD_TYPES: Record<string, string> = {
  text: "نص",
  longtext: "نص طويل",
  number: "رقم",
  money: "مبلغ مالي",
  date: "تاريخ",
  choice: "قائمة اختيار",
  bool: "نعم/لا",
  table: "جدول",
  signature: "توقيع/صورة",
  image: "صورة/شعار",
};

/** مصادر القيمة الحرفي (form_service.SOURCE_TYPES) */
export const SOURCE_TYPES: Record<string, string> = {
  manual: "إدخال يدوي",
  system: "من بيانات النظام",
  auto: "قيمة تلقائية",
  calc: "قيمة محسوبة",
};

/** أيام الأسبوع العربية بترتيب weekday() المكتبية (الاثنين أولاً) */
const AR_WEEKDAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];

/** اسم اليوم بالعربية لتاريخ معين (اليوم افتراضيًا) — مرآة arabic_weekday */
export function arabicWeekday(day: Date = new Date()): string {
  try {
    // Python weekday(): الاثنين=0 … الأحد=6 · JS getDay(): الأحد=0 … السبت=6
    return AR_WEEKDAYS[(day.getDay() + 6) % 7] ?? "";
  } catch {
    return "";
  }
}

/** قيم النظام التلقائية — مرآة _resolve_system */
export function resolveSystemKey(
  key: string,
  opts: { now?: Date; user?: string } = {}
): string {
  const now = opts.now ?? new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  if (key === "today") return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  if (key === "weekday") return arabicWeekday(now);
  if (key === "year") return String(now.getFullYear());
  if (key === "user") return opts.user ?? "";
  return "";
}

export interface DataSourceField {
  key: string;
  /** الاسم العربي الحرفي الظاهر في واجهة الربط */
  label: string;
}

export interface DataSourceDef {
  id: string;
  label: string;
  /** سياق التعبئة: customer/contract/quotation — يحدد ماذا يُختار في نافذة التوليد */
  context: string;
  fields: DataSourceField[];
}

/** شجرة مصادر البيانات — مرآة DATA_SOURCES بالتسميات الحرفية + كيان الويب quotations */
export const DATA_SOURCES: DataSourceDef[] = [
  {
    id: "customers",
    label: "العملاء",
    context: "customer",
    fields: [
      { key: "name", label: "اسم العميل" },
      { key: "customer_code", label: "رقم العميل" },
      { key: "phone", label: "هاتف العميل" },
      { key: "address", label: "عنوان العميل كامل" },
      { key: "address_governorate", label: "محافظة العميل" },
      { key: "address_area", label: "منطقة العميل" },
      { key: "address_block", label: "قطعة العميل" },
      { key: "address_plot", label: "قسيمة العميل" },
      { key: "email", label: "بريد العميل" },
    ],
  },
  {
    id: "contracts",
    label: "العقود",
    context: "contract",
    fields: [
      { key: "contract_number", label: "رقم العقد" },
      { key: "contract_name", label: "اسم العقد" },
      { key: "contract_type", label: "نوع العقد" },
      { key: "amount", label: "قيمة العقد" },
      { key: "contract_date", label: "تاريخ العقد" },
      { key: "duration_days", label: "مدة التنفيذ (أيام)" },
      { key: "customer_name", label: "اسم عميل العقد" },
      { key: "description", label: "بيان العقد" },
    ],
  },
  {
    id: "quotations",
    label: "عروض الأسعار",
    context: "quotation",
    // كيان ويب (بند 12) — التسميات من مفردات word_service.quotation_field_values
    fields: [
      { key: "quotation_number", label: "رقم عرض السعر" },
      { key: "quotation_date", label: "تاريخ عرض السعر" },
      { key: "customer_name", label: "اسم العميل" },
      { key: "project_name", label: "اسم المشروع" },
      { key: "items_table", label: "جدول البنود" },
      { key: "total", label: "الإجمالي" },
      { key: "status", label: "حالة العرض" },
      { key: "valid_until", label: "صالح حتى" },
      { key: "notes", label: "ملاحظات" },
    ],
  },
  {
    id: "settings",
    label: "بيانات الشركة",
    context: "",
    fields: [
      { key: "company_name", label: "اسم الشركة" },
      { key: "company_phone", label: "هاتف الشركة" },
      { key: "company_address", label: "عنوان الشركة" },
      { key: "currency", label: "العملة" },
    ],
  },
  {
    id: "system",
    label: "قيم تلقائية",
    context: "",
    fields: [
      { key: "today", label: "تاريخ اليوم" },
      { key: "weekday", label: "اسم اليوم الحالي (السبت…)" },
      { key: "year", label: "السنة الحالية" },
      { key: "user", label: "اسم المستخدم الحالي" },
    ],
  },
];

export function dataSourceTree(): DataSourceDef[] {
  return DATA_SOURCES;
}

export function findDataSource(id: string): DataSourceDef | undefined {
  return DATA_SOURCES.find((d) => d.id === id);
}

/** كيانات الربط المفتوحة للمستخدم في حوار «ربط الحقول» — المكتبي يستثني system */
export function bindableEntities(): DataSourceDef[] {
  return DATA_SOURCES.filter((d) => d.id !== "system");
}

// ============================================================
// تطبيع أسماء الوسوم (word_forms_service._norm)
// ============================================================

export function normPlaceholder(s: string): string {
  return ((s || "") as string)
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** تطبيع حسابي أوسع — مرآة _norm_calc_name (تضيف ى→ي) */
export function normCalcName(name: string): string {
  return ((name || "") as string)
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface GuessedField {
  sourceType: string;
  sourceEntity: string;
  sourceKey: string;
  context: string;
  fieldType: string;
  required: boolean;
  known: boolean;
}

/** مرادفات الوسوم الشائعة — مرآة SYNONYMS (word_forms_service) بعد التطبيع.
 *  مدخلات «مالية العقد» حُوّطت إلى contracts.amount (انحراف موثق أعلاه). */
const SYNONYMS_RAW: Record<string, [string, string, string, string]> = {
  // العملاء
  اسم_العميل: ["system", "customers", "name", "customer"],
  العميل: ["system", "customers", "name", "customer"],
  customer_name: ["system", "customers", "name", "customer"],
  رقم_العميل: ["system", "customers", "customer_code", "customer"],
  هاتف_العميل: ["system", "customers", "phone", "customer"],
  تليفون_العميل: ["system", "customers", "phone", "customer"],
  عنوان_العميل: ["system", "customers", "address", "customer"],
  محافظه_العميل: ["system", "customers", "address_governorate", "customer"],
  منطقه_العميل: ["system", "customers", "address_area", "customer"],
  قطعه_العميل: ["system", "customers", "address_block", "customer"],
  قسيمه_العميل: ["system", "customers", "address_plot", "customer"],
  المحافظه: ["system", "customers", "address_governorate", "customer"],
  المنطقه: ["system", "customers", "address_area", "customer"],
  القطعه: ["system", "customers", "address_block", "customer"],
  القسيمه: ["system", "customers", "address_plot", "customer"],
  // العقود
  رقم_العقد: ["system", "contracts", "contract_number", "contract"],
  اسم_العقد: ["system", "contracts", "contract_name", "contract"],
  نوع_العقد: ["system", "contracts", "contract_type", "contract"],
  تاريخ_العقد: ["system", "contracts", "contract_date", "contract"],
  مده_التنفيذ: ["system", "contracts", "duration_days", "contract"],
  // ملاحظة: عائلة قيمة العقد المالية (قيمه_العقد/مبلغ_العقد/…) تبقى يدوية مالية إلزامية
  // كالمكتبي word_forms_service.py:97-114 — لا ربط كيانياً لها (وثّق في الاختبارات).
  // نظام
  تاريخ_اليوم: ["auto", "system", "today", ""],
  اليوم: ["auto", "system", "today", ""],
  السنه: ["auto", "system", "year", ""],
  اسم_المستخدم: ["auto", "system", "user", ""],
  رقم_الرخصه: ["manual", "", "", ""],
  رقم_الترخيص: ["manual", "", "", ""],
  اسم_المالك: ["system", "customers", "name", "customer"],
  المالك: ["system", "customers", "name", "customer"],
  هاتف: ["system", "customers", "phone", "customer"],
  العنوان: ["system", "customers", "address", "customer"],
  محافظه: ["system", "customers", "address_governorate", "customer"],
  منطقه: ["system", "customers", "address_area", "customer"],
  قطعه: ["system", "customers", "address_block", "customer"],
  قسيمه: ["system", "customers", "address_plot", "customer"],
  وصف_العقد: ["system", "contracts", "contract_name", "contract"],
  بيان_العقد: ["system", "contracts", "contract_name", "contract"],
  تاريخ: ["auto", "system", "today", ""],
  التاريخ: ["auto", "system", "today", ""],
};

export const SYNONYMS: Record<string, [string, string, string, string]> = Object.fromEntries(
  Object.entries(SYNONYMS_RAW).map(([k, v]) => [normPlaceholder(k), v])
);

/** عرض سعر — مرادفات كيان الويب (إضافة ويب موثقة) */
SYNONYMS[normPlaceholder("رقم_عرض_السعر")] = ["system", "quotations", "quotation_number", "quotation"];
SYNONYMS[normPlaceholder("تاريخ_عرض_السعر")] = ["system", "quotations", "quotation_date", "quotation"];

const MANUAL_MONEY: GuessedField = {
  sourceType: "manual",
  sourceEntity: "",
  sourceKey: "",
  context: "",
  fieldType: "money",
  required: true,
  known: true,
};

const MANUAL_TEXT: GuessedField = {
  sourceType: "manual",
  sourceEntity: "",
  sourceKey: "",
  context: "",
  fieldType: "text",
  required: false,
  known: true,
};

const CALC_TEXT: GuessedField = {
  sourceType: "calc",
  sourceEntity: "",
  sourceKey: "",
  context: "",
  fieldType: "text",
  required: false,
  known: true,
};

const UNKNOWN_FIELD: GuessedField = {
  sourceType: "manual",
  sourceEntity: "",
  sourceKey: "",
  context: "",
  fieldType: "text",
  required: false,
  known: false,
};

/** تخمين مصدر الوسم — مرآة guess_field (بلا حسابات الدفعات/الإجمالي في الويب) */
export function guessField(placeholder: string): GuessedField {
  const key = normPlaceholder(placeholder);
  const contractValueAliases = ["قيمه_العقد", "مبلغ_العقد", "اجمالي_العقد", "القيمه_الاجماليه"];
  const contractWordsAliases = [
    "قيمه_العقد_كتابه", "مبلغ_العقد_كتابه", "قيمه_العقد_بالحروف", "مبلغ_العقد_بالحروف",
  ];
  if (contractValueAliases.includes(key)) return { ...MANUAL_MONEY };
  if (contractWordsAliases.includes(key)) return { ...CALC_TEXT };
  const m = /^(?:ال)?دفعه_(\d+)_(قيمه|مبلغ|كتابه|بالحروف|نسبه|اسم|عنوان|تاريخ)$/.exec(key);
  if (m) {
    const part = m[2];
    if (part === "قيمه" || part === "مبلغ") return { ...MANUAL_MONEY, required: false };
    if (part === "كتابه" || part === "بالحروف") return { ...CALC_TEXT };
    return { ...MANUAL_TEXT };
  }
  const guessed = SYNONYMS[key];
  if (guessed) {
    const [stype, entity, sourceKey, context] = guessed;
    const fieldType =
      entity === "system" && (sourceKey === "today" || sourceKey === "contract_date")
        ? "date"
        : "text";
    return { sourceType: stype, sourceEntity: entity, sourceKey, context, fieldType, required: false, known: true };
  }
  return { ...UNKNOWN_FIELD };
}

// ============================================================
// استخراج وسوم {{...}} من docx — مرآة scan_word_placeholders
// (النص الظاهر: تجميع w:t داخل كل w:p ثم البحث — لا XML الخام)
// ============================================================

const XML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
};

export function decodeXmlEntities(s: string): string {
  return (s || "").replace(/&(lt|gt|quot|apos|amp);/g, (m) => XML_ENTITIES[m] ?? m);
}

/** نصوص الفقرات الظاهرة من ملف XML واحد (word/*.xml) */
export function xmlParagraphTexts(xml: string): string[] {
  const chunks: string[] = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml)) !== null) {
    const inner = pm[1] ?? "";
    let txt = "";
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(inner)) !== null) txt += tm[1] ?? "";
    txt = decodeXmlEntities(txt);
    if (txt) chunks.push(txt);
  }
  return chunks;
}

/** العلامات {{...}} من نص مدمج — الاسم مطبَّع (فراغات متعددة ⇒ واحدة) بلا تكرار */
export function extractPlaceholderNames(text: string): string[] {
  const found: string[] = [];
  for (const ph of text.matchAll(/\{\{\s*([^{}<>\r\n]+?)\s*\}\}/g)) {
    const name = (ph[1] ?? "").replace(/\s+/g, " ").trim();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

// ============================================================
// دمج القيم وتوليد نص كل حقل — مرآة _field_text/_calc_value/_resolve_contract
// ============================================================

export interface FormFieldRow {
  id?: number;
  name: string;
  placeholder?: string;
  fieldType?: string;
  sourceType?: string;
  sourceEntity?: string;
  sourceKey?: string;
  defaultValue?: string;
  required?: boolean;
}

/** سياق التعبئة — مرآة build_context (قيم النظام من كيانات الويب) */
export interface FillContext {
  customer?: Record<string, unknown> | null;
  contract?: Record<string, unknown> | null;
  quotation?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  now?: Date;
  user?: string;
}

/** تنسيق مالي ثلاث خانات بفواصل — مرآة f"{x:,.3f}" */
export function formatMoney3(value: unknown, currency = ""): string {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  if (!Number.isFinite(n)) return String(value ?? "");
  const txt = n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return currency ? `${txt} ${currency}` : txt;
}

function customerOf(ctx: FillContext): Record<string, unknown> {
  return (ctx.customer as Record<string, unknown>) || {};
}

function contractOf(ctx: FillContext): Record<string, unknown> {
  return (ctx.contract as Record<string, unknown>) || {};
}

function quotationOf(ctx: FillContext): Record<string, unknown> {
  return (ctx.quotation as Record<string, unknown>) || {};
}

/** قراءة عمود نصي من صف قاعدة بيانات */
function col(row: Record<string, unknown>, key: string): string {
  const v = row?.[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

/** قراءة عمود مالي (Prisma Decimal) */
function colNum(row: Record<string, unknown>, key: string): number {
  const v = row?.[key];
  if (v === null || v === undefined) return 0;
  if (typeof v === "object" && "toNumber" in (v as object)) {
    return (v as { toNumber(): number }).toNumber();
  }
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** حقل العقد — مرآة _resolve_contract (قيمة العقد بثلاث خانات، واسم العميل من عقده) */
export function resolveContractKey(ctx: FillContext, key: string): string {
  const con = contractOf(ctx);
  if (!con || Object.keys(con).length === 0) return "";
  if (key === "customer_name") return col(con, "customer_name");
  if (key === "amount") return formatMoney3(colNum(con, "amount"));
  // مفاتيح المصادر snake_case المكتبية ⇒ حقول Prisma camelCase (مع سقوط على الخام)
  const map: Record<string, string> = {
    contract_number: "contractNumber",
    contract_name: "contractName",
    contract_type: "contractType",
    contract_date: "contractDate",
    duration_days: "durationDays",
  };
  const mapped = map[key];
  const viaMapped = mapped ? col(con, mapped) : "";
  return viaMapped || (mapped ? col(con, key) : col(con, key));
}

/** حقل عرض السعر — كيان الويب (بند 12) بجدول بنوده */
export function resolveQuotationKey(ctx: FillContext, key: string, currency = "د.ك"): string {
  const q = quotationOf(ctx);
  if (!q || Object.keys(q).length === 0) return "";
  switch (key) {
    case "quotation_number":
      return col(q, "quotationNumber");
    case "quotation_date": {
      const created = q["createdAt"];
      if (created instanceof Date) {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${created.getFullYear()}-${p(created.getMonth() + 1)}-${p(created.getDate())}`;
      }
      return col(q, "quotation_date");
    }
    case "customer_name":
      return col(q, "customer_name");
    case "project_name":
      return col(q, "project_name");
    case "items_table": {
      const items = Array.isArray(q["items"]) ? (q["items"] as Array<Record<string, unknown>>) : [];
      const lines = items.map((i) => {
        const qty = colNum(i, "quantity");
        const price = colNum(i, "unitPrice");
        const total = colNum(i, "totalPrice");
        const unit = col(i, "unit");
        return `- ${col(i, "description")}: ${formatMoney3(qty)} ${unit} × ${formatMoney3(price)} = ${formatMoney3(total)} ${currency}`;
      });
      return lines.join("\n") || "—";
    }
    case "total":
      return formatMoney3(colNum(q, "totalAmount"));
    case "status":
      return col(q, "status");
    case "valid_until":
      return col(q, "validUntil");
    case "notes":
      return col(q, "notes");
    default:
      return col(q, key);
  }
}

/** حقل بيانات الشركة — من إعدادات النظام */
export function resolveSettingKey(ctx: FillContext, key: string): string {
  const s = (ctx.settings as Record<string, unknown>) || {};
  const map: Record<string, string> = {
    company_name: "companyName",
    company_phone: "companyPhone",
    company_address: "companyAddress",
    currency: "currency",
  };
  return col(s, map[key] ?? key);
}

/** تقييم تعبير محسوب — مرآة _calc_value (بدون eval: حاسبة آمنة) */
export function calcValue(expression: string, values: Record<string, unknown>): string {
  let expr = expression || "";
  let invalid = false;
  expr = expr.replace(/\{([^{}]+)\}/g, (_m, name: string) => {
    const v = values[String(name).trim()];
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    if (!Number.isFinite(n)) {
      invalid = true;
      return "0";
    }
    return String(n);
  });
  const trimmed = expr.trim();
  if (invalid || !trimmed || !/^[\d\s.+\-*/()]+$/.test(trimmed)) return "";
  const result = safeArithmetic(trimmed);
  return result === null ? "" : formatMoney3(result);
}

/** حاسبة جمع/طرح/ضرب/قسمة بأقواس — بديل آمن عن eval */
export function safeArithmetic(src: string): number | null {
  let pos = 0;
  const s = src;
  const peek = () => s[pos];
  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      while (pos < s.length && s[pos] === " ") pos++;
      if (peek() !== "+" && peek() !== "-") break;
      const op = s[pos++];
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    for (;;) {
      while (pos < s.length && s[pos] === " ") pos++;
      if (peek() !== "*" && peek() !== "/") break;
      const op = s[pos++];
      const right = parseFactor();
      if (right === null) return null;
      left = op === "*" ? left * right : right === 0 ? NaN : left / right;
    }
    return left;
  }
  function parseFactor(): number | null {
    while (peek() === " ") pos++;
    if (peek() === "(") {
      pos++;
      const v = parseExpr();
      while (peek() === " ") pos++;
      if (peek() !== ")") return null;
      pos++;
      return v;
    }
    const start = pos;
    if (peek() === "-" || peek() === "+") pos++;
    while (pos < s.length && /[\d.]/.test(s[pos])) pos++;
    if (pos === start) return null;
    const n = parseFloat(s.slice(start, pos));
    return Number.isFinite(n) ? n : null;
  }
  const result = parseExpr();
  while (pos < s.length && s[pos] === " ") pos++;
  if (result === null || pos !== s.length || !Number.isFinite(result)) return null;
  return result;
}

/**
 * مفتاح عنوان العميل من الوسم — مرآة _address_placeholder_key:
 * {{المحافظة}} ⇒ address_governorate إلخ (استكمال يدوي فارغ من سياق العميل)
 */
export function addressPlaceholderKey(name: string): string {
  const key = (name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const map: Record<string, string> = {
    محافظه_العميل: "address_governorate",
    المحافظه: "address_governorate",
    محافظه: "address_governorate",
    منطقه_العميل: "address_area",
    المنطقه: "address_area",
    منطقه: "address_area",
    قطعه_العميل: "address_block",
    القطعه: "address_block",
    قطعه: "address_block",
    قسيمه_العميل: "address_plot",
    القسيمه: "address_plot",
    قسيمه: "address_plot",
  };
  return map[key] ?? "";
}

/** نص حقل واحد — مرآة _field_text */
export function fieldText(
  field: FormFieldRow,
  values: Record<string, string>,
  ctx: FillContext,
  currency = "د.ك"
): string {
  const name = field.name || "";
  const placeholder = field.placeholder || name;
  const sourceType = field.sourceType || "manual";
  if (sourceType === "system" || sourceType === "auto") {
    return resolveSystemField(field, ctx, currency);
  }
  if (sourceType === "calc") {
    return calcValue(field.defaultValue || "", values);
  }
  let val = values[name] ?? values[placeholder] ?? field.defaultValue ?? "";
  if (!val) {
    const addrKey = addressPlaceholderKey(placeholder) || addressPlaceholderKey(name);
    if (addrKey) val = col(customerOf(ctx), addrKey);
  }
  if ((field.fieldType || "") === "money") {
    const raw = String(val ?? "").replace(/,/g, "");
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return formatMoney3(n, currency);
    return String(val ?? "");
  }
  return String(val ?? "");
}

/** حقل نظامي — مرآة resolve_field عبر DATA_SOURCES */
export function resolveSystemField(
  field: FormFieldRow,
  ctx: FillContext,
  currency = "د.ك"
): string {
  const entity = field.sourceEntity || "";
  const key = field.sourceKey || "";
  try {
    if (entity === "customers") return col(customerOf(ctx), key);
    if (entity === "contracts") return resolveContractKey(ctx, key);
    if (entity === "quotations") return resolveQuotationKey(ctx, key, currency);
    if (entity === "settings") return resolveSettingKey(ctx, key);
    if (entity === "system") return resolveSystemKey(key, { now: ctx.now, user: ctx.user });
    return "";
  } catch {
    return "";
  }
}

/** خريطة الوسم ⇒ النص النهائي لكل حقول القالب — مرآة حلقة fill_word */
export function buildFieldMapping(
  fields: FormFieldRow[],
  values: Record<string, string>,
  ctx: FillContext,
  currency = "د.ك"
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const f of fields) {
    const ph = f.placeholder || f.name || "";
    if (ph) mapping[ph] = fieldText(f, values, ctx, currency);
  }
  return mapping;
}

/** الحقول اليدوية الإلزامية الفارغة — مرآة فحص WordFormFillDialog._generate */
export function missingRequiredManual(
  fields: FormFieldRow[],
  values: Record<string, string>
): string[] {
  const missing: string[] = [];
  for (const f of fields) {
    const key = f.name || f.placeholder || "";
    if (f.required && (f.sourceType || "manual") === "manual") {
      if (!String(values[key] ?? "").trim()) missing.push(f.placeholder || key);
    }
  }
  return missing;
}

// ============================================================
// الترقيم والأسماء — مرآة _next_doc_number/archive name
// ============================================================

/** رقم المستند FD-%04d (form_service._next_doc_number) */
export function formDocNumber(n: number): string {
  return `FD-${String(Math.max(1, n)).padStart(4, "0")}`;
}

/** اسم ملف المستند المولد — مرآة اسم الأرشفة safe_num.docx */
export function docFileName(baseName: string, docNumber: string): string {
  const safe = (baseName || "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 50) || "نموذج";
  return `${safe}_${docNumber}.docx`;
}

// ============================================================
// ترتيب القائمة وجاهزية الربط
// ============================================================

export interface TemplateLike {
  status: string;
  baseName: string;
  version: number;
}

/** مرآة ORDER BY CASE معتمد0 مسودة1 معطل2 غيره3 ثم base_name ثم version DESC */
export function sortTemplates<T extends TemplateLike>(rows: T[]): T[] {
  const rank = (st: string): number =>
    st === "معتمد" ? 0 : st === "مسودة" ? 1 : st === "معطل" ? 2 : 3;
  return [...rows].sort((a, b) => {
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    const n = a.baseName.localeCompare(b.baseName, "ar");
    if (n !== 0) return n;
    return b.version - a.version;
  });
}

export interface AnalyzeResult {
  total: number;
  manual: number;
  system: number;
  auto: number;
  calc: number;
  readyPercent: number;
}

/** ملخص جودة ربط القالب — مرآة wfs.analyze_template */
export function analyzeFields(fields: Array<{ sourceType?: string }>): AnalyzeResult {
  const total = fields.length;
  const manual = fields.filter((f) => (f.sourceType || "manual") === "manual").length;
  const system = fields.filter((f) => (f.sourceType || "") === "system").length;
  const auto = fields.filter((f) => (f.sourceType || "") === "auto").length;
  const calc = fields.filter((f) => (f.sourceType || "") === "calc").length;
  return {
    total,
    manual,
    system,
    auto,
    calc,
    readyPercent: total ? Math.floor(((system + auto + calc) / total) * 100) : 100,
  };
}

/** نص عمود «الحقول» بالقائمة — مرآة fields_txt */
export function fieldsColumnText(fieldsCount: number, readyPercent: number): string {
  return `${fieldsCount} · جاهزية ${readyPercent}%`;
}

/**
 * شارة حالة القالب — مرآة STATUS_COLORS المكتبية (style.py:123):
 * معتمد INFO أزرق · مسودة NEUTRAL_SOFT باهت · معطل/مؤرشف خارج الجدول ⇒
 * الرمادي الافتراضي STATUS_DEFAULT (كقاعدة الشارات الموحدة للويب).
 */
export function templateStatusBadgeClass(status: string): string {
  switch (status) {
    case "معتمد":
      return "bg-status-info-bg text-status-info";
    case "مسودة":
    case "معطل":
    case "مؤرشف":
      return "bg-secondary text-secondary-foreground";
    default:
      return "bg-secondary text-secondary-foreground";
  }
}

// ============================================================
// رسائل الحرس الحرفية (form_service/word_forms_service)
// ============================================================

export const MSG_TEMPLATE_NAME_REQUIRED = "اسم النموذج مطلوب.";
export const MSG_TEMPLATE_BAD_STATUS = "حالة النموذج غير صحيحة.";
export const MSG_TEMPLATE_NOT_FOUND = "النموذج غير موجود.";
export const MSG_TEMPLATE_DUP_UPDATE = "يوجد نموذج آخر بنفس الاسم.";
export const MSG_TEMPLATE_DUP_IMPORT = "يوجد نموذج بنفس الاسم.";
export const MSG_CHOOSE_DOCX = "اختر ملف Word بصيغة .docx";
export const MSG_CORRUPT_DOCX = "تعذر قراءة ملف Word. تأكد أنه غير تالف وغير مفتوح.";
export const MSG_NOT_WORD_TEMPLATE = "هذا النموذج ليس قالب Word.";
export const MSG_WORD_FILE_MISSING = "ملف Word الأصلي للنموذج مفقود.";
export const MSG_DELETE_USED = "لا يمكن حذف النموذج لأنه استُخدم في مستندات محفوظة. يمكنك أرشفته بدل الحذف.";
export const MSG_ONLY_WORD_ENGINE = "محرك النماذج الحالي يدعم Word فقط.";
export const MSG_FIELD_REQUIRED_PREFIX = "الحقل مطلوب: ";
export const MSG_RENDER_FAILED = "تعذر توليد المستند من القالب. تحقق من وسوم {{}} داخل الملف.";
export const MSG_CUSTOMER_NOT_FOUND = "العميل غير موجود.";
export const MSG_CONTRACT_NOT_FOUND = "العقد غير موجود.";
export const MSG_QUOTATION_NOT_FOUND = "عرض السعر غير موجود.";
export const MSG_CATEGORY_NAME_REQUIRED = "اسم التصنيف مطلوب.";
export const MSG_CATEGORY_DUP = "يوجد تصنيف بنفس الاسم.";
export const MSG_DOC_NOT_FOUND = "المستند غير موجود.";
export const MSG_NO_FILE = "ملف Word غير موجود.";
export const MSG_WORD_ONLY_EXT = "قوالب النماذج يجب أن تكون Word بصيغة .docx";
export const MSG_UPLOAD_SUCCESS_PREFIX = "تم رفع القالب. الحقول: ";

/** بادئة التخزين البروتوكولية داخل أعمدة wordPath النصية (قرار بند 56 الموثق) */
export const B64_PREFIX = "base64:";
