import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { isOpportunityStage, OPPORTUNITY_SOURCES } from "@/lib/opportunities-constants";
import {
  assertStageTransition,
  cleanOpportunityDate,
  cleanOpportunityText,
} from "@/lib/opportunities-core";

type P = { params: Promise<{ id: string }> };

/**
 * ر3 — تفصيل/تعديل/حذف الفرصة (docs/opportunities-design.md §5):
 * • المرحلة بحرس الانتقالات المغلقة (د2) و«مفقودة» بسبب إلزامي (د3)
 * • المقفلة لا تُعدَّل مرحلتها — أما الملاحظات وسبب الخسارة فتبقى قابلة للتصحيح
 * • حذف الفرصة المرتبطة بعرض مرفوض برسالة عدد العروض (نمط حماية الاستشارات)
 */

async function loadRow(id: number) {
  return db.opportunity.findUnique({
    where: { id },
    select: {
      id: true, opportunityNumber: true, name: true, stage: true,
      expectedAmount: true, expectedCloseDate: true, source: true,
      lostReason: true, notes: true, customerId: true, quotationId: true, createdAt: true,
      customer: { select: { id: true, name: true, customerCode: true } },
      quotation: { select: { id: true, quotationNumber: true, status: true } },
    },
  });
}

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_opportunities");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "crm", "فرص البيع");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");
  const row = await loadRow(id);
  if (!row) return jsonError("الفرصة غير موجودة", 404);
  return ok({ opportunity: row });
}

export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_opportunities");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "crm", "فرص البيع");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const existing = await db.opportunity.findUnique({
    where: { id },
    select: { id: true, opportunityNumber: true, name: true, stage: true, lostReason: true },
  });
  if (!existing) return jsonError("الفرصة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = cleanOpportunityText(body.name);
    if (!name) return jsonError("اسم الفرصة إلزامي.", 400);
    data.name = name;
  }

  if (body.customerId !== undefined) {
    const customerId = Number(body.customerId ?? 0) || 0;
    if (customerId > 0) {
      const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!customer) return jsonError("العميل غير موجود.", 400);
      data.customerId = customerId;
    } else {
      data.customerId = null; // فصل الربط مسموح — د5
    }
  }

  if (body.source !== undefined) {
    const source = cleanOpportunityText(body.source);
    if (source && !(OPPORTUNITY_SOURCES as readonly string[]).includes(source)) {
      return jsonError("مصدر الفرصة غير معتمد.", 400);
    }
    data.source = source;
  }

  if (body.expectedAmount !== undefined) {
    data.expectedAmount = Math.max(0, Number(body.expectedAmount ?? 0) || 0);
  }
  if (body.expectedCloseDate !== undefined) {
    data.expectedCloseDate = cleanOpportunityDate(body.expectedCloseDate);
  }
  if (body.notes !== undefined) {
    data.notes = cleanOpportunityText(body.notes);
  }

  // سبب الخسارة: يقبل تعديله دائمًا (تصحيح المقفلة) — ويحرس إلزاميته عند الانتقال
  const newStageInput = typeof body.stage === "string" && body.stage ? body.stage : undefined;
  const lostReasonInput = body.lostReason !== undefined ? cleanOpportunityText(body.lostReason) : undefined;

  if (newStageInput !== undefined) {
    if (!isOpportunityStage(newStageInput)) return jsonError("مرحلة الفرصة غير صحيحة.", 400);
    const effectiveLostReason = lostReasonInput ?? existing.lostReason;
    const stageGuard = assertStageTransition(existing.stage, newStageInput, effectiveLostReason);
    if (!stageGuard.ok) return jsonError(stageGuard.error, 400);
    if (newStageInput !== existing.stage) {
      data.stage = newStageInput;
      if (newStageInput === "مفقودة") data.lostReason = effectiveLostReason;
      if (newStageInput !== "مفقودة") data.lostReason = ""; // العودة لمفتوحة يمسح السبب
    }
  } else if (lostReasonInput !== undefined) {
    data.lostReason = existing.stage === "مفقودة" ? (lostReasonInput || existing.lostReason) : lostReasonInput;
  }

  const row = await db.$transaction(async (tx) => {
    const updated = await tx.opportunity.update({
      where: { id },
      data,
      select: {
        id: true, opportunityNumber: true, name: true, stage: true,
        expectedAmount: true, expectedCloseDate: true, source: true,
        lostReason: true, notes: true, customerId: true, quotationId: true,
        customer: { select: { id: true, name: true, customerCode: true } },
        quotation: { select: { id: true, quotationNumber: true, status: true } },
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل فرصة بيع",
      entityType: "opportunity",
      entityId: updated.id,
      entityName: `${updated.opportunityNumber} — ${updated.name}`,
      oldStatus: existing.stage,
      newStatus: updated.stage,
    });
    return updated;
  });
  return ok({ opportunity: row });
}

export async function DELETE(req: NextRequest, { params }: P) {
  // الحذف مديرًا فقط (نمط حذف العروض) — وباب الشاشة نفسه قبل دور المدير
  const guard = await authGuard(req, "screen_opportunities");
  if ("response" in guard) return guard.response;
  const admin = await adminGuard(req);
  if ("response" in admin) return admin.response;
  const mg = await moduleGuard(guard.user.companyId, "crm", "فرص البيع");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const existing = await db.opportunity.findUnique({
    where: { id },
    select: { id: true, opportunityNumber: true, name: true, quotationId: true },
  });
  if (!existing) return jsonError("الفرصة غير موجودة", 404);
  // حماية الحذف: الفرصة المرتبطة بعرض لا تُحذف (أثر تجاري موثق — نمط الاستشارات)
  if (existing.quotationId) {
    return jsonError("لا يمكن حذف الفرصة المرتبطة بعرض سعر (عدد العروض: 1) — حذف العرض يفصل الربط أولًا.", 400);
  }

  await db.$transaction(async (tx) => {
    await tx.opportunity.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف فرصة بيع",
      entityType: "opportunity",
      entityId: existing.id,
      entityName: `${existing.opportunityNumber} — ${existing.name}`,
    });
  });
  return ok({ deleted: true });
}
