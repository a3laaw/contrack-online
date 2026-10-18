import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, normalizeArabic, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";

/** قائمة عقود الباطن: فلاتر subcontractorId / contractId / q — مع paid وremaining */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const subcontractorId = Number(sp.get("subcontractorId") || 0);
  const contractId = Number(sp.get("contractId") || 0);
  const q = (sp.get("q") || "").trim();

  const where: Prisma.SubContractWhereInput = {};
  if (Number.isFinite(subcontractorId) && subcontractorId > 0) where.subcontractorId = subcontractorId;
  if (Number.isFinite(contractId) && contractId > 0) where.contractId = contractId;

  const rows = await db.subContract.findMany({
    where,
    include: {
      subcontractor: { select: { id: true, name: true, subCode: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true, customer: { select: { name: true } } } },
      planLines: { select: { amount: true } },
      _count: { select: { items: true, planLines: true } },
    },
    orderBy: { id: "desc" },
    take: 1000,
  });

  const nq = normalizeArabic(q);
  const items: Record<string, unknown>[] = [];
  for (const sc of rows) {
    if (nq && !normalizeArabic(`${sc.subcontractor.name} ${sc.contract.contractNumber} ${sc.description}`).includes(nq)) continue;
    const paidAgg = await db.voucher.aggregate({
      where: { subContractId: sc.id, vtype: "payment", cancelled: false, allocation: "" },
      _sum: { amount: true },
    });
    const paid = r3(Number(paidAgg._sum.amount || 0));
    const amount = Number(sc.amount);
    items.push({
      id: sc.id,
      subcontractorId: sc.subcontractorId,
      subcontractorName: sc.subcontractor.name,
      subCode: sc.subcontractor.subCode,
      contractId: sc.contractId,
      contractNumber: sc.contract.contractNumber,
      contractName: sc.contract.contractName,
      customerName: sc.contract.customer.name,
      amount,
      startDate: sc.startDate,
      endDate: sc.endDate,
      status: sc.status,
      description: sc.description,
      cancelReason: sc.cancelReason,
      cancelledAt: sc.cancelledAt,
      planTotal: r3(sc.planLines.reduce((s, p) => s + Number(p.amount), 0)),
      itemsCount: sc._count.items,
      planCount: sc._count.planLines,
      paid,
      remaining: r3(amount - paid),
    });
  }

  return ok({ subContracts: items });
}

/** إنشاء عقد باطن — مع بنود من BOQ أو يدوية، الحالة «نشط» */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const subcontractorId = Number(body.subcontractorId || 0);
  const contractId = Number(body.contractId || 0);
  if (!subcontractorId) return jsonError("المقاول مطلوب");
  if (!contractId) return jsonError("عقد العميل مطلوب");

  const [sub, contract] = await Promise.all([
    db.subcontractor.findUnique({ where: { id: subcontractorId } }),
    db.contract.findUnique({ where: { id: contractId } }),
  ]);
  if (!sub) return jsonError("المقاول غير موجود", 404);
  if (!contract) return jsonError("عقد العميل غير موجود", 404);

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || !(amount > 0)) return jsonError("قيمة عقد الباطن يجب أن تكون أكبر من صفر");

  const startDate = parseDay(body.startDate);
  const endDate = parseDay(body.endDate);
  const description = String(body.description || "");
  const itemsIn = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];

  // التحقق من البنود قبل المعاملة
  const preparedItems: { boqItemId: number | null; qty: number; unitPrice: number; amount: number; sourceKind: string; sourceId: number }[] = [];
  for (const it of itemsIn) {
    if (it.boqItemId) {
      const boq = await db.boqItem.findUnique({ where: { id: Number(it.boqItemId) } });
      if (!boq || boq.contractId !== contractId) return jsonError(`بند الكميات ${it.boqItemId} غير موجود في هذا العقد`, 400);
      preparedItems.push({
        boqItemId: boq.id,
        qty: Number(boq.qty),
        unitPrice: Number(boq.unitPrice),
        amount: Number(boq.amount),
        sourceKind: "",
        sourceId: 0,
      });
    } else {
      const qty = Number(it.qty);
      const unitPrice = Number(it.unitPrice);
      if (!(qty > 0) || !(unitPrice > 0)) return jsonError("بنود عقد الباطن اليدوية تتطلب كمية وسعر وحدة أكبر من صفر", 400);
      preparedItems.push({ boqItemId: null, qty, unitPrice, amount: r3(qty * unitPrice), sourceKind: "", sourceId: 0 });
    }
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const sc = await tx.subContract.create({
        data: {
          subcontractorId,
          contractId,
          amount,
          startDate,
          endDate,
          description,
          status: "نشط",
        },
      });
      for (const it of preparedItems) {
        await tx.subContractItem.create({
          data: {
            subContractId: sc.id,
            boqItemId: it.boqItemId,
            qty: it.qty,
            unitPrice: it.unitPrice,
            amount: it.amount,
            sourceKind: it.sourceKind,
            sourceId: it.sourceId,
          },
        });
      }
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "إضافة عقد باطن",
          description: `أُضيف عقد باطن للمقاول ${sub.name} بقيمة ${amount}`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "إنشاء",
        entityType: "sub_contract",
        entityId: sc.id,
        entityName: `باطن ${sc.id} — ${sub.name}`,
      });
      return sc;
    });
    return ok({ subContract: { id: created.id, status: created.status } }, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(e);
      return jsonError("تعذر إنشاء عقد الباطن", 500);
    }
    throw e;
  }
}
