import "server-only";
import { db } from "@/lib/db";
import { hasPermission, isSuperRole, type SessionUser } from "@/lib/auth";

/**
 * G2 — المشاركون في المعاملة والرؤية (المكتبي workflow_service.py 1262–1342):
 * المشاركة = الرؤية. المدير والمطور يريان كل شيء، ومن يملك شاشة المعاملة يرى مسارها
 * الفني للمتابعة، وغيرهما يرى المعاملة إن كان مشاركًا فقط.
 * أي تفاعل (فتح محادثة، إرسال رسالة، نقل مرحلة…) يجعل المستخدم مشاركًا تلقائيًا.
 */

export const TX_CONTRACT = "contract";
export const TX_CUSTOMER = "customer";
export const TX_SUBCONTRACT = "subcontract";

/** شاشة كل نوع معاملة — لقاعدة «من يملك شاشة المعاملة يرى مسارها» */
const TX_SCREEN_PERM: Record<string, string> = {
  [TX_CONTRACT]: "screen_contracts",
  [TX_CUSTOMER]: "screen_customers",
  [TX_SUBCONTRACT]: "screen_subcontractors",
};

/** أي تفاعل يجعل المستخدم مشاركًا — INSERT OR IGNORE (المكتبي auto_add_participant) */
export async function autoAddParticipant(userId: number, transactionType: string, transactionId: number): Promise<void> {
  const uid = Number(userId || 0);
  if (!uid || !Number.isFinite(transactionId)) return;
  try {
    await db.transactionParticipant.createMany({
      data: [{ userId: uid, transactionType, transactionId }],
      skipDuplicates: true,
    });
  } catch {
    /* المشاركة لا تعطل التفاعل */
  }
}

/** معرفات المشاركين في معاملة (المكتبي participants) */
export async function participantsOf(transactionType: string, transactionId: number): Promise<number[]> {
  const rows = await db.transactionParticipant.findMany({
    where: { transactionType, transactionId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * هل يرى هذا المستخدم المعاملة؟ (المكتبي can_user_view)
 * المدير/المطور ← الكل · مالك شاشة النوع ← مسارها الفني · غيره ← مشارك فقط.
 */
export async function canUserView(user: Pick<SessionUser, "id" | "role">, transactionType: string, transactionId: number): Promise<boolean> {
  if (isSuperRole(user.role)) return true;
  const screen = TX_SCREEN_PERM[transactionType];
  if (screen && (await hasPermission(user.id, user.role, screen))) return true;
  const row = await db.transactionParticipant.findFirst({
    where: { transactionType, transactionId, userId: user.id },
    select: { id: true },
  });
  return Boolean(row);
}

/** هل يرى المستخدم كل معاملات النوع (مدير/مطور أو مالك الشاشة)؟ — لفلترة القوائم دون فحص كل صف */
export async function canViewAllOf(user: Pick<SessionUser, "id" | "role">, transactionType: string): Promise<boolean> {
  if (isSuperRole(user.role)) return true;
  const screen = TX_SCREEN_PERM[transactionType];
  if (!screen) return false;
  return hasPermission(user.id, user.role, screen);
}

/** مجموعة معاملات النوع التي يشارك فيها مستخدم — لفلترة القوائم (المتابعة) */
export async function participantTxIds(userId: number, transactionType: string): Promise<Set<number>> {
  const rows = await db.transactionParticipant.findMany({
    where: { userId, transactionType },
    select: { transactionId: true },
  });
  return new Set(rows.map((r) => r.transactionId));
}
