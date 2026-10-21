import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * G7 — نسخة احتياطية قبل الإلغاء (المكتبي _create_backup 290–326):
 * JSON كامل للسجل قبل تغيير حالته — الأرشفة لا تحذف، والإلغاء تغيير حالة + تدقيق.
 */

export type BackupClient = Prisma.TransactionClient | typeof db;

/** لقطة JSON للكيان قبل الإلغاء — تُكتب في entity_backups */
export async function createEntityBackup(
  client: BackupClient,
  entityType: "contract" | "sub_contract" | "claim" | "custody",
  entityId: number,
  username: string
): Promise<number | null> {
  let data: unknown = null;
  if (entityType === "contract") {
    data = await client.contract.findUnique({ where: { id: entityId } });
  } else if (entityType === "sub_contract") {
    data = await client.subContract.findUnique({ where: { id: entityId } });
  } else if (entityType === "claim") {
    data = await client.claim.findUnique({ where: { id: entityId } });
  }
  if (!data) return null;
  const row = await client.entityBackup.create({
    data: {
      entityType,
      entityId,
      backupData: JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
      createdBy: username,
    },
  });
  return row.id;
}
