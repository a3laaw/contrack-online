import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, normalizeArabic, ok, parseDay, todayStr } from "@/lib/api-utils";
import { COMMENT_KINDS, COMMENT_PRIORITIES } from "@/lib/comments-server";

/**
 * قائمة التعليقات (شاشة العميل ومركز التعليقات معًا — نفس GET):
 * فلاتر customerId/contractId/q(على النص)/status/kind/priority/tag/openOnly/dueOnly/pinnedFirst
 * — باستبعاد المحذوف ناعمًا دائمًا، ومع أسماء العميل/العقد لمركز التعليقات.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const customerId = Number(sp.get("customerId")) || 0;
  const contractId = Number(sp.get("contractId")) || 0;
  const q = (sp.get("q") || "").trim();
  const status = (sp.get("status") || "").trim();
  const kind = (sp.get("kind") || "").trim();
  const priority = (sp.get("priority") || "").trim();
  const tag = (sp.get("tag") || "").trim();
  const openOnly = ["1", "true", "yes"].includes((sp.get("openOnly") || "").toLowerCase());
  const dueOnly = ["1", "true", "yes"].includes((sp.get("dueOnly") || "").toLowerCase());
  const pinnedFirstRaw = (sp.get("pinnedFirst") || "1").toLowerCase();
  const pinnedFirst = !["0", "false", "no"].includes(pinnedFirstRaw);

  const where: Prisma.CommentWhereInput = { isDeleted: false };
  if (customerId) where.customerId = customerId;
  // contractId: 0 = «غير محدد» (بلا عقد — كالمصدر) · >0 = عقد بعينه · غير ممرر = كل العقود
  if (sp.has("contractId")) where.contractId = contractId ? contractId : null;
  if (status) where.status = status;
  if (kind) where.kind = kind;
  if (priority) where.priority = priority;
  if (openOnly) where.status = { in: ["مفتوح", "مؤجل"] };

  // dueOnly: مستحق اليوم — followupDate ≤ اليوم وحالته غير مغلقة (كالمصدر due_only)
  const today = todayStr();
  if (dueOnly) {
    where.followupDate = { not: "", lte: today };
    where.status = { in: ["مفتوح", "مؤجل"] };
  }

  const comments = await db.comment.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, customerCode: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true } },
    },
    orderBy: pinnedFirst ? [{ pinned: "desc" }, { createdAt: "desc" }] : { createdAt: "desc" },
  });

  const nq = normalizeArabic(q);
  const rows = comments
    .filter((c) => {
      if (nq && !normalizeArabic(c.body).includes(nq)) return false;
      if (tag && !c.tags.split(",").map((t) => t.trim()).includes(tag)) return false;
      return true;
    })
    .map((c) => ({
      id: c.id,
      customerId: c.customerId,
      customerName: c.customer?.name || "",
      customerCode: c.customer?.customerCode || "",
      contractId: c.contractId,
      contractNumber: c.contract?.contractNumber || "",
      contractName: c.contract?.contractName || "",
      body: c.body,
      createdBy: c.createdBy,
      author: c.author,
      pinned: c.pinned,
      editedAt: c.editedAt,
      editor: c.editor,
      kind: c.kind,
      priority: c.priority,
      status: c.status,
      tags: c.tags,
      followupDate: c.followupDate,
      source: c.source,
      createdAt: c.createdAt,
    }));

  // ملخص خفيف كالمصدر (comment_center_service.py:167–184)
  const summary = {
    total: rows.length,
    open: rows.filter((r) => r.status === "مفتوح").length,
    urgent: rows.filter((r) => r.priority === "عاجل").length,
    due: rows.filter((r) => r.followupDate && r.followupDate <= today && (r.status === "مفتوح" || r.status === "مؤجل")).length,
  };

  // إجمالي تعليقات العميل قبل الفلترة/الحد (مقابل comments_count في ملف العميل المكتبي)
  let customerTotal: number | null = null;
  if (customerId) {
    customerTotal = await db.comment.count({ where: { customerId, isDeleted: false } });
  }

  return ok({ comments: rows, count: rows.length, summary, customerTotal });
}

/** إضافة تعليق — customerId إلزامي وbody بين 1 و2000 حرف، createdBy=اسم الدخول وauthor=اسم العرض */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const customerId = Number(body.customerId) || 0;
  if (!customerId) return jsonError("العميل مطلوب للتعليق");
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return jsonError("العميل غير موجود", 404);

  const text = String(body.body || "").trim();
  if (!text) return jsonError("نص التعليق مطلوب");
  if (text.length > 2000) return jsonError("نص التعليق يتجاوز 2000 حرف");

  const contractId = Number(body.contractId) || 0;
  if (contractId) {
    const contract = await db.contract.findUnique({ where: { id: contractId } });
    if (!contract) return jsonError("العقد غير موجود", 404);
    if (contract.customerId !== customerId) return jsonError("العقد المحدد لا يخص هذا العميل");
  }

  const kind = body.kind === undefined || body.kind === "" ? "عام" : String(body.kind);
  if (!COMMENT_KINDS.includes(kind as (typeof COMMENT_KINDS)[number])) return jsonError("نوع التعليق غير معروف");
  const priority = body.priority === undefined || body.priority === "" ? "عادي" : String(body.priority);
  if (!COMMENT_PRIORITIES.includes(priority as (typeof COMMENT_PRIORITIES)[number])) return jsonError("أولوية التعليق غير معروفة");

  const followupDate = body.followupDate === undefined || body.followupDate === null || body.followupDate === "" ? "" : parseDay(body.followupDate);
  if (body.followupDate && !followupDate) return jsonError("تاريخ المتابعة غير صالح — الصيغة YYYY-MM-DD");

  const tags = String(body.tags || "").trim();

  const created = await db.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        customerId,
        contractId: contractId || null,
        body: text,
        createdBy: guard.user.username,
        author: guard.user.fullName || guard.user.username,
        kind,
        priority,
        status: "مفتوح",
        tags,
        followupDate,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إضافة تعليق",
      entityType: "comment",
      entityId: comment.id,
      entityName: customer.name,
    });
    return comment;
  });

  return ok({ comment: { id: created.id, author: created.author, status: created.status } }, 201);
}
