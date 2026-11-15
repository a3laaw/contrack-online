import "server-only";

/**
 * مصمم المستندات التعاقدية — الخادمي: التحقق + توليد المستند من القالب ببيانات فعلية
 * docs/contract-template-design.md — D4 (الدفعات من قالب النوع حصرًا) · D5 (BOQ جاهزة حصرًا)
 * · D8 (حقول ربط {{...}} وغير المربوط يبقى نصًا) — الجلسة 2026-11-15 (7).
 */

import { db } from "@/lib/db";
import { getSettingsRow } from "@/lib/contrack-server";
import {
  BLOCK_TYPES,
  DOC_JSON_MAX_CHARS,
  DOC_KINDS,
  buildStarterTemplate,
  cell,
  isDocLike,
  p,
  replaceTokens,
  row,
  table,
  type ClauseAttr,
  type DocTemplateKind,
  type PartyAttr,
  type TNode,
} from "@/lib/doc-template-core";

// ===== التحقق الخادمي لإدخال القالب =====

export interface DocTemplateInputValues {
  name: string;
  kind: DocTemplateKind;
  contractTypeId: number | null;
  status: string;
  contentJson: string;
}

export class DocTemplateError extends Error {}

const DOC_STATUSES = ["مسودة", "معتمد"] as const;

export async function validateDocTemplateInput(
  body: Record<string, unknown>
): Promise<{ error: string } | { values: DocTemplateInputValues }> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "اسم القالب مطلوب." };
  if (name.length > 120) return { error: "اسم القالب طويل جدًا (بحدود 120 حرفًا)." };

  const kind = body.kind as DocTemplateKind;
  if (!kind || !DOC_KINDS.includes(kind)) {
    return { error: "نوع القالب غير صالح (قالب عرض سعر أو قالب نوع عقد)." };
  }

  let contractTypeId: number | null = null;
  if (kind === "contract_type") {
    const idNum = Number(body.contractTypeId);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return { error: "قالب نوع العقد يجب أن يكون مربوطًا بنوع عقد." };
    }
    const type = await db.contractType.findUnique({ where: { id: idNum } });
    if (!type) return { error: "نوع العقد المختار غير موجود." };
    contractTypeId = idNum;
  }

  const status = typeof body.status === "string" && (DOC_STATUSES as readonly string[]).includes(body.status)
    ? body.status
    : "مسودة";

  let contentJson: string;
  const rawContent = body.contentJson;
  if (rawContent === undefined || rawContent === null || rawContent === "") {
    // قالب ابتدائي جاهز بستايل العقود المرجعية — D10
    const contractType = contractTypeId
      ? await db.contractType.findUnique({ where: { id: contractTypeId } })
      : null;
    contentJson = JSON.stringify(buildStarterTemplate(kind, contractType?.name ?? null));
  } else {
    if (typeof rawContent !== "string") return { error: "جسم القالب غير صالح." };
    if (rawContent.length > DOC_JSON_MAX_CHARS) return { error: "جسم القالب يتجاوز الحد المسموح." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return { error: "جسم القالب ليس JSON صالحًا." };
    }
    if (!isDocLike(parsed)) return { error: "بنية القالب غير صالحة (مستند TipTap مطلوب)." };
    contentJson = rawContent;
  }

  return { values: { name, kind, contractTypeId, status, contentJson } };
}

// ===== سياق التوليد =====

export interface RenderPaymentRow {
  payNo: number;
  title: string;
  stageName: string;
  pct: number;
  amountFixed: number;
  daysOffset: number;
}

export interface RenderBoqItem {
  itemNo: string;
  divisionName: string;
  description: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface RenderContext {
  tokens: Record<string, string>;
  currency: string;
  payments: RenderPaymentRow[];
  quotationTotal: number | null;
  quotationNumber: string | null;
  quotationItems: { description: string; unit: string; quantity: number; unitPrice: number; totalPrice: number }[];
  boqDocs: Map<number, { name: string; items: RenderBoqItem[]; grandTotal: number }>;
  hasQuotation: boolean;
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-KW-u-nu-latn", { dateStyle: "medium" }).format(date);
}

/** يجمع معرفات وثائق BOQ المشار إليها في كتل القالب (D5 — وثائق جاهزة حصرًا) */
export function collectBoqIds(content: TNode): number[] {
  const ids = new Set<number>();
  const walk = (node: TNode) => {
    if (node.type === BLOCK_TYPES.boq) {
      const id = Number((node.attrs as { boqDocId?: unknown } | undefined)?.boqDocId);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
    node.content?.forEach(walk);
  };
  walk(content);
  return Array.from(ids);
}

export async function buildRenderContext(params: {
  templateContent: TNode;
  contractTypeId: number | null;
  quotationId?: number | null;
}): Promise<RenderContext> {
  const { templateContent, contractTypeId } = params;
  const quotationId = params.quotationId && Number.isFinite(Number(params.quotationId))
    ? Number(params.quotationId)
    : null;

  const settings = await getSettingsRow();
  const clientAddressParts = (parts: string[]) => parts.filter((x) => x && x.trim()).join(" — ");

  const quotation = quotationId
    ? await db.quotation.findUnique({
        where: { id: quotationId },
        include: {
          customer: true,
          project: true,
          items: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
        },
      })
    : null;
  if (quotationId && !quotation) throw new DocTemplateError("العرض المطلوب غير موجود.");

  const payments = contractTypeId
    ? await db.typePaymentTemplate.findMany({
        where: { contractTypeId },
        orderBy: { payNo: "asc" as const },
        include: { triggerStage: { select: { stageName: true } } },
      })
    : [];

  const boqIds = collectBoqIds(templateContent);
  const boqDocs = new Map<number, { name: string; items: RenderBoqItem[]; grandTotal: number }>();
  if (boqIds.length > 0) {
    const docs = await db.boqDoc.findMany({
      where: { id: { in: boqIds } },
      include: { items: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] } },
    });
    for (const d of docs) {
      if (d.status !== "ready") continue; // D5: الوثائق الجاهزة حصرًا — المسودة لا تُصيَّر
      const items: RenderBoqItem[] = d.items.map((it) => ({
        itemNo: it.itemNo,
        divisionName: it.divisionName,
        description: it.description,
        unit: it.unit,
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
      }));
      const grandTotal = items.reduce((s, it) => s + it.amount, 0);
      boqDocs.set(d.id, { name: d.name, items, grandTotal });
    }
  }

  const tokens: Record<string, string> = {
    "company.name": settings.companyName || "",
    "company.phone": settings.companyPhone || "",
    "company.email": settings.companyEmail || "",
    "company.address": settings.companyAddress || "",
    "company.currency": settings.currency || "د.ك",
  };
  if (quotation) {
    tokens["quotation.number"] = quotation.quotationNumber;
    tokens["quotation.date"] = fmtDate(quotation.createdAt);
    tokens["quotation.total"] = `${fmtNumber(Number(quotation.totalAmount))} ${settings.currency || "د.ك"}`;
    tokens["quotation.valid_until"] = quotation.validUntil || "";
    tokens["client.name"] = quotation.customer?.name || "";
    tokens["client.phone"] = quotation.customer?.phone || "";
    tokens["client.email"] = quotation.customer?.email || "";
    tokens["client.address"] =
      quotation.customer?.address ||
      clientAddressParts([
        quotation.customer?.governorate,
        quotation.customer?.area,
        quotation.customer?.block,
        quotation.customer?.plot,
      ]);
    if (quotation.project) {
      tokens["project.name"] = quotation.project.name;
      tokens["project.location"] = quotation.project.location;
    }
  }

  return {
    tokens,
    currency: settings.currency || "د.ك",
    payments: payments.map((t) => ({
      payNo: t.payNo,
      title: t.title,
      stageName: t.triggerStage?.stageName || "",
      pct: Number(t.pct),
      amountFixed: Number(t.amountFixed),
      daysOffset: t.daysOffset,
    })),
    quotationTotal: quotation ? Number(quotation.totalAmount) : null,
    quotationNumber: quotation ? quotation.quotationNumber : null,
    quotationItems: quotation
      ? quotation.items.map((it) => ({
          description: it.description,
          unit: it.unit,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          totalPrice: Number(it.totalPrice),
        }))
      : [],
    boqDocs,
    hasQuotation: Boolean(quotation),
  };
}

// ===== محرك الصياغة — استبدال الكتل ببيانات فعلية =====

const italicMark = { type: "italic" };

function placeholderNote(text: string): TNode {
  return p(text, [italicMark]);
}

function replaceAttrsDeep(attrs: Record<string, unknown>, tokens: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "string") out[k] = replaceTokens(v, tokens);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? replaceTokens(x, tokens) : x));
    else out[k] = v;
  }
  return out;
}

function paymentValueText(t: RenderPaymentRow, ctx: RenderContext): string {
  const cur = ctx.currency;
  if (t.pct > 0) {
    const pctText = `${fmtNumber(t.pct)}%`;
    if (ctx.quotationTotal && ctx.quotationTotal > 0) {
      const amount = (ctx.quotationTotal * t.pct) / 100;
      return `${pctText} (${fmtNumber(amount)} ${cur})`;
    }
    return pctText;
  }
  if (t.amountFixed > 0) return `${fmtNumber(t.amountFixed)} ${cur}`;
  return "—";
}

function buildPaymentsTable(ctx: RenderContext): TNode {
  if (ctx.payments.length === 0) {
    return placeholderNote(
      "كتلة الدفعات — اربط القالب بنوع عقد يحتوي «قالب دفعات» ليُملأ هذا الجدول من النوع عند التوليد (لا إدخال مزدوج)."
    );
  }
  const header = row([
    cell("اسم المرحلة", { header: true, bold: true }),
    cell(`الدفعة المستحقة (${ctx.currency})`, { header: true, bold: true }),
    cell("مدة التنفيذ", { header: true, bold: true }),
  ]);
  const rows: TNode[] = ctx.payments.map((t) =>
    row([
      cell(t.title || t.stageName || `دفعة ${t.payNo}`),
      cell(paymentValueText(t, ctx)),
      cell(t.daysOffset > 0 ? `${t.daysOffset} يوم` : "—"),
    ])
  );
  const pctSum = ctx.payments.reduce((s, t) => s + t.pct, 0);
  const totalText =
    pctSum > 0
      ? ctx.quotationTotal && ctx.quotationTotal > 0
        ? `${fmtNumber(ctx.quotationTotal)} ${ctx.currency}`
        : `${fmtNumber(pctSum)}%`
      : `${fmtNumber(ctx.payments.reduce((s, t) => s + t.amountFixed, 0))} ${ctx.currency}`;
  rows.push(row([cell("الإجمالي", { bold: true }), cell(totalText, { bold: true }), cell("")]));
  return table([header, ...rows]);
}

function buildItemsTable(ctx: RenderContext): TNode {
  if (!ctx.hasQuotation || ctx.quotationItems.length === 0) {
    return placeholderNote("جدول بنود العرض السعري — يُملأ تلقائيًا من بنود العرض عند «توليد المستند».");
  }
  const header = row([
    cell("م", { header: true, bold: true }),
    cell("البيان", { header: true, bold: true }),
    cell("الوحدة", { header: true, bold: true }),
    cell("الكمية", { header: true, bold: true }),
    cell("سعر الوحدة", { header: true, bold: true }),
    cell("الإجمالي", { header: true, bold: true }),
  ]);
  const rows: TNode[] = ctx.quotationItems.map((it, i) =>
    row([
      cell(String(i + 1)),
      cell(it.description),
      cell(it.unit || "—"),
      cell(fmtNumber(it.quantity)),
      cell(fmtNumber(it.unitPrice)),
      cell(fmtNumber(it.totalPrice)),
    ])
  );
  const total = ctx.quotationTotal ?? ctx.quotationItems.reduce((s, it) => s + it.totalPrice, 0);
  rows.push(
    row([
      cell("الإجمالي", { colspan: 5, bold: true }),
      cell(`${fmtNumber(total)} ${ctx.currency}`, { bold: true }),
    ])
  );
  return table([header, ...rows]);
}

function buildBoqTables(attrs: Record<string, unknown>, ctx: RenderContext): TNode[] {
  const id = Number(attrs.boqDocId);
  const doc = Number.isFinite(id) && id > 0 ? ctx.boqDocs.get(id) : undefined;
  if (!doc) {
    return [
      placeholderNote(
        "كتلة BOQ — اختر وثيقة بحالة «جاهزة للربط» من داخل الكتلة في المحرر، وعند التوليد تُصيَّر أقسامها وبنودها وإجمالياتها نسخةً لا مرجع."
      ),
    ];
  }
  const nodes: TNode[] = [p(`جدول الكميات: ${doc.name}`, [{ type: "bold" }])];
  const rows: TNode[] = [
    row([
      cell("م", { header: true, bold: true }),
      cell("البند", { header: true, bold: true }),
      cell("البيان", { header: true, bold: true }),
      cell("الوحدة", { header: true, bold: true }),
      cell("الكمية", { header: true, bold: true }),
      cell("سعر الوحدة", { header: true, bold: true }),
      cell("الإجمالي", { header: true, bold: true }),
    ]),
  ];
  // تجميع بأسماء الأقسام مع الحفاظ على ترتيب أول ظهور — ثم مجموع لكل قسم ثم الإجمالي الكلي
  const divisions: { name: string; items: RenderBoqItem[] }[] = [];
  for (const it of doc.items) {
    const key = it.divisionName || "بنود عامة";
    let bucket = divisions.find((d) => d.name === key);
    if (!bucket) {
      bucket = { name: key, items: [] };
      divisions.push(bucket);
    }
    bucket.items.push(it);
  }
  let counter = 0;
  for (const division of divisions) {
    rows.push(row([cell(division.name, { colspan: 7, bold: true })]));
    let subtotal = 0;
    for (const it of division.items) {
      counter += 1;
      subtotal += it.amount;
      rows.push(
        row([
          cell(String(counter)),
          cell(it.itemNo || "—"),
          cell(it.description),
          cell(it.unit || "—"),
          cell(fmtNumber(it.qty)),
          cell(fmtNumber(it.unitPrice)),
          cell(fmtNumber(it.amount)),
        ])
      );
    }
    rows.push(
      row([
        cell(`إجمالي القسم: ${division.name}`, { colspan: 6, bold: true }),
        cell(`${fmtNumber(subtotal)} ${ctx.currency}`, { bold: true }),
      ])
    );
  }
  rows.push(
    row([
      cell("الإجمالي الكلي", { colspan: 6, bold: true }),
      cell(`${fmtNumber(doc.grandTotal)} ${ctx.currency}`, { bold: true }),
    ])
  );
  nodes.push(table(rows));
  return nodes;
}

function buildClauseList(attrs: Record<string, unknown>, tokens: Record<string, string>): TNode {
  const clauses = (Array.isArray(attrs.clauses) ? attrs.clauses : []) as ClauseAttr[];
  if (clauses.length === 0) return placeholderNote("كتلة بنود فارغة — أضف بنودًا من داخل الكتلة في المحرر.");
  return {
    type: "orderedList",
    content: clauses.map((c) => ({
      type: "listItem",
      content: [p(replaceTokens(c.text || "", tokens), c.bold ? [{ type: "bold" }] : undefined)],
    })),
  };
}

function partyParagraphs(party: PartyAttr, tokens: Record<string, string>): TNode[] {
  const filled: PartyAttr = {
    role: replaceTokens(party.role || "", tokens),
    name: replaceTokens(party.name || "", tokens),
    rep: replaceTokens(party.rep || "", tokens),
    civilId: replaceTokens(party.civilId || "", tokens),
    phone: replaceTokens(party.phone || "", tokens),
    email: replaceTokens(party.email || "", tokens),
  };
  const nodes: TNode[] = [p(`${filled.role}:`, [{ type: "bold" }])];
  if (filled.name) nodes.push(p(filled.name, [{ type: "bold" }, { type: "underline" }]));
  if (filled.rep) nodes.push(p(`الممثل: ${filled.rep}`));
  if (filled.civilId) nodes.push(p(`الرقم المدني: ${filled.civilId}`));
  if (filled.phone) nodes.push(p(`الهاتف: ${filled.phone}`));
  if (filled.email) nodes.push(p(`البريد الإلكتروني: ${filled.email}`));
  return nodes;
}

function buildParties(attrs: Record<string, unknown>, tokens: Record<string, string>): TNode[] {
  const p1 = (attrs.p1 as PartyAttr | undefined) ?? null;
  const p2 = (attrs.p2 as PartyAttr | undefined) ?? null;
  const nodes: TNode[] = [];
  if (p1) nodes.push(...partyParagraphs(p1, tokens));
  if (p2) {
    nodes.push(p(""));
    nodes.push(...partyParagraphs(p2, tokens));
  }
  if (nodes.length === 0) return [placeholderNote("كتلة أطراف فارغة — أضف بيانات الطرفين من داخل الكتلة.")];
  return nodes;
}

/** يستبدل الكتل الموسومة ببيانات فعلية ويطبق حقول الربط {{...}} على كل النصوص — D8 */
export function renderDocTemplate(content: TNode, ctx: RenderContext): TNode {
  const walkNodes = (nodes: TNode[]): TNode[] => nodes.flatMap(walkOne);
  const walkOne = (node: TNode): TNode[] => {
    switch (node.type) {
      case BLOCK_TYPES.payments:
        return [buildPaymentsTable(ctx)];
      case BLOCK_TYPES.itemsTable:
        return [buildItemsTable(ctx)];
      case BLOCK_TYPES.boq:
        // كتلة BOQ تتوسع إلى أكثر من عقدة (عنوان + جدول كامل بنسخة من الوثيقة — لا مرجع)
        return buildBoqTables(node.attrs ?? {}, ctx);
      case BLOCK_TYPES.clause:
        return [buildClauseList(node.attrs ?? {}, ctx.tokens)];
      case BLOCK_TYPES.parties:
        return buildParties(node.attrs ?? {}, ctx.tokens);
      case BLOCK_TYPES.signature:
        return [{ type: node.type, attrs: replaceAttrsDeep(node.attrs ?? {}, ctx.tokens) }];
      default: {
        const out: TNode = { ...node };
        if (node.text !== undefined) out.text = replaceTokens(node.text, ctx.tokens);
        if (node.attrs) out.attrs = replaceAttrsDeep(node.attrs, ctx.tokens);
        if (node.content) out.content = walkNodes(node.content);
        return [out];
      }
    }
  };
  return { type: "doc", content: walkNodes(content.content ?? []) };
}
