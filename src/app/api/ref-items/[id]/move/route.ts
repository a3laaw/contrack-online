import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/**
 * تحريك بند أعلى/أسفل — يعيد ترقيم إخوات القائمة كتلةً داخل معاملة،
 * فتُعايَر sortOrders المكررة من بذور سابقة إن وُجدت (ترتيب نهائي sortOrder ثم id).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صحيح");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dir = String(body.dir || "");
  if (dir !== "up" && dir !== "down") return jsonError("اتجاه الحركة غير صحيح");

  const item = await db.refItem.findFirst({ where: { id } });
  if (!item) return jsonError("البند غير موجود", 404);

  const siblings = await db.refItem.findMany({
    where: { listId: item.listId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const idx = siblings.findIndex((s) => s.id === id);
  const targetIdx = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || targetIdx < 0 || targetIdx >= siblings.length) {
    return ok({ message: "البند في طرف القائمة بالفعل", moved: false });
  }

  // تبديل الموضعين ثم إعادة ترقيم كل القائمة 1..n — بلا صفر مكرر ولا فجوات
  const order = [...siblings];
  [order[idx], order[targetIdx]] = [order[targetIdx], order[idx]];

  await db.$transaction(async (tx) => {
    for (let i = 0; i < order.length; i++) {
      await tx.refItem.update({ where: { id: order[i].id }, data: { sortOrder: i + 1 } });
    }
  });

  return ok({ message: "تم الترتيب", moved: true });
}
