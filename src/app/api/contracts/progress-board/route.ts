import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authGuard, normalizeArabic, ok, todayStr } from "@/lib/api-utils";

/**
 * لوحة «أين وصلنا» — ربط العقود بمراحل العمل وموقع التقدم في كل عقد (قرار المالك 2026-11):
 * «في الأول نقوم بربط العقود بمراحل العمل اين وصلنا فيها».
 *
 * اشتقاقي بلا جداول جديدة (G9): المسار من ContractStage (المستوى 1) حيًّا — نفس منطق
 * مسار المراحل في لوحة العقد (overview.stagePath) مطبقًا على كل العقود دفعة واحدة،
 * مع تمييز «لم تبدأ بعد» عن «مكتمل» ليصبح التعامل اليومي من اللوحة مباشرة:
 *   بدء المرحلة {startDate: today} / إنهاء {endDate: today} عبر PATCH المرحلة القائم.
 */

const EXCLUDED_DEFAULT = ["مسودة", "ملغى", "مغلق"];

type StageState = "done" | "skip" | "current" | "future";
type BoardState = "over" | "near" | "ok" | "between" | "not_started" | "done" | "none";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const status = (req.nextUrl.searchParams.get("status") || "").trim();

  const where: Prisma.ContractWhereInput = status
    ? { status }
    : { status: { notIn: EXCLUDED_DEFAULT } };

  const contracts = await db.contract.findMany({
    where,
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      contractType: true,
      status: true,
      amount: true,
      currency: true,
      startDate: true,
      endDate: true,
      manualPath: true,
      customerId: true,
      customer: { select: { id: true, name: true } },
      stages: {
        where: { level: 1 },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          isSkipped: true,
          expectedDays: true,
        },
      },
    },
    orderBy: { id: "desc" },
  });

  const today = todayStr();
  const dayOf = (d: string) => Math.floor(new Date(`${d}T00:00:00`).getTime() / 86400000);
  const nq = normalizeArabic(q);

  interface StageRow {
    id: number;
    name: string;
    state: StageState;
    days: number;
    expectedDays: number;
  }
  interface Row {
    id: number;
    contractNumber: string;
    contractName: string;
    customerId: number;
    customerName: string;
    contractType: string;
    status: string;
    amount: number;
    currency: string;
    startDate: string;
    endDate: string;
    manualPath: boolean;
    timelinePct: number;
    timeStatus: string;
    stages: StageRow[];
    current: { id: number; name: string; daysIn: number; expectedDays: number; state: "ok" | "near" | "over" } | null;
    /** أول مرحلة لم تبدأ — هدف زر «بدء المرحلة التالية» */
    next: { id: number; name: string } | null;
    boardState: BoardState;
    doneCount: number;
    totalCount: number;
    pct: number;
  }

  const rows: Row[] = [];
  for (const c of contracts) {
    if (nq) {
      const hay = normalizeArabic(
        `${c.contractNumber} ${c.contractName || ""} ${c.customer.name} ${c.contractType || ""}`
      );
      if (!hay.includes(nq)) continue;
    }

    // الشريط الزمني للعقد (نفس contractTimeline في overview — مضغوطة هنا)
    let timelinePct = 0;
    let timeStatus = "غير محدد";
    if (/^\d{4}-\d{2}-\d{2}$/.test(c.startDate || "") && /^\d{4}-\d{2}-\d{2}$/.test(c.endDate || "")) {
      const dur = dayOf(c.endDate) - dayOf(c.startDate) + 1;
      if (dur > 0) {
        if (today < c.startDate) {
          timelinePct = 0;
          timeStatus = "لم يبدأ بعد";
        } else if (today > c.endDate) {
          timelinePct = 100;
          timeStatus = "منتهي المدة";
        } else {
          const elapsed = dayOf(today) - dayOf(c.startDate) + 1;
          timelinePct = Math.round(Math.min(100, Math.max(0, (elapsed / dur) * 100)) * 10) / 10;
          timeStatus = "جارٍ";
        }
      }
    }

    const stages: StageRow[] = [];
    let current: Row["current"] = null;
    let currentState: "ok" | "near" | "over" = "ok";
    let next: Row["next"] = null;
    let anyStarted = false;
    for (const s of c.stages) {
      let state: StageState = "future";
      let days = 0;
      if (s.startDate && !s.endDate) {
        state = "current";
        anyStarted = true;
        days = Math.max(0, dayOf(today) - dayOf(s.startDate));
        const expected = Number(s.expectedDays) || 0;
        if (expected && days > expected) currentState = "over";
        else if (expected && days >= expected - 3) currentState = "near";
        current = { id: s.id, name: s.name, daysIn: days, expectedDays: expected, state: currentState };
      } else if (s.startDate && s.endDate) {
        state = s.isSkipped ? "skip" : "done";
        anyStarted = true;
      } else if (!next && !s.isSkipped) {
        next = { id: s.id, name: s.name };
      }
      stages.push({
        id: s.id,
        name: s.name,
        state,
        days,
        expectedDays: Number(s.expectedDays) || 0,
      });
    }

    const doneCount = stages.filter((s) => s.state === "done" || s.state === "skip").length;
    const totalCount = stages.length;
    const pct = totalCount ? Math.round((doneCount * 100) / totalCount) : 0;
    // بين المراحل: انتهت الجارية ولم تبدأ التالية — «بانتظار بدء المرحلة التالية»
    const boardState: BoardState = current
      ? currentState
      : totalCount === 0
        ? "none"
        : !anyStarted
          ? "not_started"
          : next
            ? "between"
            : "done";

    rows.push({
      id: c.id,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      customerId: c.customerId,
      customerName: c.customer.name,
      contractType: c.contractType,
      status: c.status,
      amount: Number(c.amount),
      currency: c.currency,
      startDate: c.startDate,
      endDate: c.endDate,
      manualPath: c.manualPath,
      timelinePct,
      timeStatus,
      stages,
      current,
      next,
      boardState,
      doneCount,
      totalCount,
      pct,
    });
  }

  // ترتيب عين المدير: المتأخرة أولًا (الأكثر تجاوزًا) ثم القاربة ثم الجارية
  // ثم غير المبدوءة ثم المكتملة ثم بلا مراحل — وداخل الفئة الأحدث أعلى.
  const RANK: Record<BoardState, number> = {
    over: 0, near: 1, ok: 2, between: 3, not_started: 4, done: 5, none: 6,
  };
  rows.sort((a, b) => {
    const ra = RANK[a.boardState];
    const rb = RANK[b.boardState];
    if (ra !== rb) return ra - rb;
    if (a.boardState === "over") {
      const oa = (a.current?.daysIn ?? 0) - (a.current?.expectedDays ?? 0);
      const ob = (b.current?.daysIn ?? 0) - (b.current?.expectedDays ?? 0);
      return ob - oa; // الأكثر تجاوزًا أولًا
    }
    return b.id - a.id; // الأحدث أعلى
  });

  const sum = {
    total: rows.length,
    over: rows.filter((r) => r.boardState === "over").length,
    near: rows.filter((r) => r.boardState === "near").length,
    active: rows.filter((r) => r.boardState === "ok").length,
    notStarted: rows.filter((r) => r.boardState === "not_started").length,
    between: rows.filter((r) => r.boardState === "between").length,
    completed: rows.filter((r) => r.boardState === "done").length,
    noStages: rows.filter((r) => r.boardState === "none").length,
  };
  const withStages = rows.filter((r) => r.totalCount > 0);
  const avgPct = withStages.length
    ? Math.round(withStages.reduce((s, r) => s + r.pct, 0) / withStages.length)
    : 0;

  return ok({ contracts: rows, summary: { ...sum, avgPct } });
}
