/**
 * G1 — النواة النقية لكشف الرصيد الجاري اليومي للشركة الأخرى
 * (المكتبي settlement_service.other_running_statement 2245–2308 حرفيًا)
 * ملف بلا "server-only" كي تُختبر النواة النقية مباشرة في bun test.
 * الاستعلامات المعتمدة على القاعدة تعيش في gateway-server.ts (otherRunningStatement).
 */

import { r3 } from "./contrack-core";

/** صف عملية مختصر — إدخال netInByDay */
export interface RunningOpRow {
  opDate: string;
  gateway: string;
  amount: number;
}

/**
 * داخل الأخرى بالصافي لكل يوم (كل البوابات معًا) — المكتبي _other_in_by_day.
 * لكل عملية: المبلغ − عمولة بوابتها الثابتة، تُجمع على يوم العملية.
 * **بلا تجاوز الأيام التي يكون صافيها ≤ 0** — فلا يضيع أي يوم (مطابق للمكتبي).
 * (صفوف غير المؤهَّلة تُستبعد قبل هنا عبر DUES_ELIGIBLE في الاستعلام)
 */
export function netInByDay(ops: RunningOpRow[], fees: Map<string, number>): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const o of ops) {
    const net = r3(Number(o.amount || 0) - (fees.get(o.gateway || "") || 0));
    byDay.set(o.opDate, r3((byDay.get(o.opDate) ?? 0) + net));
  }
  return byDay;
}

/** خريطة أيام → مجموع (من صفوف مسبقة الجمع) — مساعد للاختبارات والبناء */
export function sumByDay(rows: { day: string; amount: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.day, r3((m.get(r.day) ?? 0) + Number(r.amount || 0)));
  return m;
}

export interface RunningStatementCore {
  openingAmount: number;
  /** أول يوم في الفترة المعروضة — السابق = كل ما قبلها */
  d1: string;
  inByDay: Map<string, number>;
  outByDay: Map<string, number>;
}

export interface RunningStatementResult {
  prior: number;
  days: { day: string; in: number; out: number; balance: number }[];
  totalIn: number;
  totalOut: number;
  end: number;
}

/**
 * النواة الحسابية النقية للكشف الجاري:
 * السابق B0 = الافتتاحي + داخل قبل الفترة − دفعنا قبل الفترة،
 * ثم لكل يوم (اتحاد أيام الدخل والخروج مرتبًا): الجاري = السابق + داخل − خارج.
 */
export function computeRunningStatement({ openingAmount, d1, inByDay, outByDay }: RunningStatementCore): RunningStatementResult {
  let preIn = 0;
  let preOut = 0;
  for (const [day, v] of inByDay) if (day < d1) preIn = r3(preIn + v);
  for (const [day, v] of outByDay) if (day < d1) preOut = r3(preOut + v);
  const prior = r3(Number(openingAmount || 0) + preIn - preOut);

  const allDays = [...new Set([...inByDay.keys(), ...outByDay.keys()])].filter((d) => d >= d1).sort();
  const days: RunningStatementResult["days"] = [];
  let run = prior;
  for (const day of allDays) {
    const i = r3(inByDay.get(day) ?? 0);
    const o = r3(outByDay.get(day) ?? 0);
    run = r3(run + i - o);
    days.push({ day, in: i, out: o, balance: run });
  }
  return {
    prior,
    days,
    totalIn: r3(days.reduce((a, d) => a + d.in, 0)),
    totalOut: r3(days.reduce((a, d) => a + d.out, 0)),
    end: run,
  };
}
