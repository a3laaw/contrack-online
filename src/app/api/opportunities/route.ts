import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { nextNumberByKey } from "@/lib/contrack-server";
import { isOpportunityStage, OPPORTUNITY_SOURCES } from "@/lib/opportunities-constants";
import {
  cleanOpportunityDate,
  cleanOpportunityText,
  assertStageTransition,
} from "@/lib/opportunities-core";

/**
 * ر3 — فرص البيع (docs/opportunities-design.md — اعتماد المالك «كليهما معًا»):
 * البوابة screen_opportunities (د1) + حرس موديول crm — والترقيم OPP ذريًا بمزامنة
 * العدّاد فوق الأرقام القائمة أول استخدام (نمط QUO/CPR حرفيًا — د6).
 */

/** قائمة الفرص — فلاتر مرحلة/عميل/نص/فترة الإغلاق المتوقعة (الأحدث أولًا) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_opportunities");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "crm", "فرص البيع");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const stage = sp.get("stage") || "";
  const customerId = Number(sp.get("customerId") || 0);
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const q = (sp.get("q") || "").trim();

  const where: Record<string, unknown> = {};
  if (stage && stage !== "الكل") {
    if (!isOpportunityStage(stage)) return jsonError("مرحلة الفرصة غير صحيحة.", 400);
    where.stage = stage;
  }
  if (Number.isFinite(customerId) && customerId > 0) where.customerId = customerId;
  if (from || to) {
    const range: Record<string, string> = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) range.gte = from;
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) range.lte = to;
    if (Object.keys(range).length > 0) where.expectedCloseDate = range;
  }
  if (q) {
    where.OR = [{ name: { contains: q } }, { notes: { contains: q } }, { customer: { name: { contains: q } } }];
  }

  const opportunities = await db.opportunity.findMany({
    where,
    select: {
      id: true, opportunityNumber: true, name: true, stage: true,
      expectedAmount: true, expectedCloseDate: true, source: true,
      lostReason: true, notes: true, customerId: true, quotationId: true,
      createdAt: true,
      customer: { select: { id: true, name: true, customerCode: true } },
      quotation: { select: { id: true, quotationNumber: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({ opportunities });
}

/** إنشاء فرصة — OPP ذريًا داخل معاملة واحدة مع التدقيق (د6) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_opportunities");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "crm", "فرص البيع");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = cleanOpportunityText(body.name);
  if (!name) return jsonError("اسم الفرصة إلزامي.", 400);

  const stage = typeof body.stage === "string" && body.stage && isOpportunityStage(body.stage) ? body.stage : "جديدة";
  const lostReason = cleanOpportunityText(body.lostReason);
  const stageGuard = assertStageTransition(stage, stage, lostReason);
  if (!stageGuard.ok) return jsonError(stageGuard.error, 400); // «مفقودة» بلا سبب ترفض حتى عند الإنشاء

  const customerId = Number(body.customerId ?? 0) || 0;
  if (customerId > 0) {
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) return jsonError("العميل غير موجود.", 400);
  }

  const source = cleanOpportunityText(body.source);
  if (source && !(OPPORTUNITY_SOURCES as readonly string[]).includes(source)) {
    return jsonError("مصدر الفرصة غير معتمد.", 400);
  }

  const expectedAmountRaw = Number(body.expectedAmount ?? 0) || 0;
  const expectedAmount = Math.max(0, expectedAmountRaw);
  const expectedCloseDate = cleanOpportunityDate(body.expectedCloseDate);
  const notes = cleanOpportunityText(body.notes);

  const data = {
    name,
    stage,
    lostReason: stage === "مفقودة" ? lostReason : "",
    ...(customerId > 0 ? { customerId } : {}),
    expectedAmount,
    expectedCloseDate,
    source,
    notes,
    createdBy: guard.user.id,
  };

  let created: { id: number; opportunityNumber: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        // مزامنة العدّاد فوق الأرقام القائمة أول استخدام (نمط QUO حرفيًا)
        const last = await tx.opportunity.findFirst({
          orderBy: { opportunityNumber: "desc" },
          select: { opportunityNumber: true },
        });
        const m = last?.opportunityNumber?.match(/OPP-(\d+)/);
        const maxNo = m ? parseInt(m[1], 10) : 0;
        if (Number.isFinite(maxNo) && maxNo > 0) {
          const seqRow = await tx.numberSequence.findFirst({ where: { name: "opportunity:number" } });
          if (!seqRow) {
            await tx.numberSequence.create({ data: { name: "opportunity:number", lastNo: maxNo } });
          } else if (Number(seqRow.lastNo) < maxNo) {
            await tx.numberSequence.update({
              where: { companyId_name: { companyId: seqRow.companyId, name: "opportunity:number" } },
              data: { lastNo: maxNo },
            });
          }
        }
        const opportunityNumber = await nextNumberByKey("opportunity:number", "OPP", 4, tx);
        const row = await tx.opportunity.create({
          data: { ...data, opportunityNumber },
          select: { id: true, opportunityNumber: true },
        });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء فرصة بيع",
          entityType: "opportunity",
          entityId: row.id,
          entityName: `${row.opportunityNumber} — ${name}`,
          newStatus: stage,
        });
        return row;
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 7) {
        lastError = e; // تضارب رقم الفرصة — أعِد التوليد (نمط العروض حتى 8 محاولات)
        continue;
      }
      lastError = e;
      break;
    }
  }
  if (!created) {
    console.error("فشل إنشاء فرصة بيع:", lastError);
    return jsonError("تعذر إنشاء رقم فرصة غير مكرر.", 500);
  }
  return ok({ opportunity: created }, 201);
}
