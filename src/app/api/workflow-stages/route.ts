import { NextRequest } from "next/server";
import { db, currentCompanyId } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";

const TX_TYPES = ["contract", "payment", "subcontract", "customer"];

/** شجرة مراحل التنفيذ مرتبة transactionType / contractType / stageOrder */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const stages = await db.workflowStage.findMany({
    orderBy: [{ transactionType: "asc" }, { contractType: "asc" }, { stageOrder: "asc" }],
  });
  return ok({ stages });
}

/** إنشاء مرحلة تنفيذ */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const transactionType = String(body.transactionType || "contract");
  if (!TX_TYPES.includes(transactionType)) return jsonError("نوع المعاملة غير صحيح");
  const stageName = String(body.stageName || "").trim();
  if (!stageName) return jsonError("اسم المرحلة مطلوب");
  const contractType = String(body.contractType || "");

  const exists = await db.workflowStage.findUnique({
    where: { companyId_transactionType_contractType_stageName: { companyId: await currentCompanyId() as number, transactionType, contractType, stageName } },
  });
  if (exists) return jsonError("المرحلة موجودة مسبقًا لنفس نوع المعاملة");

  let parentId: number | null = null;
  if (body.parentId !== undefined && body.parentId !== null && body.parentId !== "") {
    const pid = Number(body.parentId);
    const parent = await db.workflowStage.findUnique({ where: { id: pid } });
    if (!parent) return jsonError("المرحلة الأب غير موجودة");
    parentId = pid;
  }

  const stage = await db.workflowStage.create({
    data: {
      transactionType,
      stageName,
      contractType,
      stageOrder: Number.isFinite(Number(body.stageOrder)) ? Math.trunc(Number(body.stageOrder)) : 0,
      color: String(body.color || "#3B82F6"),
      parentId,
      expectedDays: Number.isFinite(Number(body.expectedDays)) ? Math.trunc(Number(body.expectedDays)) : 0,
      isPreContract: Boolean(body.isPreContract),
      paymentPct: Number(body.paymentPct) || 0,
      payKind: String(body.payKind || ""),
      isSupervision: Boolean(body.isSupervision),
      supMonthly: Number(body.supMonthly) || 0,
      componentKey: String(body.componentKey || ""),
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "workflowStage",
    entityId: stage.id,
    entityName: `${transactionType}/${stageName}`,
  });
  return ok({ stage }, 201);
}

/** تعديل مرحلة تنفيذ — ?id= */
export async function PATCH(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const id = Number(req.nextUrl.searchParams.get("id") || 0);
  if (!id) return jsonError("معرف غير صالح");

  const stage = await db.workflowStage.findUnique({ where: { id } });
  if (!stage) return jsonError("المرحلة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  let transactionType = stage.transactionType;
  let contractType = stage.contractType;
  let stageName = stage.stageName;

  if (body.stageName !== undefined) {
    stageName = String(body.stageName).trim();
    if (!stageName) return jsonError("اسم المرحلة مطلوب");
    data.stageName = stageName;
  }
  if (body.transactionType !== undefined) {
    transactionType = String(body.transactionType);
    if (!TX_TYPES.includes(transactionType)) return jsonError("نوع المعاملة غير صحيح");
    data.transactionType = transactionType;
  }
  if (body.contractType !== undefined) {
    contractType = String(body.contractType || "");
    data.contractType = contractType;
  }
  if (stageName !== stage.stageName || transactionType !== stage.transactionType || contractType !== stage.contractType) {
    const exists = await db.workflowStage.findUnique({
      where: { companyId_transactionType_contractType_stageName: { companyId: await currentCompanyId() as number, transactionType, contractType, stageName } },
    });
    if (exists && exists.id !== id) return jsonError("المرحلة موجودة مسبقًا لنفس نوع المعاملة");
  }
  if (body.stageOrder !== undefined) data.stageOrder = Math.trunc(Number(body.stageOrder) || 0);
  if (body.color !== undefined) data.color = String(body.color || "#3B82F6");
  if (body.expectedDays !== undefined) data.expectedDays = Math.trunc(Number(body.expectedDays) || 0);
  if (body.isPreContract !== undefined) data.isPreContract = Boolean(body.isPreContract);
  if (body.paymentPct !== undefined) data.paymentPct = Number(body.paymentPct) || 0;
  if (body.payKind !== undefined) data.payKind = String(body.payKind || "");
  if (body.isSupervision !== undefined) data.isSupervision = Boolean(body.isSupervision);
  if (body.supMonthly !== undefined) data.supMonthly = Number(body.supMonthly) || 0;
  if (body.componentKey !== undefined) data.componentKey = String(body.componentKey || "");
  if (body.parentId !== undefined) {
    if (body.parentId === null || body.parentId === "") {
      data.parentId = null;
    } else {
      const pid = Number(body.parentId);
      if (pid === id) return jsonError("لا يمكن أن تكون المرحلة أبًا لنفسها");
      const parent = await db.workflowStage.findUnique({ where: { id: pid } });
      if (!parent) return jsonError("المرحلة الأب غير موجودة");
      data.parentId = pid;
    }
  }

  await db.workflowStage.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "workflowStage",
    entityId: id,
    entityName: `${transactionType}/${stageName}`,
  });
  return ok({ message: "تم تعديل المرحلة" });
}

/** حذف مرحلة تنفيذ — ?id= — ممنوع إن لها أبناء أو مرتبطة بقالب/نطاق */
export async function DELETE(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const id = Number(req.nextUrl.searchParams.get("id") || 0);
  if (!id) return jsonError("معرف غير صالح");

  const stage = await db.workflowStage.findUnique({ where: { id } });
  if (!stage) return jsonError("المرحلة غير موجودة", 404);

  const children = await db.workflowStage.count({ where: { parentId: id } });
  if (children > 0) return jsonError("لا يمكن حذف مرحلة لها مراحل فرعية");

  const usedInTpl = await db.typePaymentStage.count({ where: { stageId: id } });
  if (usedInTpl > 0) return jsonError("لا يمكن حذف مرحلة مرتبطة بقالب دفعات");

  const usedInScope = await db.contractScope.count({ where: { templateStageId: id } });
  if (usedInScope > 0) return jsonError("لا يمكن حذف مرحلة مرتبطة بنطاق عقود");

  await db.workflowStage.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "workflowStage",
    entityId: id,
    entityName: `${stage.transactionType}/${stage.stageName}`,
  });
  return ok({ message: "تم حذف المرحلة" });
}
