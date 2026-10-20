import "server-only";
import { db } from "@/lib/db";
import { contractCurrentValue, isSupervision, supervisionExtension } from "@/lib/contrack-core";
import { actualSupervisionEnd } from "@/lib/contrack-server";
import { round3 } from "@/lib/format";
import {
  computeGroupTotals,
  type GroupTotalRow,
  type GroupTotals,
} from "@/lib/contract-groups-core";

/**
 * الخدمة الخلفية لمجموعات العقود — مرآة list_groups/group_contracts للمكتبي:
 * الملخص المالي يُحسب لحظيًا وصفوف العقود الملغاة مستثناة من كل المجاميع.
 */

export interface ContractGroupSummary {
  id: number;
  groupNumber: string;
  groupName: string;
  notes: string;
  status: string;
  customerId: number;
  customerName: string;
  contractsCount: number;
  createdBy: string;
  createdAt: string;
  totals: GroupTotals;
}

/** حالة إشرافية؟ (نفس قاعدة /api/contracts) */
const isSupContract = (c: {
  supStartDate: string;
  supMonths: number;
  supMonthly: unknown;
}): boolean => Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0;

/**
 * الصفوف المالية لكل عقد ضمن المجموعات (list_groups :121-133):
 * current = amount + ملاحق معتمدة + تمديد إشراف (نفس تركيبة كشف الحساب report-server:284)
 * collected = Σ سندات قبض سارية · paid = Σ سندات صرف سارية · subs = Σ عقود باطن غير ملغاة
 */
async function loadFinancialRows(contractIds: number[]): Promise<Map<number, GroupTotalRow>> {
  const map = new Map<number, GroupTotalRow>();
  if (contractIds.length === 0) return map;

  const contracts = await db.contract.findMany({
    where: { id: { in: contractIds } },
    select: {
      id: true,
      amount: true,
      status: true,
      supStartDate: true,
      supMonths: true,
      supMonthly: true,
      supDiscount: true,
      supWaivedMonths: true,
      addendums: { select: { status: true, amountAdd: true, amountDeduct: true } },
      vouchers: {
        where: { cancelled: false, vtype: { in: ["receipt", "payment"] } },
        select: { vtype: true, amount: true },
      },
      subContracts: { where: { status: { not: "ملغى" } }, select: { amount: true } },
    },
  });

  // تمديد الإشراف يحتاج مراحل العقود الإشرافية فقط (actualEnd من مرحلة إنهاء إشراف)
  const supIds = contracts.filter((c) => isSupContract(c)).map((c) => c.id);
  const stageRows =
    supIds.length > 0
      ? await db.contractStage.findMany({
          where: { contractId: { in: supIds } },
          select: { contractId: true, name: true, endDate: true, supActualEnd: true },
        })
      : [];
  const stagesByContract = new Map<number, { name: string; endDate: string; supActualEnd: string }[]>();
  for (const s of stageRows) {
    const arr = stagesByContract.get(s.contractId) || [];
    arr.push({ name: s.name, endDate: s.endDate, supActualEnd: s.supActualEnd });
    stagesByContract.set(s.contractId, arr);
  }

  for (const c of contracts) {
    let supExt = 0;
    if (isSupContract(c)) {
      supExt = supervisionExtension(
        {
          id: c.id,
          supStartDate: c.supStartDate,
          supMonths: c.supMonths,
          supMonthly: Number(c.supMonthly),
          supDiscount: Number(c.supDiscount),
          supWaivedMonths: Number(c.supWaivedMonths),
        },
        actualSupervisionEnd(stagesByContract.get(c.id) || [])
      );
    }
    const collected = round3(
      c.vouchers.filter((v) => v.vtype === "receipt").reduce((s, v) => s + Number(v.amount), 0)
    );
    const paid = round3(
      c.vouchers.filter((v) => v.vtype === "payment").reduce((s, v) => s + Number(v.amount), 0)
    );
    const subs = round3(c.subContracts.reduce((s, x) => s + Number(x.amount), 0));
    const current = contractCurrentValue(
      Number(c.amount),
      c.addendums.map((a) => ({
        status: a.status,
        amountAdd: Number(a.amountAdd),
        amountDeduct: Number(a.amountDeduct),
      })),
      supExt
    );
    map.set(c.id, { status: c.status, current, collected, paid, subs });
  }
  return map;
}

/** بناء قائمة المجموعات بملخصها المالي (opts.ids ⇒ مجموعة واحدة، customerId ⇒ فلتر العميل) */
export async function buildGroupsResponse(
  opts: { ids?: number[]; customerId?: number } = {}
): Promise<ContractGroupSummary[]> {
  const where = {
    ...(opts.ids ? { id: { in: opts.ids } } : {}),
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
  };
  const groups = await db.contractGroup.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      items: { select: { contractId: true } },
    },
    orderBy: { id: "desc" },
  });
  if (groups.length === 0) return [];

  const allIds = [...new Set(groups.flatMap((g) => g.items.map((i) => i.contractId)))];
  const fin = await loadFinancialRows(allIds);

  return groups.map((g) => {
    const rows: GroupTotalRow[] = [];
    for (const item of g.items) {
      const row = fin.get(item.contractId);
      if (row) rows.push(row);
    }
    return {
      id: g.id,
      groupNumber: g.groupNumber,
      groupName: g.groupName,
      notes: g.notes,
      status: g.status,
      customerId: g.customerId,
      customerName: g.customer.name,
      contractsCount: g.items.length,
      createdBy: g.createdBy,
      createdAt: g.createdAt.toISOString().slice(0, 10),
      totals: computeGroupTotals(rows),
    };
  });
}

export interface GroupContractRow {
  id: number;
  contractNumber: string;
  contractName: string;
  contractType: string;
  status: string;
  amount: number;
  customerName: string;
}

/** عقود المجموعة بترتيب id (group_contracts — رقم/اسم/نوع/حالة/مبلغ/عميل) */
export async function loadGroupContracts(groupId: number): Promise<GroupContractRow[]> {
  const items = await db.contractGroupItem.findMany({
    where: { groupId },
    include: { contract: { include: { customer: { select: { name: true } } } } },
    orderBy: { contractId: "asc" },
  });
  return items.map((i) => ({
    id: i.contract.id,
    contractNumber: i.contract.contractNumber,
    contractName: i.contract.contractName,
    contractType: i.contract.contractType,
    status: i.contract.status,
    amount: Number(i.contract.amount),
    customerName: i.contract.customer.name,
  }));
}
