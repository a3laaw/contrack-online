import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, normalizeArabic, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { nextNumberByKey } from "@/lib/contrack-server";

/** قائمة مقاولي الباطن: بحث + لكل مقاول عدد عقوده النشطة ومجموعها والمنصرف له */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;

  const q = (req.nextUrl.searchParams.get("q") || "").trim();

  const subs = await db.subcontractor.findMany({
    include: {
      subContracts: { select: { id: true, amount: true, status: true, contractId: true } },
    },
    orderBy: { id: "asc" },
  });

  const nq = normalizeArabic(q);
  const rows: Record<string, unknown>[] = [];
  for (const s of subs) {
    if (nq && !normalizeArabic(`${s.subCode} ${s.name} ${s.phone} ${s.activity}`).includes(nq)) continue;
    const active = s.subContracts.filter((sc) => sc.status !== "ملغى");
    const activeAmount = r3(active.reduce((sum, sc) => sum + Number(sc.amount), 0));
    const contractIds = [...new Set(active.map((sc) => sc.contractId))];
    const paidAgg = await db.voucher.aggregate({
      where: {
        vtype: "payment",
        cancelled: false,
        partyType: "subcontractor",
        partyId: s.id,
        contractId: contractIds.length ? { in: contractIds } : undefined,
      },
      _sum: { amount: true },
    });
    rows.push({
      id: s.id,
      subCode: s.subCode,
      name: s.name,
      phone: s.phone,
      email: s.email,
      activity: s.activity,
      notes: s.notes,
      showAllContracts: s.showAllContracts,
      activeContracts: active.length,
      activeAmount,
      paid: r3(Number(paidAgg._sum.amount || 0)),
    });
  }

  return ok({ subcontractors: rows });
}

/** إضافة مقاول — SUB-0001 عدّاد ذري مع إعادة محاولة 5× عند تضارب unique */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم المقاول مطلوب");

  const data = {
    name,
    phone: String(body.phone || ""),
    email: String(body.email || ""),
    activity: String(body.activity || ""),
    notes: String(body.notes || ""),
    showAllContracts: Boolean(body.showAllContracts),
  };

  let created: { id: number; subCode: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        const subCode = await nextNumberByKey("subcontractor:code", "SUB", 4, tx);
        const sub = await tx.subcontractor.create({ data: { ...data, subCode } });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء",
          entityType: "subcontractor",
          entityId: sub.id,
          entityName: `${subCode} — ${name}`,
        });
        return sub;
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        lastError = e;
        continue;
      }
      lastError = e;
      break;
    }
  }
  if (!created) {
    console.error("فشل إنشاء مقاول:", lastError);
    return jsonError("تعذر إنشاء المقاول، حاول مجددًا", 500);
  }
  return ok({ subcontractor: { id: created.id, subCode: created.subCode, name } }, 201);
}
