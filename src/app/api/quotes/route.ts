import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { listQuotations } from "@/lib/quotes-server";
import { nextNumberByKey } from "@/lib/contrack-server";
import {
  cleanQuotationCustomerId,
  cleanQuotationDate,
  cleanQuotationItems,
  cleanQuotationProjectId,
  cleanQuotationText,
  computeItemsTotal,
  isQuotationStatus,
  QUOTATION_CUSTOMER_REQUIRED,
  QUOTATION_ITEMS_REQUIRED,
} from "@/lib/quotes-core";
// ر3 — فرص البيع: الربط ورفع المرحلة داخل معاملة الإصدار نفسها (د4 — docs/opportunities-design.md)
import { autoStageForQuotationEvent } from "@/lib/opportunities-core";

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

/** إنشاء عرض — مرآة add_quotation: عميل إلزامي + بند واحد على الأقل + QUO-%04d ذريًا (ر1/3) */
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

  // ر3 — الفرصة المُصدَر منها العرض (اختياري): تتحقق خارج المعاملة وتُربط داخلها (د4)
  const opportunityId = Number(body.opportunityId ?? 0) || 0;
  if (opportunityId > 0) {
    const opp = await db.opportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true, opportunityNumber: true, stage: true },
    });
    if (!opp) return jsonError("الفرصة المرتبطة غير موجودة.", 400);
    if (opp.stage === "مقبولة" || opp.stage === "مفقودة") {
      return jsonError("الفرصة مقفلة — لا يُصدر منها عرض جديد.", 400);
    }
  }

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
        // ر1/3 — الترقيم الذري: عدّاد number_sequences بدل قراءة الأعلى
        // + مزامنة العدّاد فوق الأرقام القائمة أول استخدام (نمط voucher:INV —
        // العروض القديمة أرقامها أعلى من العدّاد الصفري المضروب في seed)
        const last = await tx.quotation.findFirst({
          orderBy: { quotationNumber: "desc" },
          select: { quotationNumber: true },
        });
        const m = last?.quotationNumber?.match(/QUO-(\d+)/);
        const maxNo = m ? parseInt(m[1], 10) : 0;
        if (Number.isFinite(maxNo) && maxNo > 0) {
          const seqRow = await tx.numberSequence.findFirst({ where: { name: "quotation:number" } });
          if (!seqRow) {
            await tx.numberSequence.create({ data: { name: "quotation:number", lastNo: maxNo } });
          } else if (Number(seqRow.lastNo) < maxNo) {
            await tx.numberSequence.update({
              where: { companyId_name: { companyId: seqRow.companyId, name: "quotation:number" } },
              data: { lastNo: maxNo },
            });
          }
        }
        const quotationNumber = await nextNumberByKey("quotation:number", "QUO", 4, tx);
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
        // ر3 — ربط العرض بالفرصة ورفع مرحلتها إلى «عُرض عليها» داخل المعاملة نفسها (د4):
        // quotationId = أول عرض صدر منها (لا يُستبدل)، والمرحلة تلقائية إذا لم تكن مقفلة
        if (opportunityId > 0) {
          const opp = await tx.opportunity.findUnique({
            where: { id: opportunityId },
            select: { id: true, opportunityNumber: true, stage: true, quotationId: true },
          });
          if (opp) {
            const next = autoStageForQuotationEvent(opp.stage, "issued");
            await tx.opportunity.update({
              where: { id: opp.id },
              data: {
                ...(next ? { stage: next } : {}),
                ...(opp.quotationId ? {} : { quotationId: quotation.id }),
              },
            });
            await audit(tx, {
              username: guard.user.username,
              action: next ? `تحديث مرحلة الفرصة إلى «${next}» — إصدار عرض` : "ربط عرض إضافي بالفرصة",
              entityType: "opportunity",
              entityId: opp.id,
              entityName: opp.opportunityNumber,
              newStatus: next ?? undefined,
            });
          }
        }
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
