import { NextRequest } from "next/server";

import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { db } from "@/lib/db";
import {
  WIP_CONTROL_CODE,
  buildSubsidiarySpecs,
  deriveSubsidiaryRow,
} from "@/lib/subsidiary-core";
import {
  ensureContractSubsidiaries,
  ensureWipControl,
} from "@/lib/subsidiary-server";

/**
 * الذمم الفرعية الآلية لكل عقد + WIP — البند الثالث NOVA.
 * docs/subsidiary-wip-design.md
 * GET: صف لكل عقد — كودا الحسابين الحتميان + رصيد كل فرعي من الأستاذ
 *      (افتتاحي + مدين − دائن) + المفوتر/المحصّل من الفواتير + المستحق المشتق (G9).
 * POST: ترحيل/ضمان حسابات كل العقود (backfill) — إنشاء الحسابين الناقصين فقط.
 */

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const contracts = await db.contract.findMany({
    orderBy: [{ id: "desc" }],
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      status: true,
      amount: true,
      customer: { select: { name: true } },
    },
  });

  const specsByContract = contracts.map((c) => ({
    contract: c,
    specs: buildSubsidiarySpecs(c),
  }));
  const allCodes = [...new Set(specsByContract.flatMap((r) => r.specs.map((s) => s.code)))];

  const accounts = allCodes.length
    ? await db.account.findMany({
        where: { code: { in: allCodes } },
        select: { id: true, code: true, name: true, isActive: true, openingBalance: true },
      })
    : [];
  const subIds = accounts.map((a) => a.id);
  const balAgg = subIds.length
    ? await db.journalLine.groupBy({
        by: ["accountId"],
        where: { entry: { status: "posted" }, accountId: { in: subIds } },
        _sum: { debit: true, credit: true },
      })
    : [];
  const invRows = contracts.length
    ? await db.invoice.findMany({
        where: { contractId: { in: contracts.map((c) => c.id) }, status: { not: "void" } },
        select: { contractId: true, total: true, paidAmount: true },
      })
    : [];
  // تجميع محلي (G9 — مشتق لا مخزّن): المفوتر/المحصّل لكل عقد من فواتيره غير الملغاة
  const invBy = new Map<number, { billed: number; settled: number }>();
  for (const r of invRows) {
    if (r.contractId == null) continue;
    const cur = invBy.get(r.contractId) ?? { billed: 0, settled: 0 };
    cur.billed += Number(r.total);
    cur.settled += Number(r.paidAmount);
    invBy.set(r.contractId, cur);
  }

  const accByCode = new Map(accounts.map((a) => [a.code, a]));
  const balBy = new Map(balAgg.map((b) => [b.accountId, b._sum]));

  const rows = specsByContract.map(({ contract: c, specs }) => {
    const arSpec = specs.find((s) => s.kind === "ar")!;
    const wipSpec = specs.find((s) => s.kind === "wip")!;
    const arAcc = accByCode.get(arSpec.code);
    const wipAcc = accByCode.get(wipSpec.code);
    const balOf = (accId: number | undefined, opening: number | undefined): number | null => {
      if (accId === undefined) return null;
      const s = balBy.get(accId);
      const dr = Number(s?.debit ?? 0);
      const cr = Number(s?.credit ?? 0);
      return (Number(opening) || 0) + dr - cr;
    };
    const inv = invBy.get(c.id);
    const row = deriveSubsidiaryRow({
      arBalance: balOf(arAcc?.id, arAcc ? Number(arAcc.openingBalance) : undefined),
      wipBalance: balOf(wipAcc?.id, wipAcc ? Number(wipAcc.openingBalance) : undefined),
      billed: inv?.billed ?? 0,
      settled: inv?.settled ?? 0,
    });
    return {
      contractId: c.id,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      customerName: c.customer?.name || "",
      status: c.status,
      amount: Number(c.amount),
      ar: { code: arSpec.code, name: arSpec.name, exists: arAcc !== undefined, active: arAcc?.isActive ?? false, balance: row.arBalance },
      wip: { code: wipSpec.code, name: wipSpec.name, exists: wipAcc !== undefined, active: wipAcc?.isActive ?? false, balance: row.wipBalance },
      billed: row.billed,
      settled: row.settled,
      outstanding: row.outstanding,
      provisioned: row.provisioned,
    };
  });

  return ok({ rows, wipControlCode: WIP_CONTROL_CODE });
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  // ضمان حساب التحكم 1125 أولًا (شركة قائمة بُذرت قبل إضافة 1125 للبذرة)
  let wipControlCreated = false;
  const wipBefore = await db.account.findFirst({ where: { code: WIP_CONTROL_CODE }, select: { id: true } });
  if (!wipBefore) {
    const created = await ensureWipControl(db);
    wipControlCreated = created !== null;
    if (!created) {
      return jsonError("حساب التحكم 1120 غير موجود — بذِر الدليل القياسي أولًا ثم أعد المحاولة.", 409);
    }
  }

  const contracts = await db.contract.findMany({
    select: { id: true, contractName: true, contractNumber: true },
  });

  const result = await db.$transaction(
    async (tx) => {
      let accountsCreated = 0;
      for (const c of contracts) {
        const before = await tx.account.findMany({
          where: { code: { in: buildSubsidiarySpecs(c).map((s) => s.code) } },
          select: { id: true },
        });
        const res = await ensureContractSubsidiaries(tx, c);
        if (res.arId !== null && res.wipId !== null) accountsCreated += 2 - before.length;
      }
      await audit(tx, {
        username: guard.user.username,
        action: "ضمان الحسابات الفرعية للعقود",
        entityType: "account",
        entityName: `backfill ${contracts.length} عقدًا`,
        newStatus: `أُنشئ ${accountsCreated}`,
      });
      return { contracts: contracts.length, accountsCreated, wipControlCreated };
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  return ok(result);
}
