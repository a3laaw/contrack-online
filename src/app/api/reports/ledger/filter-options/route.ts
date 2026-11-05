import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { db } from "@/lib/db";

/**
 * خيارات فلاتر مخرجات المحاسبة — Task 108.
 * GET /api/reports/ledger/filter-options — بوابة واحدة بصلاحية الشاشة (screen_ledger)
 * فلا يُشترط لعرض الفلاتر صلاحيات شاشات أخرى: العملاء والعقود وعقود الباطن
 * ومراكز التكلفة المستخدمة فعلًا في القيود.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_ledger");
  if ("response" in guard) return guard.response;

  const [customers, contracts, subContracts, costCenterRows] = await Promise.all([
    db.customer.findMany({
      select: { id: true, name: true, customerCode: true },
      orderBy: { name: "asc" },
    }),
    db.contract.findMany({
      where: { status: { notIn: ["ملغى", "ملغي", "مسودة"] } },
      select: { id: true, contractNumber: true, contractName: true },
      orderBy: [{ contractDate: "desc" }, { id: "desc" }],
      take: 500,
    }),
    db.subContract.findMany({
      select: {
        id: true,
        description: true,
        subcontractor: { select: { name: true } },
        contract: { select: { contractNumber: true } },
      },
      orderBy: { id: "desc" },
      take: 500,
    }),
    db.journalLine.findMany({
      where: { costCenter: { not: "" } },
      select: { costCenter: true },
      distinct: ["costCenter"],
      take: 200,
    }),
  ]);

  return ok({
    customers: customers.map((c) => ({ id: c.id, name: c.name, code: c.customerCode })),
    contracts: contracts.map((c) => ({ id: c.id, label: `${c.contractNumber}${c.contractName ? ` — ${c.contractName}` : ""}` })),
    subContracts: subContracts.map((s) => ({
      id: s.id,
      label: `${s.subcontractor?.name || "مقاول"}${s.description ? ` — ${s.description}` : ""}${
        s.contract?.contractNumber ? ` · ${s.contract.contractNumber}` : ""
      }`,
    })),
    costCenters: costCenterRows.map((r) => r.costCenter),
  });
}
