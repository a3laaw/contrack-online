import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, normalizeArabic, ok } from "@/lib/api-utils";
import { nextNumberByKey } from "@/lib/contrack-server";

/** قائمة العملاء — بحث بالاسم/الهاتف/الكود بتطبيع عربي + count عقود */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const customers = await db.customer.findMany({
    include: { _count: { select: { contracts: true } } },
    orderBy: { id: "desc" },
  });
  const nq = normalizeArabic(q);
  const list = nq
    ? customers.filter(
        (c) =>
          normalizeArabic(c.name).includes(nq) ||
          normalizeArabic(c.phone).includes(nq) ||
          normalizeArabic(c.customerCode).includes(nq)
      )
    : customers;
  return ok({
    customers: list.map((c) => ({
      id: c.id,
      customerCode: c.customerCode,
      name: c.name,
      phone: c.phone,
      email: c.email,
      governorate: c.governorate,
      area: c.area,
      block: c.block,
      plot: c.plot,
      address: c.address,
      notes: c.notes,
      contractsCount: c._count.contracts,
      createdAt: c.createdAt,
    })),
  });
}

/** إنشاء عميل — كود تلقائي C-0001 عبر عدّاد customer:code (ذري مع إعادة محاولة عند التضارب) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم العميل مطلوب");

  const data = {
    name,
    phone: String(body.phone || ""),
    email: String(body.email || ""),
    governorate: String(body.governorate || ""),
    area: String(body.area || ""),
    block: String(body.block || ""),
    plot: String(body.plot || ""),
    address: String(body.address || ""),
    notes: String(body.notes || ""),
  };

  let customer: { id: number; customerCode: string; name: string; phone: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      customer = await db.$transaction(async (tx) => {
        const code = await nextNumberByKey("customer:code", "C", 4, tx);
        const created = await tx.customer.create({ data: { ...data, customerCode: code } });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء",
          entityType: "customer",
          entityId: created.id,
          entityName: created.name,
        });
        return created;
      });
      break;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        attempt < 4
      ) {
        lastError = e;
        continue;
      }
      lastError = e;
      customer = null;
      break;
    }
  }
  if (!customer) {
    console.error("فشل إنشاء عميل:", lastError);
    return jsonError("تعذر إنشاء العميل، حاول مجددًا");
  }
  return ok(
    {
      customer: {
        id: customer.id,
        customerCode: customer.customerCode,
        name: customer.name,
        phone: customer.phone,
      },
    },
    201
  );
}
