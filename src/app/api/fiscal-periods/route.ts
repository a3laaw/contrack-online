import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, authGuard, jsonError, ok } from "@/lib/api-utils";
import { computeYearPnl, toggleFiscalPeriod, TX_OPTS } from "@/lib/fiscal-close-server";
import { ensureFiscalYear } from "@/lib/journal-server";

/**
 * الفترات المالية والإقفال — Task 109 (توسيع مسار Task 104 القرائي).
 * GET: سنوات وفترات الشركة (تُبذر المفقودة) + عدد القيود المنشورة لكل فترة
 *      + سجل الإقفال السنوي + نتيجة كل سنة من الأستاذ (إيرادات/مصروفات/صافي).
 * POST: تبديل حالة فترة شهرية (فتح/قفل) — للمدير فقط مع سبب موثق عند الفتح.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_fiscal_close");
  if ("response" in guard) return guard.response;

  // بذر السنوات المفقودة: من أقدم سنة قيود حتى السنة القادمة
  const currentYear = new Date().getFullYear();
  const [minEntry, maxEntry] = await Promise.all([
    db.journalEntry.aggregate({ _min: { entryDate: true } }),
    db.journalEntry.aggregate({ _max: { entryDate: true } }),
  ]);
  const years = new Set<number>([currentYear, currentYear + 1]);
  const parseYear = (d: string | null) => {
    const y = Number(String(d || "").slice(0, 4));
    if (y >= 2015 && y <= currentYear + 2) years.add(y);
  };
  parseYear(minEntry._min.entryDate);
  parseYear(maxEntry._max.entryDate);

  const existing = await db.fiscalYear.findMany({ select: { year: true } });
  const existingYears = new Set(existing.map((e) => e.year));
  for (const year of [...years].sort((a, b) => a - b)) {
    if (existingYears.has(year)) continue;
    await ensureFiscalYear(db, year);
  }

  const [rows, closings, postedEntries] = await Promise.all([
    db.fiscalYear.findMany({
      orderBy: { year: "desc" },
      include: { periods: { orderBy: { periodDate: "asc" }, select: { id: true, periodDate: true, status: true } } },
    }),
    db.fiscalClosing.findMany({ orderBy: { year: "desc" } }),
    db.journalEntry.findMany({
      where: { status: "posted" },
      select: { entryDate: true },
    }),
  ]);

  // عدد القيود المنشورة لكل فترة (مفتاح YYYY-MM)
  const entriesByMonth = new Map<string, number>();
  for (const e of postedEntries) {
    const key = String(e.entryDate || "").slice(0, 7);
    entriesByMonth.set(key, (entriesByMonth.get(key) || 0) + 1);
  }

  const minYear = Math.min(...[...years]);
  const closingsByYear = new Map(closings.map((c) => [c.year, c]));

  type YearDtoOut = {
    id: number;
    year: number;
    status: string;
    pnl: { totalRevenue: number; totalExpense: number; net: number };
    closing:
      | {
          id: number;
          status: string;
          closingEntryId: number | null;
          totalRevenue: number;
          totalExpense: number;
          netResult: number;
          linesCount: number;
          notes: string;
          closedBy: string;
          closedAt: string;
          revertReason: string;
        }
      | null;
    periods: { id: number; periodDate: string; status: string; entriesCount: number }[];
  };
  const yearDtos: YearDtoOut[] = [];
  for (const y of rows) {
    const record = closingsByYear.get(y.year);
    const closed = record?.status === "closed";
    // نتيجة السنة من الأستاذ — تُحسب للسنوات غير المقفلة فقط (المقفلة أرقامها في سجلها الموثق)
    const pnl = closed
      ? {
          totalRevenue: Number(record!.totalRevenue),
          totalExpense: Number(record!.totalExpense),
          net: Number(record!.netResult),
        }
      : y.year >= minYear
        ? await computeYearPnl(db, y.year).then((r) => ({
            totalRevenue: r.totalRevenue,
            totalExpense: r.totalExpense,
            net: r.net,
          }))
        : { totalRevenue: 0, totalExpense: 0, net: 0 };

    yearDtos.push({
      id: y.id,
      year: y.year,
      status: y.status,
      pnl,
      closing: record
        ? {
            id: record.id,
            status: record.status,
            closingEntryId: record.closingEntryId,
            totalRevenue: Number(record.totalRevenue),
            totalExpense: Number(record.totalExpense),
            netResult: Number(record.netResult),
            linesCount: record.linesCount,
            notes: record.notes,
            closedBy: record.closedBy,
            closedAt: record.closedAt ? record.closedAt.toISOString() : "",
            revertReason: record.revertReason,
          }
        : null,
      periods: y.periods.map((p) => ({
        id: p.id,
        periodDate: p.periodDate,
        status: p.status,
        entriesCount: entriesByMonth.get(p.periodDate) || 0,
      })),
    });
  }

  return ok({
    years: yearDtos,
    canManage: true, // إدارة الفترات للمدير — الواجهة تخفي الأزرار بلا صلاحية المدير عبر /api/auth/session
    currentYear,
  });
}

/** تبديل فترة شهرية — للمدير فقط */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  let body: { periodId?: unknown; action?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("طلب غير صالح.", 400);
  }
  const periodId = Number(body.periodId) || 0;
  const action = body.action === "open" ? "open" : body.action === "close" ? "close" : null;
  if (!periodId || !action) return jsonError("حدد الفترة والإجراء (open/close).", 400);

  try {
    const result = await db.$transaction(async (tx) => {
      const res = await toggleFiscalPeriod(tx, periodId, action, guard.user.username, String(body.reason || ""));
      return res;
    }, TX_OPTS);
    return ok({ period: result });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر تغيير حالة الفترة.", 400);
  }
}
