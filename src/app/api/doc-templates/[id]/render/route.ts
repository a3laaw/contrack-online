/**
 * /api/doc-templates/[id]/render — توليد مستند فعلي من القالب (ر7/ج — التصميم §7)
 * body: { quotationId? } — قالب العرض يُولّد من عرض قائم، وقالب النوع يُعاين من قالب الدفعات.
 * يدمج الكتل الموسومة ببيانات النظام (D4 دفعات النوع · D5 BOQ جاهزة · D8 حقول الربط).
 */
import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { isDocLike, type TNode } from "@/lib/doc-template-core";
import {
  DocTemplateError,
  buildRenderContext,
  fmtNumber,
  renderDocTemplate,
} from "@/lib/doc-template-server";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const template = await db.docTemplate.findUnique({
    where: { id },
    include: { contractType: { select: { name: true } } },
  });
  if (!template) return jsonError("القالب غير موجود", 404);

  let content: TNode;
  try {
    const parsed = JSON.parse(template.contentJson) as TNode;
    if (!isDocLike(parsed)) return jsonError("بنية القالب غير صالحة — أعد فتحه في المصمم وحفظه.");
    content = parsed;
  } catch {
    return jsonError("جسم القالب ليس JSON صالحًا — أعد فتحه في المصمم وحفظه.");
  }

  const quotationId = Number(body.quotationId);
  if (template.kind === "quotation" && (!Number.isFinite(quotationId) || quotationId <= 0)) {
    return jsonError("حدد عرض السعر المراد توليد مستنده.");
  }

  try {
    const ctx = await buildRenderContext({
      templateContent: content,
      contractTypeId: template.contractTypeId,
      quotationId: Number.isFinite(quotationId) && quotationId > 0 ? quotationId : null,
    });
    const doc = renderDocTemplate(content, ctx);

    return ok({
      doc,
      meta: {
        contractTypeName: template.contractType?.name ?? null,
        quotationNumber: ctx.quotationNumber,
        quotationTotal:
          ctx.quotationTotal !== null ? `${fmtNumber(ctx.quotationTotal)} ${ctx.currency}` : null,
        boqNames: Array.from(ctx.boqDocs.values()).map((d) => d.name),
        companyName: ctx.tokens["company.name"] || "",
      },
    });
  } catch (e) {
    if (e instanceof DocTemplateError) return jsonError(e.message);
    return jsonError("تعذر توليد المستند من القالب.", 500);
  }
}
