import { computeContractPaymentPlan, type ReceiptLike, type PlanLine, type ComputedPlanLine } from "@/lib/contrack-core";
import { smartReceiptDescription, smartReceiptStageNote, describeForLinks, contractDisplayName } from "@/lib/voucher-describe";

const stageRows = [{ id: 11, name: "حفر وأساسات" }, { id: 12, name: "هيكل خرساني" }];
const fakeDb = {
  contractStage: { findMany: async () => stageRows },
  addendum: { findMany: async () => [] },
  voucher: { groupBy: async () => [] },
  voucherPaymentLink: { findMany: async () => [] },
  setting: { findUnique: async () => null },
} as never;

const plan: PlanLine[] = [
  { id: 1, title: "دفعة 1", dueDate: "2026-01-01", amount: 5000, sortOrder: 1, stageId: 11, triggeredAt: "2026-01-01", notes: "", stage: null },
  { id: 2, title: "دفعة 2", dueDate: "2026-03-01", amount: 10000, sortOrder: 2, stageId: 12, triggeredAt: "2026-03-01", notes: "", stage: null },
  { id: 3, title: "دفعة 3", dueDate: "2026-06-01", amount: 10000, sortOrder: 3, stageId: null, triggeredAt: "", notes: "", stage: null },
];
// محصل سابق 2,000 (جزء من الدفعة 1 بسند سابق واحد)
const receipts: ReceiptLike[] = [{ id: 9, voucherNumber: "RV-0001", vdate: "2026-01-05", amount: 2000, allocation: "", advanceAmount: 0, cancelled: false }];
const computed = computeContractPaymentPlan(plan, receipts, []);

const mkCore = (lines: ComputedPlanLine[]) => ({
  contract: { id: 1, contractName: "أعمال بناء مجمع سكني", description: "", contractNumber: "CON-0012", supStartDate: "", supMonths: 0, supMonthly: 0, supDiscount: 0, supWaivedMonths: 0 },
  receipts, computed, current: 25000, sup: null,
} as never);

(async () => {
  console.log("=== حالات سند قبض (خطة 3 دفعات: 5k/10k/10k، محصل سابق 2k) ===");
  for (const amt of [3000, 5000, 13000, 17500, 600]) {
    const core = mkCore(computed.lines);
    console.log(`\n— قبض ${amt}:`);
    console.log("  ", await smartReceiptDescription(fakeDb, core, amt));
    console.log("  ملاحظة:", await smartReceiptStageNote(fakeDb, core, amt) || "(فارغة)");
  }

  console.log("\n=== روابط صريحة (صرف باطن على خط الدفعة 2) ===");
  const d1 = await describeForLinks(fakeDb, 4000, [{ lineId: 2, amount: 4000 }], computed.lines, new Set(), "payment", contractDisplayName({ contractName: "أعمال بناء مجمع سكني", description: "", contractNumber: "CON-0012" }), new Map(stageRows.map(s => [s.id, s.name])));
  console.log("صرف 4k على الدفعة 2:", d1.text, "| مراحل:", d1.stages);

  const d2 = await describeForLinks(fakeDb, 2500, [], computed.lines, new Set(), "receipt", "أعمال بناء مجمع سكني", new Map(stageRows.map(s => [s.id, s.name])));
  console.log("قبض 2.5k بدون تحديد (توزيع آلي):", d2.text);
})();

// === عقد إشراف: 12 شهر × 500 = 6000، محصل 0 ===
(async () => {
  const { supervisionStatus, isSupervision } = await import("@/lib/contrack-core");
  const supC = { id: 2, supStartDate: "2026-01-01", supMonths: 12, supMonthly: 500, supDiscount: 0, supWaivedMonths: 0 };
  const receipts2: ReceiptLike[] = [];
  const sup = supervisionStatus(supC, receipts2, "");
  const coreSup = { contract: { id: 2, contractName: "إشراف على مبنى إداري", description: "", contractNumber: "SUP-0001", supStartDate: "2026-01-01", supMonths: 12, supMonthly: 500, supDiscount: 0, supWaivedMonths: 0 }, receipts: receipts2, computed: { lines: [], collected: 0 }, current: sup.totalDue, sup } as never;
  console.log("\n=== عقد إشراف (12 شهر × 500) ===");
  for (const amt of [1500, 500, 300, 6200]) {
    console.log(`قبض ${amt}:`, await smartReceiptDescription(fakeDb, coreSup, amt));
  }
})();
