import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * G3 — إشعارات التطبيق (المكتبي workflow_service.py):
 * أنواع الإشعار (112–113) · المستهدفون (442–452) · الدفع (455–463) ·
 * القراءة (2595–2545) · المسح القديم (2697–2712).
 * المستهدفون: كل المشاركين (G2 لاحقًا) + كل مدير/مطور نشط، بلا المنفِّذ نفسه.
 */

export const NOTIF_STAGE = "stage_change";
export const NOTIF_MESSAGE = "new_message";

/** عميل Prisma (مثبت أو داخل معاملة) — قبول الاثنين في كل الدوال */
export type NotifClient = PrismaClient | Prisma.TransactionClient;

export const NOTIF_TYPES = ["contract", "payment", "subcontract", "customer"] as const;
export type NotifTransactionType = (typeof NOTIF_TYPES)[number];

/**
 * المستهدفون: كل المديرين والمطورين النشطين + المشاركون (تُضاف في G2).
 * المكتبي _notify_targets: participants ∪ admins − المنفِّذ.
 */
export async function notifyTargets(excludeUserId = 0): Promise<number[]> {
  const admins = await db.user.findMany({
    where: { role: { in: ["admin", "developer"] }, active: true },
    select: { id: true },
  });
  const ids = new Set<number>(admins.map((a) => a.id));
  ids.delete(Number(excludeUserId || 0));
  return [...ids].sort((a, b) => a - b);
}

/** الدفع الفعلي للإشعارات (المكتبي _push) — على العميل الممرَّر (يدعم المعاملات) */
export async function pushNotifications(
  client: NotifClient,
  opts: { targets: number[]; transactionType: string; transactionId: number; type: string; text: string }
): Promise<number> {
  const { targets, transactionType, transactionId, type, text } = opts;
  if (!targets.length || !text.trim()) return 0;
  const res = await client.appNotification.createMany({
    data: targets.map((userId) => ({
      userId,
      transactionType,
      transactionId,
      type,
      text: text.trim(),
    })),
  });
  return res.count;
}

/** إطلاق جاهز بعد نجاح العملية: يحسب المستهدفين (بلا المنفِّذ) ويدفع — خارج المعاملة عمدًا */
export async function notifyTransaction(opts: {
  transactionType: string;
  transactionId: number;
  type: string;
  text: string;
  excludeUserId?: number;
  targets?: number[];
}): Promise<number> {
  const targets = opts.targets ?? (await notifyTargets(opts.excludeUserId));
  return pushNotifications(db, { ...opts, targets });
}

/** غير المقروءة (آخر 100) — المكتبي get_unread_notifications */
export async function unreadNotifications(userId: number) {
  const rows = await db.appNotification.findMany({
    where: { userId, isRead: false },
    orderBy: { id: "desc" },
    take: 100,
    select: {
      id: true,
      transactionType: true,
      transactionId: true,
      type: true,
      text: true,
      createdAt: true,
    },
  });
  return rows;
}

export async function unreadCount(userId: number): Promise<number> {
  return db.appNotification.count({ where: { userId, isRead: false } });
}

/** تعليم إشعار واحد كمقروء — لصاحبه فقط */
export async function markNotificationRead(id: number, userId: number): Promise<boolean> {
  const res = await db.appNotification.updateMany({ where: { id, userId }, data: { isRead: true } });
  return res.count > 0;
}

/** تعليم الكل — يعيد عدد المقروء الآن (المكتبي mark_all_read) */
export async function markAllNotificationsRead(userId: number): Promise<number> {
  const res = await db.appNotification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  return res.count;
}

/**
 * مسح القديم (المكتبي clear_old_notifications): المقروءة تُمسح مهما كان عمرها،
 * وغير المقروءة تُمسح فقط إن تجاوزت المدة (افتراضي 30 يومًا).
 */
export async function clearOldNotifications(userId: number, days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(1, Math.trunc(days)) * 24 * 60 * 60 * 1000);
  const res = await db.appNotification.deleteMany({
    where: { userId, OR: [{ isRead: true }, { createdAt: { lt: cutoff } }] },
  });
  return res.count;
}
