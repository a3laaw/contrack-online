import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { nextNumberByKey } from "@/lib/contrack-server";
import { cleanPurchaseText, r3 } from "@/lib/purchase-core";
import { SUPPLIER_NUMBER_KEY, SUPPLIER_NUMBER_PREFIX } from "@/lib/purchase-constants";

/**
 * ر4 — الموردون (docs/purchase-design.md §5 د1/د7): البوابة screen_purchase + حرس
 * موديول purchase — والترقيم SUP ذريًا بمزامنة العدّاد فوق الأرقام القائمة أول استخدام
 * (نمط QUO/CPR حرفيًا) وتفرّد الاسم لكل شركة.
 */

/** قائمة الموردين مع عدّاد أوامرهم وقيمتها (الملغى يستثنى) — والبحث بالاسم/الهاتف/الكود */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [{ name: { contains: q } }, { phone: { contains: q } }, { supplierCode: { contains: q } }];
  }

  const suppliers = await db.supplier.findMany({
    where,
    select: {
      id: true, supplierCode: true, name: true, phone: true, email: true,
      address: true, crNumber: true, active: true, notes: true, createdAt: true,
      purchaseOrders: { select: { totalAmount: true, status: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });

  const rows = suppliers.map((s) => ({
    id: s.id,
    supplierCode: s.supplierCode,
    name: s.name,
    phone: s.phone,
    email: s.email,
    address: s.address,
    crNumber: s.crNumber,
    active: s.active,
    notes: s.notes,
    createdAt: s.createdAt,
    ordersCount: s.purchaseOrders.length,
    ordersValue: r3(
      s.purchaseOrders.filter((o) => o.status !== "ملغى").reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0)
    ),
  }));
  return ok({ suppliers: rows });
}

/** إنشاء مورد — SUP ذريًا داخل معاملة واحدة مع التدقيق (د7) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanPurchaseText(body.name);
  if (!name) return jsonError("اسم المورد إلزامي.", 400);

  const data = {
    name,
    phone: cleanPurchaseText(body.phone),
    email: cleanPurchaseText(body.email),
    address: cleanPurchaseText(body.address),
    crNumber: cleanPurchaseText(body.crNumber),
    active: body.active === undefined ? true : Boolean(body.active),
    notes: cleanPurchaseText(body.notes),
  };

  let created: { id: number; supplierCode: string; name: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        // مزامنة العدّاد فوق الأرقام القائمة أول استخدام (نمط QUO حرفيًا)
        const last = await tx.supplier.findFirst({ orderBy: { supplierCode: "desc" }, select: { supplierCode: true } });
        const m = last?.supplierCode?.match(/SUP-(\d+)/);
        const maxNo = m ? parseInt(m[1], 10) : 0;
        if (Number.isFinite(maxNo) && maxNo > 0) {
          const seqRow = await tx.numberSequence.findFirst({ where: { name: SUPPLIER_NUMBER_KEY } });
          if (!seqRow) {
            await tx.numberSequence.create({ data: { name: SUPPLIER_NUMBER_KEY, lastNo: maxNo } });
          } else if (Number(seqRow.lastNo) < maxNo) {
            await tx.numberSequence.update({
              where: { companyId_name: { companyId: seqRow.companyId, name: SUPPLIER_NUMBER_KEY } },
              data: { lastNo: maxNo },
            });
          }
        }
        const supplierCode = await nextNumberByKey(SUPPLIER_NUMBER_KEY, SUPPLIER_NUMBER_PREFIX, 4, tx);
        const row = await tx.supplier.create({ data: { ...data, supplierCode }, select: { id: true, supplierCode: true, name: true } });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء مورد",
          entityType: "supplier",
          entityId: row.id,
          entityName: `${row.supplierCode} — ${row.name}`,
        });
        return row;
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 7) {
        lastError = e; // تضارب الكود أو الاسم — أعِد التوليد (نمط العروض)
        continue;
      }
      lastError = e;
      break;
    }
  }
  if (!created) {
    const msg =
      lastError instanceof Prisma.PrismaClientKnownRequestError && lastError.code === "P2002"
        ? "اسم المورد مكرر — اختر اسمًا آخر."
        : "تعذر إنشاء المورد.";
    console.error("فشل إنشاء مورد:", lastError);
    return jsonError(msg, lastError instanceof Prisma.PrismaClientKnownRequestError && lastError.code === "P2002" ? 400 : 500);
  }
  return ok({ supplier: created }, 201);
}
