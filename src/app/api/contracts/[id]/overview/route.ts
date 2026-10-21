import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";
import { computeSubPlan } from "@/lib/voucher-server";
import { getContractMode } from "@/lib/contract-components-server";

type P = { params: Promise<{ id: string }> };

/**
 * لوحة «نظرة عامة» للعقد — المرجع المكتبي: lifecycle_service.contract_dashboard (4891)
 * + extras_service.contract_settlement (295) + contract_sub_dues (354).
 * كل الأرصدة لحظية عبر loadContractCore (نفس محرك مركز العقد والتقارير — بلا تخزين).
 */

/** contract_timeline (lifecycle_service:382) حرفيًا */
function contractTimeline(startDate: string, endDate: string) {
  const out = { duration: 0, elapsed: 0, remaining: 0, percent: 0, timeStatus: "غير محدد" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return out;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return out;
  const today = new Date();
  const day = (d: Date) => Math.floor(d.getTime() / 86400000);
  const duration = day(end) - day(start) + 1;
  if (duration <= 0) return out;
  const elapsed = today >= start ? Math.max(0, Math.min(duration, day(today) - day(start) + 1)) : 0;
  const remaining = Math.max(0, day(end) - day(today));
  const percent = today >= start ? Math.round(Math.min(100, Math.max(0, (elapsed / duration) * 100)) * 10) / 10 : 0;
  if (today < start) return { duration, elapsed: 0, remaining, percent: 0, timeStatus: "لم يبدأ بعد" };
  if (today > end) return { duration, elapsed, remaining: 0, percent: 100, timeStatus: "منتهي المدة" };
  return { duration, elapsed, remaining, percent, timeStatus: "جارٍ" };
}

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);
  const c = core.contract;

  const [payRows, subs] = await Promise.all([
    db.voucher.findMany({
      where: { contractId, vtype: "payment", cancelled: false },
      select: { amount: true, partyType: true },
    }),
    db.subContract.findMany({
      where: { contractId, status: { notIn: ["ملغى", "ملغي"] } },
      select: { id: true, amount: true },
    }),
  ]);

  const payments = r3(payRows.reduce((s, v) => s + Number(v.amount), 0));
  const otherPayments = r3(
    payRows.filter((v) => (v.partyType || "") !== "subcontractor").reduce((s, v) => s + Number(v.amount), 0)
  );
  const subsTotal = r3(subs.reduce((s, x) => s + Number(x.amount), 0));
  const collected = core.collected;
  const current = core.current;

  // الربحية (511–515): الفعلي = المحصّل − المنصرف · المتوقع = القيمة − (الباطن + المنصرف الآخر)
  const profit = r3(collected - payments);
  const expectedProfit = r3(current - (subsTotal + otherPayments));

  // التصفية (contract_settlement)
  const remaining = r3(current - collected);
  const fullyCollected = remaining <= EPS;
  const stages = core.stages.filter((s) => s.level === 1);
  const stageRequired = stages.length > 0;
  const stagesComplete = !stages.some((s) => s.startDate && !s.endDate);
  const closable = fullyCollected && stagesComplete && c.status !== "مغلق" && c.status !== "ملغى";

  // مستحقات الباطن غير المدفوعة (contract_sub_dues) — تحذير غير مانع
  let subDuesCount = 0;
  let subDuesUnpaid = 0;
  for (const s of subs) {
    const plan = await computeSubPlan(s.id);
    if (!plan) continue;
    for (const l of plan.lines) {
      if ((l.triggeredAt || "").trim() && l.remaining > EPS) {
        subDuesCount += 1;
        subDuesUnpaid = r3(subDuesUnpaid + l.remaining);
      }
    }
  }

  // مسار المراحل (_contract_stage_status): الجارية = بدأت ولم تُنهَ (level=1)
  const today = new Date();
  const todayStrLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const day = (d: Date) => Math.floor(d.getTime() / 86400000);
  type PathItem = { id: number; name: string; state: "done" | "skip" | "current" | "future"; days: number; expectedDays: number; isSkipped: boolean };
  const path: PathItem[] = [];
  let currentStage: { id: number; name: string; daysIn: number; expectedDays: number } | null = null;
  for (const s of stages) {
    let state: PathItem["state"] = "future";
    let days = 0;
    if (s.startDate && !s.endDate) {
      state = "current";
      days = Math.max(0, day(new Date(`${todayStrLocal}T00:00:00`)) - day(new Date(`${s.startDate}T00:00:00`)));
      currentStage = { id: s.id, name: s.name, daysIn: days, expectedDays: Number(s.expectedDays) || 0 };
    } else if (s.startDate && s.endDate) {
      state = s.isSkipped ? "skip" : "done";
    }
    path.push({ id: s.id, name: s.name, state, days, expectedDays: Number(s.expectedDays) || 0, isSkipped: s.isSkipped });
  }
  let stageState: "ok" | "near" | "over" | "none" | "done" = "done";
  const curStage = currentStage as { id: number; name: string; daysIn: number; expectedDays: number } | null;
  if (curStage) {
    const expected = curStage.expectedDays;
    const daysIn = curStage.daysIn;
    if (expected && daysIn > expected) stageState = "over";
    else if (expected && daysIn >= expected - 3) stageState = "near";
    else stageState = "ok";
  } else if (path.length === 0) stageState = "none";

  const manualDone = path.filter((p) => p.state === "done" || p.state === "skip").length;
  const manualTotal = path.length;
  const manualPct = manualTotal ? Math.round((manualDone * 100) / manualTotal) : 0;

  const timeline = contractTimeline(c.startDate || "", c.endDate || "");

  // G6 — نمط تسعير هذا العقد تحديدًا (الترتيب الخمسي — لا نمط النوع وحده)
  const pricing = await getContractMode(contractId);

  return ok({
    contract: { id: c.id, contractNumber: c.contractNumber, status: c.status, currency: c.currency },
    pricingMode: pricing.mode,
    // المبالغ (dash)
    originalValue: r3(Number(c.amount)),
    addendumsNet: r3(
      core.addendums.filter((a) => a.status === "معتمد").reduce((s, a) => s + Number(a.amountAdd) - Number(a.amountDeduct), 0)
    ),
    supExtension: r3(core.supExt),
    currentValue: current,
    totalReceipts: collected,
    totalPayments: payments,
    otherPayments,
    totalSubs: subsTotal,
    profit,
    expectedProfit,
    remaining,
    // الزمن
    timeline,
    // التصفية والتنبيهات
    settlement: { fullyCollected, stageRequired, stagesComplete, closable, remaining },
    subDues: { count: subDuesCount, unpaid: subDuesUnpaid },
    // المسار
    manualPath: c.manualPath,
    stagePath: { current: currentStage, state: stageState, path, manualDone, manualTotal, manualPct },
  });
}
