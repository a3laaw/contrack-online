// GET /api/warehouses/deviation?contractId= — انحراف المواد على بنود الكميات (درس G1 المحقق — FK حقيقي)
// لكل بند BOQ بالعقد: التعاقدي (كمية/قيمة) مقابل المنصرف من المخازن (كمية/قيمة باللقطات المجففة).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/warehouses-constants";
import { deviationOfBoq } from "@/lib/warehouses-core";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const contractId = Number(req.nextUrl.searchParams.get("contractId") ?? "");
  if (!Number.isFinite(contractId) || contractId <= 0) return jsonError("معرّف العقد مطلوب");

  const contract = await db.contract.findFirst({
    where: { id: contractId },
    select: { id: true, contractNumber: true, contractName: true, status: true },
  });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const [boqItems, issueLines, returnDocs] = await Promise.all([
    db.boqItem.findMany({
      where: { contractId, deleted: false },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, description: true, qty: true, unit: true, unitPrice: true, amount: true },
    }),
    // أسطر الصرف على العقد (بأذرنها المرحّلة) — الكمية والقيمة المجففة لكل بند
    db.stockDocLine.findMany({
      where: { doc: { status: "posted", kind: "issue", contractId }, boqItemId: { not: null } },
      select: { boqItemId: true, qty: true, amount: true },
    }),
    // أذون المرتجع الموقعي — تُخصم من المنصرف (قيمةً وكميةً)
    db.stockDoc.findMany({
      where: { status: "posted", kind: "entry", entrySource: "return", contractId },
      select: { lines: { select: { itemId: true, qty: true, amount: true } } },
    }),
  ]);

  const issuedByBoq = new Map<number, { qty: number; value: number }>();
  for (const l of issueLines) {
    if (l.boqItemId == null) continue;
    const acc = issuedByBoq.get(l.boqItemId) ?? { qty: 0, value: 0 };
    acc.qty = r3(acc.qty + Number(l.qty));
    acc.value = r3(acc.value + Number(l.amount));
    issuedByBoq.set(l.boqItemId, acc);
  }
  const returnQty = r3(returnDocs.reduce((s, d) => s + d.lines.reduce((s2, l) => s2 + Number(l.qty), 0), 0));
  const returnValue = r3(returnDocs.reduce((s, d) => s + d.lines.reduce((s2, l) => s2 + Number(l.amount), 0), 0));

  // المرتجع غير مربوط ببنود (يُخصم من إجمالي العقد لا من بند بعينه)
  const issued = Array.from(issuedByBoq.entries()).map(([boqItemId, v]) => ({ boqItemId, qty: v.qty, value: v.value }));
  const rows = deviationOfBoq(
    boqItems.map((b) => ({ id: b.id, description: b.description, qty: Number(b.qty), unitPrice: Number(b.unitPrice), amount: Number(b.amount), unit: b.unit })),
    issued
  );
  const totalIssuedValue = r3(Array.from(issuedByBoq.values()).reduce((s, v) => s + v.value, 0));

  return ok({
    contract: { id: contract.id, contractNumber: contract.contractNumber, contractName: contract.contractName, status: contract.status },
    rows,
    summary: {
      totalContractValue: r3(boqItems.reduce((s, b) => s + Number(b.amount), 0)),
      totalIssuedValue,
      returnQty,
      returnValue,
      netIssuedValue: r3(totalIssuedValue - returnValue),
      unlinkedReturnQty: returnQty,
    },
  });
}
