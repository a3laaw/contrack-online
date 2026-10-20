import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { getQuotationRow } from "@/lib/quotes-server";
import {
  cleanQuotationCustomerId,
  cleanQuotationDate,
  cleanQuotationItems,
  cleanQuotationProjectId,
  cleanQuotationText,
  computeItemsTotal,
  QUOTATION_CUSTOMER_REQUIRED,
  QUOTATION_ITEMS_REQUIRED,
} from "@/lib/quotes-core";

type P = { params: Promise<{ id: string }> };

async function quoteId(params: P["params"]): Promise<number | null> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** تفاصيل عرض ببنوده الكاملة (مرآة get_quotation) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const id = await quoteId(params);
  if (!id) return jsonError("معرف غير صالح");

  const quotation = await getQuotationRow(id);
  if (!quotation) return jsonError("عرض السعر غير موجود", 404);
  return ok({ quotation });
}

/**
 * تعديل عرض + استبدال بنوده — إضافة ويب توثيقية: المكتبي بلا دالة تعديل
 * لإدارة الحوار المبني (كما بلا واجهة أصلًا). الحالة لا تُعدَّل هنا —
 * لها مسار الانتقال المخصص وحده (مرآة انفصال set_quotation_status).
 */
export async function PUT(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const id = await quoteId(params);
  if (!id) return jsonError("معرف غير صالح");

  const existing = await db.quotation.findUnique({ where: { id } });
  if (!existing) return jsonError("عرض السعر غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const customerId = cleanQuotationCustomerId(body.customerId);
  if (!customerId) return jsonError(QUOTATION_CUSTOMER_REQUIRED, 400);
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) return jsonError("العميل غير موجود.", 400);

  const projectId = cleanQuotationProjectId(body.projectId);
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return jsonError("المشروع غير موجود.", 400);
  }

  const items = cleanQuotationItems(body.items);
  if (items.length === 0) return jsonError(QUOTATION_ITEMS_REQUIRED, 400);

  const quotation = await db.$transaction(async (tx) => {
    const row = await tx.quotation.update({
      where: { id },
      data: {
        customerId,
        projectId,
        description: cleanQuotationText(body.description),
        totalAmount: computeItemsTotal(items),
        validUntil: cleanQuotationDate(body.validUntil),
        notes: cleanQuotationText(body.notes),
        items: {
          deleteMany: {},
          create: items.map((it) => ({
            description: it.description,
            unit: it.unit,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            totalPrice: it.totalPrice,
            sortOrder: it.sortOrder,
          })),
        },
      },
      select: { id: true, quotationNumber: true },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل عرض سعر",
      entityType: "quotation",
      entityId: row.id,
      entityName: row.quotationNumber,
      oldStatus: existing.status,
      newStatus: existing.status,
    });
    return row;
  });

  return ok({ quotation });
}

/**
 * حذف عرض — إضافة ويب أمانًا للمدير (المكتبي بلا دالة حذف ولا واجهة؛
 * كحذف المجموعات والمشاريع في البنود الشقيقة). حارس الارتباط المدمج:
 * customer_id RESTRICT يمنع حذف عميل له عروض، والبنود تُحذف كاسكيد.
 */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const id = await quoteId(params);
  if (!id) return jsonError("معرف غير صالح");

  const quotation = await db.quotation.findUnique({
    where: { id },
    select: { id: true, quotationNumber: true },
  });
  if (!quotation) return jsonError("عرض السعر غير موجود", 404);

  await db.$transaction(async (tx) => {
    await tx.quotation.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف عرض سعر",
      entityType: "quotation",
      entityId: quotation.id,
      entityName: quotation.quotationNumber,
    });
  });

  return ok({ ok: true, id });
}
