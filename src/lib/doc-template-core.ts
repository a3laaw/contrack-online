/**
 * مصمم المستندات التعاقدية — النواة المشتركة (عميل + خادم)
 * docs/contract-template-design.md — D2 (تخزين JSON) · D3 (قالبان) · D8 (حقول ربط {{...}})
 * · D10 (قالبان ابتدائيان بستايل العقود المرجعية) · D11 (سلسلة كتل حرة الترتيب).
 * ملف نقي بلا I/O ولا server-only — يُستخدم من المسارات الخادمية ومن مكونات المحرر.
 */

// ===== TipTap JSON — الشكل الأدنى المستخدم في القوالب =====

export interface TMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TNode[];
  marks?: TMark[];
  text?: string;
}

// ===== الأنواع والكتل الموسومة =====

export type DocTemplateKind = "quotation" | "contract_type";

export const DOC_KINDS: readonly DocTemplateKind[] = ["quotation", "contract_type"] as const;

export const KIND_LABEL: Record<DocTemplateKind, string> = {
  quotation: "قالب عرض سعر",
  contract_type: "قالب نوع عقد",
};

/** أصناف الكتل الموسومة داخل القالب (عُقد TipTap مخصصة) */
export const BLOCK_TYPES = {
  clause: "clauseBlock",
  payments: "paymentsBlock",
  boq: "boqBlock",
  itemsTable: "itemsTable",
  parties: "partiesBlock",
  signature: "signatureBlock",
} as const;

export interface ClauseAttr {
  text: string;
  bold?: boolean;
}

export interface PartyAttr {
  role: string;
  name: string;
  rep: string;
  civilId: string;
  phone: string;
  email: string;
}

export interface SignatureAttr {
  note: string;
  p1Role: string;
  p2Role: string;
}

// ===== DTOs — عقد /api/doc-templates الموثق =====

export interface DocTemplateMeta {
  id: number;
  kind: DocTemplateKind;
  contractTypeId: number | null;
  contractTypeName: string | null;
  name: string;
  status: string;
  updatedAt: string;
}

export interface DocTemplateFull extends DocTemplateMeta {
  contentJson: unknown;
}

export interface DocTemplateRenderMeta {
  contractTypeName: string | null;
  quotationNumber: string | null;
  quotationTotal: string | null;
  boqNames: string[];
  companyName: string;
}

export interface DocTemplateRenderResponse {
  doc: TNode;
  meta: DocTemplateRenderMeta;
}

// ===== كتالوج حقول الربط {{...}} — D8 (تُملأ لحظة التوليد، وغير المربوط يبقى نصًا) =====

export interface TokenDef {
  token: string;
  label: string;
}

export interface TokenGroup {
  group: string;
  tokens: TokenDef[];
}

export const TOKEN_CATALOG: TokenGroup[] = [
  {
    group: "الشركة",
    tokens: [
      { token: "{{company.name}}", label: "اسم الشركة" },
      { token: "{{company.phone}}", label: "هاتف الشركة" },
      { token: "{{company.email}}", label: "بريد الشركة" },
      { token: "{{company.address}}", label: "عنوان الشركة" },
      { token: "{{company.currency}}", label: "العملة" },
    ],
  },
  {
    group: "العرض",
    tokens: [
      { token: "{{quotation.number}}", label: "رقم العرض" },
      { token: "{{quotation.date}}", label: "تاريخ العرض" },
      { token: "{{quotation.total}}", label: "إجمالي العرض" },
      { token: "{{quotation.valid_until}}", label: "آخر صلاحية" },
    ],
  },
  {
    group: "العميل",
    tokens: [
      { token: "{{client.name}}", label: "اسم العميل" },
      { token: "{{client.phone}}", label: "هاتف العميل" },
      { token: "{{client.email}}", label: "بريد العميل" },
      { token: "{{client.address}}", label: "عنوان العميل" },
    ],
  },
  {
    group: "المشروع",
    tokens: [
      { token: "{{project.name}}", label: "اسم المشروع" },
      { token: "{{project.location}}", label: "موقع المشروع" },
    ],
  },
  {
    group: "نوع العقد",
    tokens: [{ token: "{{type.name}}", label: "اسم نوع العقد" }],
  },
];

export const TOKEN_PATTERN = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;

/** يستبدل الحقول المربوطة ويُبقي غير المربوط كما هو (مرآة nullGetter في مركز النماذج) */
export function replaceTokens(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN_PATTERN, (raw, key: string) => values[key] ?? raw);
}

// ===== بناء عُقد JSON أساسية =====

export function p(text: string, marks?: TMark[]): TNode {
  const node: TNode = { type: "paragraph" };
  if (text.length > 0) {
    const tn: TNode = { type: "text", text };
    if (marks && marks.length > 0) tn.marks = marks;
    node.content = [tn];
  }
  return node;
}

const boldMark: TMark = { type: "bold" };
const underlineMark: TMark = { type: "underline" };
const italicMark: TMark = { type: "italic" };

export function heading(text: string, level: 1 | 2 | 3, center = false): TNode {
  const node: TNode = { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
  if (center) node.attrs = { level, textAlign: "center" };
  return node;
}

export function cell(text: string, opts?: { header?: boolean; colspan?: number; bold?: boolean }): TNode {
  const type = opts?.header ? "tableHeader" : "tableCell";
  const node: TNode = { type, content: [p(text, opts?.bold ? [boldMark] : undefined)] };
  node.attrs = { colspan: opts?.colspan ?? 1, rowspan: 1 };
  return node;
}

export function row(cells: TNode[]): TNode {
  return { type: "tableRow", content: cells };
}

export function table(rows: TNode[]): TNode {
  return { type: "table", content: rows };
}

// ===== القالبان الابتدائيان — D10 (ستايل العقود المرجعية: عقد مقاول/مالك + عرض سعر) =====

/** كتلة أطراف العقد — مرآة «انه في يوم ... تم الاتفاق بين كل من» في العقود المرجعية */
export function starterParties(): TNode {
  return {
    type: BLOCK_TYPES.parties,
    attrs: {
      p1: {
        role: "الطرف الأول (المالك/السادة)",
        name: "{{client.name}}",
        rep: "",
        civilId: "",
        phone: "{{client.phone}}",
        email: "{{client.email}}",
      },
      p2: {
        role: "الطرف الثاني (المقاول/الشركة)",
        name: "{{company.name}}",
        rep: "",
        civilId: "",
        phone: "{{company.phone}}",
        email: "{{company.email}}",
      },
    },
  };
}

export function starterSignatures(): TNode {
  return {
    type: BLOCK_TYPES.signature,
    attrs: {
      note: "حرر هذا العقد من نسختين أصليتين بيد كل طرف نسخة للعمل بموجبها عند الحاجة.",
      p1Role: "الطرف الأول",
      p2Role: "الطرف الثاني",
    },
  };
}

export function buildStarterTemplate(kind: DocTemplateKind, contractTypeName?: string | null): TNode {
  if (kind === "quotation") {
    return {
      type: "doc",
      content: [
        heading("عرض سعر", 1, true),
        p("السادة / {{client.name}} المحترمون"),
        p("تحية طيبة وبعد،"),
        p(
          "نشكر لكم اهتمامكم بخدماتنا، ويسرنا أن نقدم لكم عرض السعر التالي بناءً على طلبكم:",
          [boldMark]
        ),
        { type: BLOCK_TYPES.itemsTable },
        p("الإجمالي الكلي: {{quotation.total}} — ويظل ساريًا حتى {{quotation.valid_until}}.", [
          boldMark,
        ]),
        heading("الشروط والأحكام", 2),
        {
          type: BLOCK_TYPES.clause,
          attrs: {
            clauses: [
              { text: "صلاحية العرض: هذا العرض ساري لمدة ٣٠ يومًا من تاريخ إصداره.", bold: true },
              { text: "نطاق التوريد: يشمل هذا العرض الأعمال والبنود المذكورة أعلاه حصرًا." },
              { text: "شروط الدفع: تُسدد القيمة وفق جدول الدفعات المتفق عليه عند توقيع العقد." },
              { text: "الاستثناءات: لا يشمل هذا العرض أي أعمال إضافية غير متضمنة في جدول البنود." },
            ],
          },
        },
        starterSignatures(),
      ],
    };
  }

  // قالب نوع عقد — بنية مرآة العقد البنيوي المرجعي (عقد المالك 12ص): تمهيد + بنود عليا + دفعات + توقيعات
  return {
    type: "doc",
    content: [
      heading(contractTypeName ? contractTypeName : "عقد مقاولات", 1, true),
      p("تم الاتفاق بين كل من:", [boldMark, underlineMark]),
      starterParties(),
      p(
        "إنه في يوم ____ الموافق {{quotation.date}} تم الاتفاق بين الطرفين على ما يلي:",
        [boldMark]
      ),
      heading("البند الأول: تمهيد", 2),
      p(
        "يعتبر التمهيد أعلاه جزءًا لا يتجزأ من هذا العقد ومكمّلًا لشروطه وأحكامه.",
        [italicMark, underlineMark]
      ),
      heading("البند الثاني: نطاق الأعمال", 2),
      p("يقع على عاتق الطرف الثاني تنفيذ الأعمال التالية وفقًا للمواصفات المتفق عليها:"),
      {
        type: BLOCK_TYPES.clause,
        attrs: {
          clauses: [
            { text: "تنفيذ الأعمال المتفق عليها وفق الجداول واللوحات المعتمدة.", bold: true },
            { text: "توريد المواد والعمالة والأدوات اللازمة لإتمام الأعمال." },
            { text: "الالتزام بتعليمات الطرف الأول ومندوبه الإشرافي الميداني." },
          ],
        },
      },
      heading("البند الثالث: قيمة العقد والدفعات", 2),
      p("قيمة العقد الإجمالية: {{quotation.total}}، وتُسدد الدفعات وفق الجدول التالي:"),
      { type: BLOCK_TYPES.payments },
      p("ملحوظة: يمكن إدراج وثيقة جدول الكميات BOQ من زر «كتلة BOQ» في شريط الأدوات.", [
        italicMark,
      ]),
      { type: BLOCK_TYPES.boq, attrs: { boqDocId: null } },
      heading("البند الرابع: الالتزامات العامة", 2),
      {
        type: BLOCK_TYPES.clause,
        attrs: {
          clauses: [
            { text: "غرامة التأخير: تُطبق غرامة تعاقدية عند تأخر التنفيذ عن المدة المتفق عليها.", bold: true },
            { text: "تسوية المنازعات: يُحل أي خلاف بين الطرفين بالتفاهم الودي ثم عبر الجهات المختصة." },
            { text: "نسخ العقد: حُرر هذا العقد من نسختين بيد كل طرف نسخة للعمل بموجبها." },
          ],
        },
      },
      starterSignatures(),
    ],
  };
}

// ===== التحقق البنيوي قبل الحفظ (قاعدة §7 من التصميم) =====

/** سقف حجم JSON المسموح — نص حر + كتل، وحجم القوالب الحقيقية أقل من ذلك بكثير */
export const DOC_JSON_MAX_CHARS = 800_000;

export function isDocLike(value: unknown): value is TNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as TNode;
  if (v.type !== "doc") return false;
  if (!Array.isArray(v.content)) return false;
  return true;
}
