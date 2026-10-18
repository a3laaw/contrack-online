import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authGuard, jsonError, normalizeArabic, ok } from "@/lib/api-utils";
import { createVoucher, VoucherError, VOUCHER_TYPE_LABELS, CreateVoucherInput } from "@/lib/voucher-server";

/** قائمة السندات بفلاتر: vtype / q / contractId / subContractId / partyType+partyId / from,to / includeCancelled */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_vouchers");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const vtype = (sp.get("vtype") || "").trim();
  const q = (sp.get("q") || "").trim();
  const contractId = Number(sp.get("contractId") || 0);
  const subContractId = Number(sp.get("subContractId") || 0);
  const partyType = (sp.get("partyType") || "").trim();
  const partyId = Number(sp.get("partyId") || 0);
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  const includeCancelled = sp.get("includeCancelled") === "1";

  const where: Prisma.VoucherWhereInput = {};
  if (vtype) where.vtype = vtype;
  if (Number.isFinite(contractId) && contractId > 0) where.contractId = contractId;
  if (Number.isFinite(subContractId) && subContractId > 0) where.subContractId = subContractId;
  if (partyType) where.partyType = partyType;
  if (Number.isFinite(partyId) && partyId > 0) where.partyId = partyId;
  if (from || to) where.vdate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (!includeCancelled) where.cancelled = false;
  if (q) {
    where.OR = [
      { voucherNumber: { contains: q } },
      { party: { contains: q } },
      { description: { contains: q } },
    ];
  }

  const rows = await db.voucher.findMany({
    where,
    include: {
      contract: { select: { id: true, contractNumber: true, contractName: true } },
      subContract: { select: { id: true, subcontractor: { select: { id: true, name: true } } } },
      employee: { select: { id: true, name: true } },
      feeChildren: { where: { cancelled: false }, select: { id: true, voucherNumber: true, amount: true } },
    },
    orderBy: [{ vdate: "desc" }, { id: "desc" }],
    take: 2000,
  });

  // أسماء الأطراف دفعة واحدة
  const customerIds = [...new Set(rows.filter((r) => r.partyType === "customer" && r.partyId).map((r) => r.partyId as number))];
  const subIds = [...new Set(rows.filter((r) => r.partyType === "subcontractor" && r.partyId).map((r) => r.partyId as number))];
  const [customers, subcontractors] = await Promise.all([
    db.customer.findMany({ where: { id: { in: customerIds.length ? customerIds : [0] } }, select: { id: true, name: true } }),
    db.subcontractor.findMany({ where: { id: { in: subIds.length ? subIds : [0] } }, select: { id: true, name: true } }),
  ]);
  const customerNames = new Map(customers.map((c) => [c.id, c.name]));
  const subNames = new Map(subcontractors.map((s) => [s.id, s.name]));

  const nq = normalizeArabic(q);
  const items = rows
    .filter((r) => {
      if (!nq) return true;
      const hay = normalizeArabic(`${r.voucherNumber} ${r.party} ${r.description}`);
      return hay.includes(nq);
    })
    .map((r) => ({
      id: r.id,
      voucherNumber: r.voucherNumber,
      vtype: r.vtype,
      vtypeLabel: VOUCHER_TYPE_LABELS[r.vtype] || r.vtype,
      vdate: r.vdate,
      party: r.party,
      partyType: r.partyType,
      partyId: r.partyId,
      partyName:
        r.partyType === "customer"
          ? customerNames.get(r.partyId as number) || r.party
          : r.partyType === "subcontractor"
            ? subNames.get(r.partyId as number) || r.party
            : r.party,
      method: r.method,
      account: r.account,
      amount: Number(r.amount),
      advanceAmount: Number(r.advanceAmount),
      description: r.description,
      notes: r.notes,
      contractId: r.contractId,
      contractNumber: r.contract?.contractNumber || "",
      contractName: r.contract?.contractName || "",
      subContractId: r.subContractId,
      subContractorName: r.subContract?.subcontractor.name || "",
      allocation: r.allocation,
      expenseAccountId: r.expenseAccountId,
      expenseAccountSnapshot: r.expenseAccountSnapshot,
      custodyAccountId: r.custodyAccountId,
      custodyAccountSnapshot: r.custodyAccountSnapshot,
      advanceEmployeeId: r.advanceEmployeeId,
      employeeName: r.employee?.name || "",
      parentVoucherId: r.parentVoucherId,
      receiptGroupRef: r.receiptGroupRef,
      receiptGroupLine: r.receiptGroupLine,
      cancelled: r.cancelled,
      cancelReason: r.cancelReason,
      cancelledAt: r.cancelledAt,
      feeChildren: r.feeChildren.map((c) => ({ id: c.id, voucherNumber: c.voucherNumber, amount: Number(c.amount) })),
    }));

  return ok({ vouchers: items });
}

/** إنشاء سند — كل الأنواع الخمسة بالسقوف والروابط والرسوم البنكية والقيود */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "action_add_voucher");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input: CreateVoucherInput = {
    vtype: String(body.vtype || ""),
    amount: Number(body.amount),
    vdate: String(body.vdate || ""),
    method: String(body.method || ""),
    account: body.account !== undefined && body.account !== null ? String(body.account) : undefined,
    party: String(body.party || ""),
    partyType: String(body.partyType || ""),
    partyId: body.partyId ? Number(body.partyId) : undefined,
    contractId: body.contractId ? Number(body.contractId) : undefined,
    subContractId: body.subContractId ? Number(body.subContractId) : undefined,
    expenseAccountId: body.expenseAccountId ? Number(body.expenseAccountId) : undefined,
    custodyAccountId: body.custodyAccountId ? Number(body.custodyAccountId) : undefined,
    advanceEmployeeId: body.advanceEmployeeId ? Number(body.advanceEmployeeId) : undefined,
    description: String(body.description || ""),
    notes: String(body.notes || ""),
    links: Array.isArray(body.links)
      ? (body.links as Record<string, unknown>[]).map((l) => ({ lineId: Number(l.lineId), amount: Number(l.amount) }))
      : [],
    allowOverpay: Boolean(body.allowOverpay),
    chequeDueDate: String(body.chequeDueDate || ""),
    allocation: String(body.allocation || ""),
    fromAccount: String(body.fromAccount || ""),
    toAccount: String(body.toAccount || ""),
    boqItemId: body.boqItemId ? Number(body.boqItemId) : undefined,
    costCenter: String(body.costCenter || ""),
    expenseCustomerId: body.expenseCustomerId ? Number(body.expenseCustomerId) : undefined,
  };

  try {
    const created = await createVoucher(input, guard.user);
    return ok({ voucher: created }, 201);
  } catch (e) {
    if (e instanceof VoucherError) {
      return Response.json({ error: e.message, ...e.extra }, { status: e.status });
    }
    console.error(e);
    return jsonError("تعذر إنشاء السند", 500);
  }
}
