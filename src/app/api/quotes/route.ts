import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { listQuotations } from "@/lib/quotes-server";
import {
  cleanQuotationCustomerId,
  cleanQuotationDate,
  cleanQuotationItems,
  cleanQuotationProjectId,
  cleanQuotationText,
  computeItemsTotal,
  isQuotationStatus,
  nextQuotationNumber,
  QUOTATION_CUSTOMER_REQUIRED,
  QUOTATION_ITEMS_REQUIRED,
} from "@/lib/quotes-core";

/**
 * عروض الأسعار — بند 12 من المرحلة 9.
 * البوابة شاشة الحاضن screen_customers (المكتبي: لا مدخل لعروض الأسعار في
 * PAGE_PERMS ولا واجهة إدارة — الدوال بلا مستدعٍ واجهة، وموضع الواجهة الوحيد
 * مركز نماذج Word). لا بند شل ولا مفتاح مزايا (لا مفتاح للعروض في المكتبي
 * ولا في كتالوج الويب).
 */

/** قائمة العروض — فلاتر customerId/status/q (مرآة list_quotations: بحث مطبَّع + الأحدث أولًا) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const customerId = Number(sp.get("customerId") || 0);
  const status = sp.get("status") || "";
  const quotations = await listQuotations({
    customerId: Number.isFinite(customerId) && customerId > 0 ? customerId : undefined,
    status: status && status !== "الكل" ? status : undefined,
    q: sp.get("q") || "",
  });
  return ok({ quotations });
}

/** إنشاء عرض — مرآة add_quotation: عميل إلزامي + بند واحد على الأقل + QUO-%04d مع إعادة محاولة 8× عند تضارب UNIQUE */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;

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

  const status = typeof body.status === "string" && body.status && isQuotationStatus(body.status)
    ? body.status
    : undefined;

  const data = {
    customerId,
    projectId,
    description: cleanQuotationText(body.description),
    totalAmount: computeItemsTotal(items),
    validUntil: cleanQuotationDate(body.validUntil),
    notes: cleanQuotationText(body.notes),
    createdBy: guard.user.id,
    ...(status ? { status } : {}),
    items: {
      create: items.map((it) => ({
        description: it.description,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        sortOrder: it.sortOrder,
      })),
    },
  };

  let created: { id: number; quotationNumber: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        const last = await tx.quotation.findFirst({ orderBy: { quotationNumber: "desc" } });
        const quotationNumber = nextQuotationNumber(last?.quotationNumber);
        const quotation = await tx.quotation.create({
          data: { ...data, quotationNumber },
          select: { id: true, quotationNumber: true },
        });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء عرض سعر",
          entityType: "quotation",
          entityId: quotation.id,
          entityName: `${quotation.quotationNumber}`,
        });
        return quotation;
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 7) {
        lastError = e; // تضارب رقم العرض — أعِد التوليد (كالمكتبي حتى 8 محاولات)
        continue;
      }
      lastError = e;
      break;
    }
  }
  if (!created) {
    console.error("فشل إنشاء عرض سعر:", lastError);
    return jsonError("تعذر إنشاء رقم عرض سعر غير مكرر.", 500);
  }
  return ok({ quotation: created }, 201);
}
