import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";

/**
 * تقرير سلف الموظفين المجمّع — GET /api/employees/advances/summary?from=&to=
 * المرجع المكتبي: lifecycle_service.employee_balances + report_service._advance_settlement.
 *
 * قواعد المكتبي الملزمة:
 * • FIFO لكل موظف: الرد النقدي وخصم الراتب يُطفئان أقدم سلفة أولًا.
 * • الحالة تُقيَّم عند تاريخ نهاية التقرير (to) — بلا تخزين أرصدة، حساب لحظي من الحركات.
 * • السلفة المُسترَدة لا تُحسب مصروفًا؛ المرتجع يخفض الرصيد ويبقى المصدر منقوصًا.
 * • سطر تحذير للسلف المرتجعة بالمبالغ.
 */

/** عتبة الإطفاء كما في المكتبي (نصف عتبة 0.001 للتقريب) */
const FIFO_EPS = 0.0005;

interface AdvanceRow {
  voucherId: number;
  voucherNumber: string;
  vdate: string;
  employeeId: number;
  amount: number;
}

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));
  const end = to || "9999-12-31";

  // ===== 1) حالة FIFO حتى نهاية الفترة (كل التاريخ حتى to) =====
  const [advVouchers, retVouchers] = await Promise.all([
    db.voucher.findMany({
      where: { cancelled: false, vtype: "payment", advanceEmployeeId: { not: null }, vdate: { lte: end } },
      select: { id: true, voucherNumber: true, vdate: true, amount: true, advanceEmployeeId: true },
    }),
    db.voucher.findMany({
      where: {
        cancelled: false,
        vtype: { in: ["custody_return", "salary_deduction"] },
        advanceEmployeeId: { not: null },
        vdate: { lte: end },
      },
      select: { id: true, voucherNumber: true, vdate: true, amount: true, advanceEmployeeId: true },
    }),
  ]);

  // أحداث مرتبة (vdate, kind [0 سلفة / 1 رد], id) كما في _advance_settlement
  const employeesById = await db.employee.findMany({ select: { id: true, name: true } });
  const empName = new Map<number, string>(employeesById.map((e) => [e.id, e.name]));

  type Ev = { d: string; kind: 0 | 1; id: number; row: AdvanceRow };
  const events: Ev[] = [
    ...advVouchers.map((v) => ({
      d: v.vdate || "",
      kind: 0 as const,
      id: v.id,
      row: {
        voucherId: v.id,
        voucherNumber: v.voucherNumber,
        vdate: v.vdate,
        employeeId: v.advanceEmployeeId as number,
        amount: Number(v.amount),
      },
    })),
    ...retVouchers.map((v) => ({
      d: v.vdate || "",
      kind: 1 as const,
      id: v.id,
      row: {
        voucherId: v.id,
        voucherNumber: v.voucherNumber,
        vdate: v.vdate,
        employeeId: v.advanceEmployeeId as number,
        amount: Number(v.amount),
      },
    })),
  ];
  events.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.kind - b.kind || a.id - b.id));

  const queues = new Map<number, { voucherId: number; remaining: number; row: AdvanceRow }[]>();
  const settled = new Map<number, number>();
  for (const ev of events) {
    const emp = ev.row.employeeId;
    if (ev.kind === 0) {
      const q = queues.get(emp) || [];
      q.push({ voucherId: ev.row.voucherId, remaining: ev.row.amount, row: ev.row });
      queues.set(emp, q);
      settled.set(ev.row.voucherId, 0);
      continue;
    }
    let left = ev.row.amount;
    const q = queues.get(emp) || [];
    while (left > FIFO_EPS && q.length > 0) {
      const head = q[0];
      const take = Math.min(left, head.remaining);
      head.remaining = r3(head.remaining - take);
      left = r3(left - take);
      settled.set(head.voucherId, r3((settled.get(head.voucherId) || 0) + take));
      if (head.remaining <= FIFO_EPS) q.shift();
    }
  }

  // السلف القائمة والمرتجعة عند نهاية الفترة — من كل السلف (حتى المسددة بالكامل)
  const outstanding: {
    voucherId: number;
    voucherNumber: string;
    vdate: string;
    employeeId: number;
    employee: string;
    amount: number;
    settled: number;
    remaining: number;
  }[] = [];
  const returned: typeof outstanding = [];
  const asOfByEmployee = new Map<number, number>();
  for (const adv of advVouchers) {
    const emp = adv.advanceEmployeeId as number;
    const amount = Number(adv.amount);
    const s = settled.get(adv.id) || 0;
    const remaining = r3(amount - s);
    if (remaining > FIFO_EPS) {
      const rec = {
        voucherId: adv.id,
        voucherNumber: adv.voucherNumber,
        vdate: adv.vdate,
        employeeId: emp,
        employee: empName.get(emp) || "",
        amount: r3(amount),
        settled: r3(s),
        remaining,
      };
      outstanding.push(rec);
      if (s > FIFO_EPS) returned.push(rec);
      asOfByEmployee.set(emp, r3((asOfByEmployee.get(emp) || 0) + remaining));
    } else if (s > FIFO_EPS) {
      // سلفة مسددة بالكامل — تُذكر في المرتجعة بالمبالغ ولا تدخل القائمة
      returned.push({
        voucherId: adv.id,
        voucherNumber: adv.voucherNumber,
        vdate: adv.vdate,
        employeeId: emp,
        employee: empName.get(emp) || "",
        amount: r3(amount),
        settled: r3(s),
        remaining: 0,
      });
    }
  }
  outstanding.sort((a, b) => (a.vdate < b.vdate ? -1 : a.vdate > b.vdate ? 1 : a.voucherId - b.voucherId));
  returned.sort((a, b) => (a.vdate < b.vdate ? -1 : a.vdate > b.vdate ? 1 : a.voucherId - b.voucherId));

  // ===== 2) حركات الفترة (من/إلى) لكل موظف — كالمكتبي employee_balances =====
  const periodVouchers = await db.voucher.findMany({
    where: {
      advanceEmployeeId: { not: null },
      cancelled: false,
      ...(from || to ? { vdate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    select: { advanceEmployeeId: true, vtype: true, amount: true },
  });

  const agg = new Map<number, { advanced: number; recovered: number; deducted: number }>();
  for (const v of periodVouchers) {
    const id = v.advanceEmployeeId as number;
    const a = agg.get(id) || { advanced: 0, recovered: 0, deducted: 0 };
    if (v.vtype === "payment") a.advanced = r3(a.advanced + Number(v.amount));
    else if (v.vtype === "custody_return") a.recovered = r3(a.recovered + Number(v.amount));
    else if (v.vtype === "salary_deduction") a.deducted = r3(a.deducted + Number(v.amount));
    agg.set(id, a);
  }

  const ids = [...agg.keys()].sort((a, b) => (empName.get(a) || "").localeCompare(empName.get(b) || "", "ar"));
  const rows = ids.map((id) => {
    const a = agg.get(id)!;
    return {
      employeeId: id,
      employee: empName.get(id) || "",
      advanced: a.advanced,
      recovered: a.recovered,
      deducted: a.deducted,
      balance: r3(a.advanced - a.recovered - a.deducted),
      asOfBalance: asOfByEmployee.get(id) ?? 0,
    };
  });

  const totals = {
    advanced: r3(rows.reduce((s, x) => s + x.advanced, 0)),
    recovered: r3(rows.reduce((s, x) => s + x.recovered, 0)),
    deducted: r3(rows.reduce((s, x) => s + x.deducted, 0)),
    balance: r3(rows.reduce((s, x) => s + x.balance, 0)),
    asOfBalance: r3(rows.reduce((s, x) => s + x.asOfBalance, 0)),
  };

  // ===== 3) سطر التحذير للسلف المرتجعة بالمبالغ =====
  const returnedSum = r3(returned.reduce((s, x) => s + x.settled, 0));
  const f3 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const note = `الإجمالي: مسلّم ${f3(totals.advanced)} · مسترد ${f3(r3(totals.recovered + totals.deducted))} · متبقي ${f3(totals.balance)} د.ك`;
  const warning =
    returned.length > 0
      ? `⚠ سلف مرتجعة (رد نقدي/خصم راتب): ${returned.length} سلفة بمبلغ ${f3(returnedSum)} د.ك — المُسترَد ليس مصروفًا ويخفض رصيد السلفة${to ? ` (الحالة عند ${to})` : ""}`
      : "";

  return ok({
    asOf: to,
    rows,
    totals,
    outstanding,
    returned,
    note,
    warning,
  });
}
