import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeArabic } from "@/lib/api-utils";
import { B64_PREFIX, analyzeFields, formDocNumber, sortTemplates } from "./forms-core";
import type { FormFieldRow, FillContext } from "./forms-core";

/**
 * طبقة قاعدة البيانات لمركز النماذج (بند 56) — مرآة دوال form_service/
 * word_forms_service مع خزائن الويب: القوالب والمستندات base64 في wordPath.
 */

export interface CategoryRow {
  id: number;
  name: string;
  sort: number;
  templatesCount: number;
}

export async function listCategories(): Promise<CategoryRow[]> {
  const rows = await db.formCategory.findMany({
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    include: { _count: { select: { templates: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    sort: c.sort,
    templatesCount: c._count.templates,
  }));
}

export async function createCategory(name: string): Promise<CategoryRow> {
  const last = await db.formCategory.findFirst({ orderBy: [{ sort: "desc" }] });
  const row = await db.formCategory.create({
    data: { name, sort: (last?.sort ?? 0) + 1 },
  });
  return { id: row.id, name: row.name, sort: row.sort, templatesCount: 0 };
}

export interface TemplateListRow {
  id: number;
  baseName: string;
  version: number;
  description: string;
  categoryId: number | null;
  categoryName: string;
  status: string;
  fieldsCount: number;
  documentsCount: number;
  readyPercent: number;
  printIdentity: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** قائمة القوالب بفلاتر المكتبي — مرآة list_templates (بحث مطبَّع/تصنيف/حالة) */
export async function listTemplates(
  opts: { q?: string; categoryId?: number; status?: string } = {}
): Promise<TemplateListRow[]> {
  const where: Prisma.FormTemplateWhereInput = {
    sourceType: "word",
  };
  if (opts.categoryId && opts.categoryId > 0) where.categoryId = opts.categoryId;
  if (opts.status) where.status = opts.status;
  const q = (opts.q || "").trim();
  if (q) {
    const nq = normalizeArabic(q);
    where.OR = [
      { baseName: { contains: q } },
      { description: { contains: q } },
      { category: { name: { contains: q } } },
      // احتياط التطبيع العربي (أ/إ/آ وة/ى) كما في normalized_search_clause
      ...(nq !== q.toLowerCase()
        ? [{ baseName: { contains: nq } }, { description: { contains: nq } }, { category: { name: { contains: nq } } }]
        : []),
    ];
  }
  const rows = await db.formTemplate.findMany({
    where,
    include: {
      category: { select: { name: true } },
      _count: { select: { fields: true, documents: true } },
    },
  });
  // جاهزية الربط — مرآة wfs.analyze_template على حقول القوالب المعروضة
  const ids = rows.map((t) => t.id);
  const fieldRows = ids.length
    ? await db.formField.findMany({
        where: { templateId: { in: ids } },
        select: { templateId: true, sourceType: true },
      })
    : [];
  const byTemplate = new Map<number, Array<{ sourceType: string }>>();
  for (const f of fieldRows) {
    const arr = byTemplate.get(f.templateId) ?? [];
    arr.push({ sourceType: f.sourceType });
    byTemplate.set(f.templateId, arr);
  }
  const mapped = rows.map((t) => ({
    id: t.id,
    baseName: t.baseName,
    version: t.version,
    description: t.description,
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? "",
    status: t.status,
    fieldsCount: t._count.fields,
    documentsCount: t._count.documents,
    readyPercent: analyzeFields(byTemplate.get(t.id) ?? []).readyPercent,
    printIdentity: t.printIdentity,
    createdBy: t.createdBy,
    updatedBy: t.updatedBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));
  return sortTemplates(mapped);
}

export interface TemplateFieldOut {
  id: number;
  name: string;
  placeholder: string;
  fieldType: string;
  sourceType: string;
  sourceEntity: string;
  sourceKey: string;
  defaultValue: string;
  required: boolean;
  sort: number;
}

export interface TemplateDetail {
  id: number;
  baseName: string;
  version: number;
  description: string;
  categoryId: number | null;
  categoryName: string;
  status: string;
  printIdentity: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  documentsCount: number;
  fields: TemplateFieldOut[];
}

export async function getTemplateDetail(id: number): Promise<TemplateDetail | null> {
  const t = await db.formTemplate.findUnique({
    where: { id },
    include: {
      category: { select: { name: true } },
      fields: { orderBy: [{ sort: "asc" }, { id: "asc" }] },
      _count: { select: { documents: true } },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    baseName: t.baseName,
    version: t.version,
    description: t.description,
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? "",
    status: t.status,
    printIdentity: t.printIdentity,
    createdBy: t.createdBy,
    updatedBy: t.updatedBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    documentsCount: t._count.documents,
    fields: t.fields.map((f) => ({
      id: f.id,
      name: f.name,
      placeholder: f.placeholder || f.name,
      fieldType: f.fieldType,
      sourceType: f.sourceType,
      sourceEntity: f.sourceEntity,
      sourceKey: f.sourceKey,
      defaultValue: f.defaultValue,
      required: f.required,
      sort: f.sort,
    })),
  };
}

export interface UploadInput {
  baseName: string;
  description: string;
  categoryId: number | null;
  createdBy: string;
  buffer: Buffer;
  fields: Array<{ name: string; sourceType: string; sourceEntity: string; sourceKey: string; context: string; fieldType: string; required: boolean }>;
}

/** إنشاء قالب من رفع Word — مرآة import_docx (مسودة أولًا والاعتماد خطوة صريحة) */
export async function createTemplateFromUpload(
  input: UploadInput
): Promise<{ id: number; baseName: string; version: number }> {
  return db.$transaction(async (tx) => {
    const tpl = await tx.formTemplate.create({
      data: {
        baseName: input.baseName,
        version: 1,
        description: input.description,
        categoryId: input.categoryId,
        status: "مسودة",
        sourceType: "word",
        printIdentity: "none",
        wordPath: B64_PREFIX + input.buffer.toString("base64"),
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      },
    });
    await tx.formField.createMany({
      data: input.fields.map((f, i) => ({
        templateId: tpl.id,
        name: f.name,
        placeholder: f.name,
        fieldType: f.fieldType,
        sourceType: f.sourceType,
        sourceEntity: f.sourceEntity,
        sourceKey: f.sourceKey,
        context: f.context,
        required: f.required,
        sort: i + 1,
      })),
    });
    return { id: tpl.id, baseName: tpl.baseName, version: tpl.version };
  });
}

/** تعديل بيانات النموذج الخارجية — مرآة update_template_meta */
export async function updateTemplateMeta(
  id: number,
  data: { baseName?: string; description?: string; status?: string; updatedBy: string }
): Promise<void> {
  const patch: Prisma.FormTemplateUpdateInput = { updatedBy: data.updatedBy };
  if (data.baseName !== undefined) patch.baseName = data.baseName;
  if (data.description !== undefined) patch.description = data.description;
  if (data.status !== undefined) patch.status = data.status;
  await db.formTemplate.update({ where: { id }, data: patch });
}

/** حذف قالب غير مستخدم — مرآة delete_template (حراسة المستندات على المستدعي) */
export async function deleteTemplate(id: number): Promise<void> {
  await db.formTemplate.delete({ where: { id } });
}

export async function templateDocumentsCount(id: number): Promise<number> {
  return db.formDocument.count({ where: { templateId: id } });
}

// ============================================================
// المستندات المولدة
// ============================================================

export interface DocumentListRow {
  id: number;
  docNumber: string;
  title: string;
  templateId: number;
  templateName: string;
  templateVersion: number;
  customerId: number | null;
  customerName: string;
  contractId: number | null;
  contractNumber: string;
  createdBy: string;
  createdAt: string;
}

export async function listDocuments(
  opts: { templateId?: number; customerId?: number } = {}
): Promise<DocumentListRow[]> {
  const where: Prisma.FormDocumentWhereInput = {};
  if (opts.templateId && opts.templateId > 0) where.templateId = opts.templateId;
  if (opts.customerId && opts.customerId > 0) where.customerId = opts.customerId;
  const rows = await db.formDocument.findMany({
    where,
    orderBy: { id: "desc" },
    include: { template: { select: { baseName: true, version: true } } },
  });
  // FormDocument بلا علاقات عميل/عقد في المخطط (أعمدة بسيطة) — تُربط بأسمائها يدويًا
  const customerIds = [...new Set(rows.map((d) => d.customerId).filter((v): v is number => !!v))];
  const contractIds = [...new Set(rows.map((d) => d.contractId).filter((v): v is number => !!v))];
  const [customers, contracts] = await Promise.all<
    Array<{ id: number; name: string }> | Array<{ id: number; contractNumber: string }>
  >([
    customerIds.length
      ? db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    contractIds.length
      ? db.contract.findMany({ where: { id: { in: contractIds } }, select: { id: true, contractNumber: true } })
      : Promise.resolve([]),
  ]);
  const customerName = new Map<number, string>(
    (customers as Array<{ id: number; name: string }>).map((c) => [c.id, c.name])
  );
  const contractNumber = new Map<number, string>(
    (contracts as Array<{ id: number; contractNumber: string }>).map((c) => [c.id, c.contractNumber])
  );
  return rows.map((d) => ({
    id: d.id,
    docNumber: d.docNumber,
    title: d.title,
    templateId: d.templateId,
    templateName: d.template.baseName,
    templateVersion: d.template.version,
    customerId: d.customerId,
    customerName: d.customerId ? customerName.get(d.customerId) ?? "" : "",
    contractId: d.contractId,
    contractNumber: d.contractId ? contractNumber.get(d.contractId) ?? "" : "",
    createdBy: d.createdBy,
    createdAt: d.createdAt.toISOString(),
  }));
}

export interface DocumentBinary {
  id: number;
  docNumber: string;
  title: string;
  templateBaseName: string;
  buffer: Buffer;
}

/** جلب مستند مولد للتنزيل */
export async function getDocumentBinary(id: number): Promise<DocumentBinary | null> {
  const d = await db.formDocument.findUnique({
    where: { id },
    include: { template: { select: { baseName: true } } },
  });
  if (!d) return null;
  const stored = d.wordPath || "";
  if (!stored.startsWith(B64_PREFIX)) return null;
  const buffer = Buffer.from(stored.slice(B64_PREFIX.length), "base64");
  return {
    id: d.id,
    docNumber: d.docNumber,
    title: d.title,
    templateBaseName: d.template.baseName,
    buffer,
  };
}

/** رقم المستند التالي — مرآة _next_doc_number (COUNT+1) */
export async function nextFormDocNumber(): Promise<string> {
  const n = await db.formDocument.count();
  return formDocNumber(n + 1);
}

export interface GenerateRecordInput {
  templateId: number;
  templateVersion: number;
  docNumber: string;
  title: string;
  values: Record<string, string>;
  docBuffer: Buffer;
  customerId: number | null;
  contractId: number | null;
  createdBy: string;
}

export async function createDocumentRecord(
  tx: Prisma.TransactionClient,
  input: GenerateRecordInput
): Promise<{ id: number; docNumber: string }> {
  const row = await tx.formDocument.create({
    data: {
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      docNumber: input.docNumber,
      title: input.title,
      valuesJson: JSON.stringify(input.values),
      wordPath: B64_PREFIX + input.docBuffer.toString("base64"),
      customerId: input.customerId,
      contractId: input.contractId,
      createdBy: input.createdBy,
    },
  });
  return { id: row.id, docNumber: row.docNumber };
}

// ============================================================
// سياق التعبئة — مرآة build_context من كيانات الويب
// ============================================================

export interface RawFillContext {
  ctx: FillContext;
  currency: string;
}

export async function loadSettingsRow(): Promise<Record<string, unknown>> {
  const s = await db.setting.findUnique({ where: { id: 1 } });
  return (s as unknown as Record<string, unknown>) ?? {};
}

/** جلب صفوف السياق — لا سياق إن لم تُمرَّر معرفات (وضع حر كالمكتبي) */
export async function buildFillContext(
  ids: { customerId?: number | null; contractId?: number | null; quotationId?: number | null }
): Promise<RawFillContext> {
  const ctx: FillContext = {};
  const settings = await loadSettingsRow();
  ctx.settings = settings;
  ctx.now = new Date();
  const currency = typeof settings.currency === "string" && settings.currency ? settings.currency : "د.ك";

  if (ids.customerId) {
    const c = await db.customer.findUnique({ where: { id: ids.customerId } });
    if (c) ctx.customer = c as unknown as Record<string, unknown>;
  }
  if (ids.contractId) {
    const k = await db.contract.findUnique({
      where: { id: ids.contractId },
      include: { customer: { select: { name: true } } },
    });
    if (k) {
      const row = k as unknown as Record<string, unknown>;
      row.customer_name = (k.customer?.name as string) ?? "";
      ctx.contract = row;
      if (!ctx.customer && k.customerId) {
        const c = await db.customer.findUnique({ where: { id: k.customerId } });
        if (c) ctx.customer = c as unknown as Record<string, unknown>;
      }
    }
  }
  if (ids.quotationId) {
    const q = await db.quotation.findUnique({
      where: { id: ids.quotationId },
      include: {
        items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        customer: { select: { name: true } },
        project: { select: { name: true } },
      },
    });
    if (q) {
      const row = q as unknown as Record<string, unknown>;
      row.customer_name = (q.customer?.name as string) ?? "";
      row.project_name = (q.project?.name as string) ?? "";
      ctx.quotation = row;
      if (!ctx.customer && q.customerId) {
        const c = await db.customer.findUnique({ where: { id: q.customerId } });
        if (c) ctx.customer = c as unknown as Record<string, unknown>;
      }
    }
  }
  return { ctx, currency };
}

/** جلب مخزن القالب الأصلي للفحص/التوليد */
export async function getTemplateWordBuffer(id: number): Promise<Buffer | null> {
  const t = await db.formTemplate.findUnique({ where: { id }, select: { wordPath: true } });
  if (!t) return null;
  const stored = t.wordPath || "";
  if (!stored.startsWith(B64_PREFIX)) return null;
  try {
    return Buffer.from(stored.slice(B64_PREFIX.length), "base64");
  } catch {
    return null;
  }
}

/** حقول القالب كصفوف نقية للتوليد */
export function fieldsToRows(fields: TemplateFieldOut[]): FormFieldRow[] {
  return fields.map((f) => ({
    id: f.id,
    name: f.name,
    placeholder: f.placeholder,
    fieldType: f.fieldType,
    sourceType: f.sourceType,
    sourceEntity: f.sourceEntity,
    sourceKey: f.sourceKey,
    defaultValue: f.defaultValue,
    required: f.required,
  }));
}
