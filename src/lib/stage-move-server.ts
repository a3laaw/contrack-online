import "server-only";
import { db } from "@/lib/db";
import { todayStr } from "@/lib/api-utils";
import type { Prisma } from "@prisma/client";

/**
 * G4 — سجل نقل المراحل بالمنفِّذ والملاحظة (المكتبي transaction_stage_log + move_to_stage 2283–2318):
 * النقل يغلق النقلة المفتوحة السابقة (end_date = اليوم) ثم يفتح نقلة جديدة —
 * لكل أنواع المعاملات (عقد/دفعة/باطن/عميل) لا للعقود فقط.
 */

export type StageMoveClient = Prisma.TransactionClient | typeof db;

export interface StageMoveInput {
  transactionType: string;
  transactionId: number;
  stageId?: number | null;
  movedById?: number | null;
  /** move | finish | revert | skip | reopen */
  action?: string;
  note?: string;
  /** تاريخ بدء النقلة — افتراضي اليوم */
  startDate?: string;
}

/** تسجيل نقلة: إغلاق المفتوح السابق للمعاملة ثم إدراج الجديدة (على عميل المعاملة الممرَّر) */
export async function recordStageMove(client: StageMoveClient, input: StageMoveInput): Promise<void> {
  const { transactionType, transactionId, stageId = null, movedById = null, action = "move", note = "" } = input;
  if (!transactionType || !Number.isFinite(transactionId)) return;
  const today = todayStr();
  // إغلاق النقلة الجارية (عداد الأيام) — فقط عند نقلة بدء فعلية (move) كالمكتبي
  if (action === "move") {
    await client.stageMove.updateMany({
      where: { transactionType, transactionId, endDate: "" },
      data: { endDate: today },
    });
  }
  await client.stageMove.create({
    data: {
      transactionType,
      transactionId,
      stageId: stageId ?? null,
      movedById: movedById ?? null,
      action,
      note: (note || "").trim(),
      startDate: (input.startDate || today).trim(),
    },
  });
}
