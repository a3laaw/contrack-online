import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError } from "@/lib/api-utils";
import {
  buildFillContext,
  createDocumentRecord,
  fieldsToRows,
  getTemplateDetail,
  getTemplateWordBuffer,
  nextFormDocNumber,
} from "@/lib/forms/forms-server";
import { renderTemplateDocx } from "@/lib/forms/docx";
import {
  buildFieldMapping,
  docFileName,
  missingRequiredManual,
  MSG_CONTRACT_NOT_FOUND,
  MSG_CUSTOMER_NOT_FOUND,
  MSG_FIELD_REQUIRED_PREFIX,
  MSG_NOT_WORD_TEMPLATE,
  MSG_QUOTATION_NOT_FOUND,
  MSG_RENDER_FAILED,
  MSG_TEMPLATE_NOT_FOUND,
  MSG_WORD_FILE_MISSING,
} from "@/lib/forms/forms-core";

type P = { params: Promise<{ id: string }> };

async function templateId(params: P["params"]): Promise<number | null> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function binaryResponse(buffer: Buffer, fileName: string, extra: Record<string, string> = {}) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

/**
 * توليد مستند Word من قالب (بند 56) — مرآة create_document/fill_word:
 * يجمع قيم المصادر النظامية من العميل/العقد/عرض السعر المختار + القيم اليدوية،
 * يولّد docx ويحمّله مباشرة ويسجل FormDocument بقيمه (valuesJson) ورقمه FD-%04d.
 * PDF غير متاح في الويب حالياً (تحويل المكتبي LibreOffice) — الإخراج Word فقط.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const id = await templateId(params);
  if (!id) return jsonError("معرف غير صالح");

  const template = await getTemplateDetail(id);
  if (!template) return jsonError(MSG_TEMPLATE_NOT_FOUND, 404);
  const raw = await db.formTemplate.findUnique({ where: { id }, select: { sourceType: true } });
  if (!raw || (raw.sourceType || "word") !== "word") return jsonError(MSG_NOT_WORD_TEMPLATE, 400);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const values: Record<string, string> = {};
  const rawValues = (body.values ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawValues)) values[k] = String(v ?? "");

  const customerId = Number(body.customerId || 0) || null;
  const contractId = Number(body.contractId || 0) || null;
  const quotationId = Number(body.quotationId || 0) || null;

  if (customerId && !(await db.customer.findUnique({ where: { id: customerId } }))) {
    return jsonError(MSG_CUSTOMER_NOT_FOUND, 400);
  }
  if (contractId && !(await db.contract.findUnique({ where: { id: contractId } }))) {
    return jsonError(MSG_CONTRACT_NOT_FOUND, 400);
  }
  if (quotationId && !(await db.quotation.findUnique({ where: { id: quotationId } }))) {
    return jsonError(MSG_QUOTATION_NOT_FOUND, 400);
  }

  // الحقول اليدوية الإلزامية — مرآة فحص WordFormFillDialog._generate
  const missing = missingRequiredManual(fieldsToRows(template.fields), values);
  if (missing.length > 0) {
    return jsonError(`${MSG_FIELD_REQUIRED_PREFIX}${missing[0]}`, 400);
  }

  const templateBuffer = await getTemplateWordBuffer(id);
  if (!templateBuffer) return jsonError(MSG_WORD_FILE_MISSING, 400);

  const { ctx, currency } = await buildFillContext({ customerId, contractId, quotationId });
  ctx.user = guard.user.username;

  const mapping = buildFieldMapping(fieldsToRows(template.fields), values, ctx, currency);

  let docBuffer: Buffer;
  try {
    docBuffer = renderTemplateDocx(templateBuffer, { data: mapping });
  } catch {
    return jsonError(MSG_RENDER_FAILED, 400);
  }

  const docNumber = await nextFormDocNumber();
  const title = String(body.title || "").trim() || template.baseName;

  const record = await db.$transaction(async (tx) => {
    const created = await createDocumentRecord(tx as Prisma.TransactionClient, {
      templateId: id,
      templateVersion: template.version,
      docNumber,
      title,
      values,
      docBuffer,
      customerId,
      contractId,
      createdBy: guard.user.username,
    });
    await audit(tx, {
      username: guard.user.username,
      action: "توليد مستند من نموذج",
      entityType: "form_document",
      entityId: created.id,
      entityName: `${created.docNumber} — ${title}`,
      reason: `قالب: ${template.baseName}`,
    });
    return created;
  });

  const fileName = docFileName(template.baseName, record.docNumber);
  return binaryResponse(docBuffer, fileName, {
    "X-Form-Document-Id": String(record.id),
    "X-Form-Document-Number": record.docNumber,
  });
}
