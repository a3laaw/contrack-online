import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr, numOr } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

/** قالب دفعات النوع: {payNo, title, pct?, amountFixed?, triggerStageName?, daysOffset?, linkKeyword?} */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const type = await db.contractType.findUnique({ where: { id } });
  if (!type) return jsonError("نوع العقد غير موجود", 404);

  const rows = await db.typePaymentTemplate.findMany({
    where: { contractTypeId: id },
    orderBy: { payNo: "asc" },
  });
  // أسماء المراحل المحفزة للعرض
  const wfIds = rows.map((r) => r.triggerStageId).filter((v): v is number => v != null && v > 0);
  const wfRows = wfIds.length
    ? await db.workflowStage.findMany({ where: { id: { in: wfIds } }, select: { id: true, stageName: true } })
    : [];
  const wfMap = new Map(wfRows.map((w) => [w.id, w.stageName]));

  return ok({
    type: { id: type.id, name: type.name, defaultAmount: Number(type.defaultAmount), pricingMode: type.pricingMode },
    items: rows.map((r) => ({
      payNo: r.payNo,
      title: r.title,
      pct: Number(r.pct),
      amountFixed: Number(r.amountFixed),
      triggerStageName: r.triggerStageId ? wfMap.get(r.triggerStageId) || "" : "",
      daysOffset: r.daysOffset,
      linkKeyword: r.linkKeyword,
    })),
  });
}

/** استبدال القالب بالكامل (PUT) */
export async function PUT(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const type = await db.contractType.findUnique({ where: { id } });
  if (!type) return jsonError("نوع العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> | unknown[];
  const list: Record<string, unknown>[] = Array.isArray(body)
    ? (body as Record<string, unknown>[])
    : Array.isArray((body as Record<string, unknown>).items)
      ? ((body as Record<string, unknown>).items as Record<string, unknown>[])
      : Array.isArray((body as Record<string, unknown>).template)
        ? ((body as Record<string, unknown>).template as Record<string, unknown>[])
        : [];

  // تحقق قبل الكتابة
  const seen = new Set<number>();
  for (const r of list) {
    const payNo = intOr(r.payNo, 0);
    if (payNo < 1) return jsonError("رقم الدفعة (payNo) يجب أن يكون عددًا صحيحًا ≥ 1");
    if (seen.has(payNo)) return jsonError(`رقم الدفعة ${payNo} مكرر`);
    seen.add(payNo);
    const pct = numOr(r.pct, 0);
    if (pct < 0 || pct > 100) return jsonError("النسبة يجب أن تكون بين 0 و 100");
  }

  // حل أسماء المراحل المحفزة إلى معرفات خطوات التنفيذ (نفس النوع أو القالب العام)
  const names = list.map((r) => String(r.triggerStageName || "").trim()).filter(Boolean);
  const wfRows = names.length
    ? await db.workflowStage.findMany({
        where: { stageName: { in: names }, OR: [{ contractType: type.name }, { contractType: "" }] },
        select: { id: true, stageName: true },
        orderBy: { id: "asc" },
      })
    : [];
  const wfMap = new Map(wfRows.map((w) => [w.stageName, w.id]));

  await db.$transaction(async (tx) => {
    await tx.typePaymentTemplate.deleteMany({ where: { contractTypeId: id } });
    for (const r of list) {
      const triggerStageName = String(r.triggerStageName || "").trim();
      await tx.typePaymentTemplate.create({
        data: {
          contractTypeId: id,
          payNo: intOr(r.payNo, 0),
          title: String(r.title || `دفعة ${intOr(r.payNo, 1)}`),
          pct: numOr(r.pct, 0),
          amountFixed: numOr(r.amountFixed, 0),
          triggerStageId: triggerStageName ? wfMap.get(triggerStageName) ?? null : null,
          daysOffset: intOr(r.daysOffset, 0),
          linkKeyword: String(r.linkKeyword || ""),
        },
      });
    }
    await audit(tx, {
      username: guard.user.username,
      action: "استبدال قالب الدفعات",
      entityType: "contractType",
      entityId: id,
      entityName: type.name,
      reason: `${list.length} دفعة`,
    });
  });
  return ok({ message: "تم حفظ قالب الدفعات", count: list.length });
}
