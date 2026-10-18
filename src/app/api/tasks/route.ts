import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, normalizeArabic, ok, parseDay } from "@/lib/api-utils";

/** صيغة الموعد الحرفية من المصدر: YYYY-MM-DD HH:mm */
const DUE_AT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const TASK_TYPES = ["تذكير", "موعد"] as const;

function validDueAt(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!DUE_AT_RE.test(s)) return "";
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? "" : s;
}

/** قائمة المهام — فلاتر: status (مفتوحة|منجزة)، customerId، contractId، q، from/to على dueAt */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_tasks");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const status = (sp.get("status") || "").trim();
  const customerId = Number(sp.get("customerId")) || 0;
  const contractId = Number(sp.get("contractId")) || 0;
  const q = (sp.get("q") || "").trim();
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));

  const where: Prisma.TaskWhereInput = {};
  if (status === "مفتوحة" || status === "منجزة") where.status = status;
  if (customerId) where.customerId = customerId;
  if (contractId) where.contractId = contractId;
  if (from || to) {
    const dueAt: Prisma.StringFilter = {} as Prisma.StringFilter;
    if (from) dueAt.gte = `${from} 00:00`;
    if (to) dueAt.lte = `${to} 23:59`;
    where.dueAt = dueAt;
  }

  const tasks = await db.task.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, customerCode: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true } },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
  });

  const nq = normalizeArabic(q);
  const rows = tasks
    .filter((t) => {
      if (nq && !normalizeArabic(`${t.title} ${t.details}`).includes(nq)) return false;
      return true;
    })
    .map((t) => ({
      id: t.id,
      title: t.title,
      details: t.details,
      dueAt: t.dueAt,
      remindMinutes: t.remindMinutes,
      taskType: t.taskType,
      status: t.status,
      source: t.source,
      doneAt: t.doneAt,
      notifiedBefore: t.notifiedBefore,
      notifiedAfter: t.notifiedAfter,
      customerId: t.customerId,
      customerName: t.customer?.name || "",
      customerCode: t.customer?.customerCode || "",
      contractId: t.contractId,
      contractNumber: t.contract?.contractNumber || "",
      contractName: t.contract?.contractName || "",
      createdAt: t.createdAt,
    }));

  return ok({ tasks: rows, count: rows.length });
}

/** إضافة مهمة — العنوان والموعد إلزاميان، والعقد إن حُدد يجب أن يخص العميل المحدد */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_tasks");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title || "").trim();
  if (!title) return jsonError("عنوان المهمة مطلوب");

  const dueAt = validDueAt(body.dueAt);
  if (!dueAt) return jsonError("موعد المهمة مطلوب بالصيغة YYYY-MM-DD HH:mm");

  const taskType = body.taskType === undefined || body.taskType === "" ? "تذكير" : String(body.taskType);
  if (!TASK_TYPES.includes(taskType as (typeof TASK_TYPES)[number])) {
    return jsonError("نوع المهمة يجب أن يكون «تذكير» أو «موعد»");
  }

  const remindMinutesRaw = Number(body.remindMinutes);
  const remindMinutes = Number.isFinite(remindMinutesRaw) && remindMinutesRaw >= 0 ? Math.floor(remindMinutesRaw) : 30;

  const customerId = Number(body.customerId) || 0;
  const contractId = Number(body.contractId) || 0;

  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) return jsonError("العميل غير موجود", 404);
  }
  if (contractId) {
    const contract = await db.contract.findUnique({ where: { id: contractId } });
    if (!contract) return jsonError("العقد غير موجود", 404);
    // تحقق التطابق كالمصدر (_validate_links): العقد يجب أن يخص العميل المحدد
    if (customerId && contract.customerId !== customerId) {
      return jsonError("العقد المحدد لا يخص هذا العميل");
    }
  }

  const created = await db.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title,
        details: String(body.details || ""),
        dueAt,
        remindMinutes,
        taskType,
        source: "يدوية",
        status: "مفتوحة",
        customerId: customerId || null,
        contractId: contractId || null,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إنشاء",
      entityType: "task",
      entityId: task.id,
      entityName: title,
    });
    return task;
  });

  return ok({ task: { id: created.id, title: created.title, dueAt: created.dueAt, status: created.status } }, 201);
}
