import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { nextNumberByKey } from "@/lib/contrack-server";
import { r3, cleanPurchaseDate, cleanPurchaseText, poTotalAmount } from "@/lib/purchase-core";
import {
  isPurchaseOrderStatus,
  PO_CREATE_STATUSES,
  PO_INVALID_STATUS,
  PO_ITEMS_REQUIRED,
  PO_NUMBER_KEY,
  PO_NUMBER_PREFIX,
  PO_SUPPLIER_REQUIRED,
} from "@/lib/purchase-constants";

/**
 * ر4 — أوامر الشراء (docs/purchase-design.md §5 د2/د3/د7):
 * • سطر الأمر صنف مخزني إلزامي (G7) بسعر لقطة مجمّد ومبلغ r3(كمية×سعر)
 * • الإنشاء «مسودة» أو «مرسل للمورد» مباشرة — «جزئي/مستلم» يرفعان آليًا بالاستلام حصرًا
 * • ترقيم PO ذريًا بمزامنة العدّاد (نمط QUO/CPR) وبإعادة المحاولة على P2002
 */

/** قائمة الأوامر — فلاتر حالة/مورد/نص/فترة التاريخ (الأحدث أولًا) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || "";
  const supplierId = Number(sp.get("supplierId") || 0);
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const q = (sp.get("q") || "").trim();

  const where: Record<string, unknown> = {};
  if (status && status !== "الكل") {
    if (!isPurchaseOrderStatus(status)) return jsonError(PO_INVALID_STATUS, 400);
    where.status = status;
  }
  if (Number.isFinite(supplierId) && supplierId > 0) where.supplierId = supplierId;
  if (from || to) {
    const range: Record<string, string> = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) range.gte = from;
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) range.lte = to;
    if (Object.keys(range).length > 0) where.orderDate = range;
  }
  if (q) {
    where.OR = [{ poNumber: { contains: q } }, { notes: { contains: q } }, { supplier: { name: { contains: q } } }];
  }

  const orders = await db.purchaseOrder.findMany({
    where,
    select: {
      id: true, poNumber: true, orderDate: true, expectedDate: true, status: true,
      totalAmount: true, receivedAmount: true, notes: true, supplierId: true, contractId: true,
      createdAt: true,
      supplier: { select: { id: true, name: true, supplierCode: true } },
      contract: { select: { id: true, contractNumber: true } },
      items: { select: { id: true, qty: true, receivedQty: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({ orders });
}

/** إنشاء أمر شراء ببنوده — رأس وأسطر وترقيم وتدقيق في معاملة واحدة (د7) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const supplierId = Number(body.supplierId ?? 0) || 0;
  if (!supplierId) return jsonError(PO_SUPPLIER_REQUIRED, 400);
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, active: true } });
  if (!supplier) return jsonError("المورد غير موجود.", 400);
  if (!supplier.active) return jsonError("المورد غير نشط — فعّله أولًا.", 400);

  const orderDate = cleanPurchaseDate(body.orderDate) || new Date().toISOString().slice(0, 10);
  const expectedDate = cleanPurchaseDate(body.expectedDate);

  const contractId = Number(body.contractId ?? 0) || 0;
  if (contractId > 0) {
    const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true, status: true } });
    if (!contract) return jsonError("العقد المرتبط غير موجود.", 400);
    if (contract.status === "ملغى") return jsonError("لا يمكن ربط الأمر بعقد ملغى.", 400);
  }

  // د2 — بنود الأوامر: صنف مخزني إلزامي بكمية موجبة وسعر لقطة غير سالب — لا سطور وصف حر
  const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
  const parsed: { itemId: number; qty: number; unitPrice: number; amount: number; note: string }[] = [];
  for (const it of rawItems) {
    const itemId = Number(it?.itemId ?? 0) || 0;
    const qty = Number(it?.qty ?? 0) || 0;
    const unitPrice = Math.max(0, Number(it?.unitPrice ?? 0) || 0);
    if (!itemId) return jsonError("كل بند أمر شراء يتطلب صنفًا من المخازن.", 400);
    if (qty <= 0) return jsonError("كمية كل بند يجب أن تكون أكبر من صفر.", 400);
    parsed.push({ itemId, qty, unitPrice, amount: r3(qty * unitPrice), note: cleanPurchaseText(it?.note) });
  }
  if (parsed.length === 0) return jsonError(PO_ITEMS_REQUIRED, 400);
  // تفرّد الأصناف داخل الأمر — ووجودها ونشاطها
  const itemIds = [...new Set(parsed.map((p) => p.itemId))];
  if (itemIds.length !== parsed.length) return jsonError("لا يُكرر الصنف نفسه في بنود الأمر — اجمع الكميات في سطر واحد.", 400);
  const stockItems = await db.stockItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, active: true },
  });
  for (const iid of itemIds) {
    const found = stockItems.find((s) => s.id === iid);
    if (!found) return jsonError(`الصنف #${iid} غير موجود.`, 400);
    if (!found.active) return jsonError(`الصنف «${found.name}» غير نشط.`, 400);
  }

  const status =
    typeof body.status === "string" && body.status && isPurchaseOrderStatus(body.status)
      ? body.status
      : "مسودة";
  if (!(PO_CREATE_STATUSES as readonly string[]).includes(status)) {
    return jsonError("إنشاء الأمر يكون بحالة «مسودة» أو «مرسل للمورد» فقط — بقية الحالات آلية بالاستلام.", 400);
  }

  const totalAmount = poTotalAmount(parsed);
  const notes = cleanPurchaseText(body.notes);

  const data = {
    supplierId,
    orderDate,
    expectedDate,
    ...(contractId > 0 ? { contractId } : {}),
    status,
    totalAmount,
    receivedAmount: 0,
    notes,
    createdBy: guard.user.id,
    items: {
      create: parsed.map((p, i) => ({
        itemId: p.itemId,
        qty: p.qty,
        receivedQty: 0,
        unitPrice: p.unitPrice,
        amount: p.amount,
        sortOrder: i,
      })),
    },
  };

  let created: { id: number; poNumber: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        // مزامنة العدّاد فوق الأرقام القائمة أول استخدام (نمط QUO حرفيًا)
        const last = await tx.purchaseOrder.findFirst({ orderBy: { poNumber: "desc" }, select: { poNumber: true } });
        const m = last?.poNumber?.match(/PO-(\d+)/);
        const maxNo = m ? parseInt(m[1], 10) : 0;
        if (Number.isFinite(maxNo) && maxNo > 0) {
          const seqRow = await tx.numberSequence.findFirst({ where: { name: PO_NUMBER_KEY } });
          if (!seqRow) {
            await tx.numberSequence.create({ data: { name: PO_NUMBER_KEY, lastNo: maxNo } });
          } else if (Number(seqRow.lastNo) < maxNo) {
            await tx.numberSequence.update({
              where: { companyId_name: { companyId: seqRow.companyId, name: PO_NUMBER_KEY } },
              data: { lastNo: maxNo },
            });
          }
        }
        const poNumber = await nextNumberByKey(PO_NUMBER_KEY, PO_NUMBER_PREFIX, 4, tx);
        const row = await tx.purchaseOrder.create({ data: { ...data, poNumber }, select: { id: true, poNumber: true } });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء أمر شراء",
          entityType: "purchase_order",
          entityId: row.id,
          entityName: `${row.poNumber} — ${supplier.name}`,
          newStatus: status,
        });
        return row;
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 7) {
        lastError = e; // تضارب رقم الأمر — أعِد التوليد (نمط العروض)
        continue;
      }
      lastError = e;
      break;
    }
  }
  if (!created) {
    console.error("فشل إنشاء أمر شراء:", lastError);
    return jsonError("تعذر إنشاء رقم أمر شراء غير مكرر.", 500);
  }
  return ok({ order: created }, 201);
}
