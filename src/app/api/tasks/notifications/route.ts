import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, ok } from "@/lib/api-utils";

/**
 * محرك تذكير المهام — GET /api/tasks/notifications
 * يعيد المهام المفتوحة التي حان/اقترب موعدها دون تعليمها:
 * - before: 0 ≤ الدقائق حتى الموعد ≤ remindMinutes وغير مبلَّغة (قبل الموعد مرة واحدة — كالمصدر).
 * - after:  الموعد فات (دقائق سالبة) وغير مبلَّغة (بعد الموعد مرة واحدة).
 * التعليم يتم عبر PATCH /api/tasks/{id} {action:'notified', stage:'before'|'after'}.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_tasks");
  if ("response" in guard) return guard.response;

  const now = new Date();
  const nowMs = now.getTime();

  const openTasks = await db.task.findMany({
    where: { status: "مفتوحة" },
    include: {
      customer: { select: { id: true, name: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true } },
    },
    orderBy: { dueAt: "asc" },
  });

  const before: Record<string, unknown>[] = [];
  const after: Record<string, unknown>[] = [];

  for (const t of openTasks) {
    const due = new Date(t.dueAt.replace(" ", "T"));
    if (isNaN(due.getTime())) continue;
    const diffMin = Math.round((due.getTime() - nowMs) / 60000);

    if (!t.notifiedBefore && diffMin >= 0 && diffMin <= t.remindMinutes) {
      before.push(mapTask(t, diffMin));
    } else if (!t.notifiedAfter && diffMin < 0) {
      after.push(mapTask(t, diffMin));
    }
  }

  return ok({
    generatedAt: now.toISOString(),
    before,
    after,
  });
}

function mapTask(
  t: {
    id: number;
    title: string;
    dueAt: string;
    remindMinutes: number;
    taskType: string;
    details: string;
    customerId: number | null;
    customer: { id: number; name: string } | null;
    contractId: number | null;
    contract: { id: number; contractNumber: string; contractName: string } | null;
  },
  diffMin: number
) {
  return {
    id: t.id,
    title: t.title,
    details: t.details,
    dueAt: t.dueAt,
    taskType: t.taskType,
    remindMinutes: t.remindMinutes,
    minutesDiff: diffMin,
    customerId: t.customerId,
    customerName: t.customer?.name || "",
    contractId: t.contractId,
    contractNumber: t.contract?.contractNumber || "",
  };
}
