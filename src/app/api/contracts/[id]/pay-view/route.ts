import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { loadContractCore, loadSubContractItemsMany } from "@/lib/contrack-server";
import { computeSubPlan } from "@/lib/voucher-server";
import { computeNetDue, subCertKpis } from "@/lib/phase-a-core";

type P = { params: Promise<{ id: string }> };

/**
 * بيانات صفحة «الدفعات والمقاولون» — المرجع المكتبي:
 * lifecycle_service.contract_payment_compare (1570) + workflow_service.manual_path_groups (1876)
 * + ui/contract_hub.py::_pay_fill (كتلة لكل مقاول بسطور خطته وتقدمه).
 * كتلة لكل مقاول: خطوط خطته (محسوبة بcomputeSubPlan) + عدد بنوده + من يربط أي دفعة عميل.
 */

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);

  // ① مسار العقد: يدوي ⇒ «المنجز من الإجمالي» · إجباري ⇒ المرحلة الحالية
  // (المكتبي counts closed فقط؛ الويب يوسم التخطي بلا تاريخ نهائي — فالتخطى يُعد منجزًا للمسار)
  const stages = core.stages.filter((s) => s.level === 1);
  let currentStageName = "";
  for (const s of stages) {
    if (s.startDate && !s.endDate) {
      currentStageName = s.name;
      break;
    }
  }
  const manualDone = stages.filter((s) => s.endDate || s.isSkipped).length;
  const manualTotal = stages.length;
  const manualPct = manualTotal ? Math.round((manualDone * 100) / manualTotal) : 0;

  // ② كتلة العميل: مستحق = المبالغ المحركة فعليًا (triggered) · مسدَّد = التغطية
  const clientLines = core.computed.lines.map((l) => ({
    id: l.id,
    title: l.title,
    dueDate: l.dueDate,
    amountN: l.amountN,
    covered: l.covered,
    remaining: l.remaining,
    state: l.state,
    stateLabel: l.stateLabel,
    triggeredAt: l.triggeredAt,
    notes: l.notes,
    sortOrder: l.sortOrder,
    stageId: l.stageId,
  }));
  const clientDue = r3(clientLines.filter((l) => (l.triggeredAt || "").trim()).reduce((s, l) => s + l.amountN, 0));
  const clientCollected = r3(clientLines.reduce((s, l) => s + l.covered, 0));

  // ③ كتلة لكل مقاول باطن + من يربط أي دفعة عميل
  const subs = await db.subContract.findMany({
    where: { contractId },
    include: { subcontractor: { select: { id: true, name: true, subCode: true } } },
    orderBy: { id: "asc" },
  });
  const usedClientIds = new Set<number>();
  let subsDue = 0;
  let subsPaid = 0;
  let subsWaiting = 0;
  type Block = {
    id: number;
    subcontractorId: number;
    name: string;
    subCode: string;
    amount: number;
    status: string;
    items: { id: number; boqItemId: number | null; description: string; unit: string; qty: number; unitPrice: number; amount: number }[];
    due: number;
    paid: number;
    remaining: number;
    waiting: number;
    plan: { lines: Record<string, unknown>[]; paid: number; planTotal: number; gateEnabled: boolean } | null;
    subCertKpis: ReturnType<typeof subCertKpis>;
  };
  const blocks: Block[] = [];
  const itemsBySub = await loadSubContractItemsMany(subs.map((s) => s.id));
  // ذاكرة نواة العقد للطلب كله — كتل N مقاولين على نفس العقد تشارك تحميلًا واحدًا (Task 63)
  const coreCache = new Map<number, NonNullable<Awaited<ReturnType<typeof loadContractCore>>>>();
  coreCache.set(contractId, core);

  // المرحلة (أ) — مؤشرات مستخلصات الباطن لكل مقاول (تُحسب قبل الحلقة وتُرفق بكل كتلة)
  const subCertRows = await db.subCertificate.findMany({
    where: { subContract: { contractId } },
    select: {
      id: true,
      subContractId: true,
      certNumber: true,
      certDate: true,
      grossAmount: true,
      retentionAmount: true,
      advanceRecovery: true,
      otherDeductions: true,
      netAmount: true,
      cumulativeAmount: true,
      status: true,
      paidVoucherId: true,
    },
    orderBy: [{ subContractId: "asc" }, { certNo: "desc" }],
    take: 500,
  });
  const kpisForSub = (subId: number) =>
    subCertKpis(
      subCertRows
        .filter((c) => c.subContractId === subId)
        .map((c) => ({
          status: c.status,
          netAmount: Number(c.netAmount),
          retentionAmount: Number(c.retentionAmount),
          advanceRecovery: Number(c.advanceRecovery),
        }))
    );

  for (const s of subs) {
    const plan = await computeSubPlan(s.id, { coreCache });
    const items = itemsBySub.get(s.id) ?? [];
    const lines = plan
      ? plan.lines.map((l) => ({
          id: l.id,
          title: l.title,
          dueDate: l.dueDate,
          amountN: l.amountN,
          covered: l.covered,
          remaining: l.remaining,
          state: l.state,
          stateLabel: l.stateLabel,
          gated: l.gated,
          triggeredAt: l.triggeredAt,
          sourceIds: l.sourceIds,
        }))
      : [];
    for (const l of lines) for (const src of l.sourceIds) usedClientIds.add(src);
    const due = r3(lines.filter((l) => (l.triggeredAt || "").trim()).reduce((s, l) => s + l.amountN, 0));
    const paid = plan ? plan.paid : 0;
    const waiting = plan && plan.gateEnabled
      ? r3(lines.filter((l) => l.gated && l.remaining > EPS).reduce((s, l) => s + l.amountN, 0))
      : 0;
    subsDue = r3(subsDue + due);
    subsPaid = r3(subsPaid + paid);
    subsWaiting = r3(subsWaiting + waiting);
    blocks.push({
      id: s.id,
      subcontractorId: s.subcontractor.id,
      name: s.subcontractor.name,
      subCode: s.subcontractor.subCode,
      amount: r3(Number(s.amount)),
      status: s.status,
      items,
      due,
      paid,
      remaining: r3(due - paid),
      waiting,
      plan: plan
        ? { lines, paid: plan.paid, planTotal: plan.planTotal, gateEnabled: plan.gateEnabled }
        : null,
      subCertKpis: kpisForSub(s.id),
    });
  }
  const freeClientIds = clientLines.map((l) => l.id).filter((id) => !usedClientIds.has(id));

  // ④ المرحلة (أ) — المحتجزات والدفعة المقدمة ومستخلصات الباطن (docs/retention-subipc-advance-design.md §5.3)
  const retentionInvoices = await db.invoice.findMany({
    where: { contractId, status: { not: "void" }, retentionAmount: { gt: 0 } },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      total: true,
      retentionAmount: true,
      retentionReleased: true,
      retentionReleasedAt: true,
      advanceRecovered: true,
      paidAmount: true,
      customer: { select: { name: true } },
    },
    orderBy: { invoiceNo: "asc" },
  });
  const retentionTotal = r3(retentionInvoices.reduce((s, i) => s + Number(i.retentionAmount), 0));
  const retentionReleasedSum = r3(
    retentionInvoices.filter((i) => i.retentionReleased).reduce((s, i) => s + Number(i.retentionAmount), 0)
  );
  const invoiceRows = await db.invoice.findMany({
    where: { contractId, status: { not: "void" } },
    select: { total: true, retentionAmount: true, advanceRecovered: true },
  });
  const advanceRecoveredTotal = r3(invoiceRows.reduce((s, i) => s + Number(i.advanceRecovered), 0));
  const advance = {
    amount: r3(Number(core.contract.advanceAmount)),
    recoveryPct: r3(Number(core.contract.advanceRecoveryPct)),
    recovered: advanceRecoveredTotal,
    remaining: r3(Math.max(0, Number(core.contract.advanceAmount) - advanceRecoveredTotal)),
  };

  // مؤشرات عامة لمستخلصات الباطن (القائمة الكاملة للعرض)
  const overallKpis = subCertKpis(
    subCertRows.map((c) => ({
      status: c.status,
      netAmount: Number(c.netAmount),
      retentionAmount: Number(c.retentionAmount),
      advanceRecovery: Number(c.advanceRecovery),
    }))
  );
  const phaseA = {
    retention: {
      total: retentionTotal,
      released: retentionReleasedSum,
      pending: r3(retentionTotal - retentionReleasedSum),
      invoices: retentionInvoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate,
        customerName: i.customer.name,
        total: r3(Number(i.total)),
        netDue: computeNetDue(Number(i.total), Number(i.retentionAmount), Number(i.advanceRecovered)),
        paidAmount: r3(Number(i.paidAmount)),
        retentionAmount: r3(Number(i.retentionAmount)),
        retentionReleased: i.retentionReleased,
        retentionReleasedAt: i.retentionReleasedAt,
      })),
    },
    advance,
    subCerts: {
      overall: overallKpis,
      list: subCertRows.slice(0, 100).map((c) => ({
        id: c.id,
        subContractId: c.subContractId,
        certNumber: c.certNumber,
        certDate: c.certDate,
        grossAmount: r3(Number(c.grossAmount)),
        retentionAmount: r3(Number(c.retentionAmount)),
        advanceRecovery: r3(Number(c.advanceRecovery)),
        otherDeductions: r3(Number(c.otherDeductions)),
        netAmount: r3(Number(c.netAmount)),
        cumulativeAmount: r3(Number(c.cumulativeAmount)),
        status: c.status,
        paidVoucherId: c.paidVoucherId,
      })),
    },
  };

  return ok({
    manualPath: core.contract.manualPath,
    manual: { done: manualDone, total: manualTotal, pct: manualPct },
    currentStageName,
    client: { lines: clientLines, due: clientDue, collected: clientCollected, remaining: r3(clientDue - clientCollected) },
    blocks,
    freeClientIds,
    phaseA,
    totals: {
      clientDue,
      clientCollected,
      clientRemaining: r3(clientDue - clientCollected),
      subsDue,
      subsPaid,
      subsRemaining: r3(subsDue - subsPaid),
      subsWaiting,
    },
  });
}
