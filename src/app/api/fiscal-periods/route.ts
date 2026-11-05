import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, ok } from "@/lib/api-utils";

/**
 * الفترات المالية — قراءة فقط في Task 104 (الفتح/القفل والإقفال السنوي في Task 109).
 * GET: سنوات وفترات الشركة الحالية (تُبذر الفترات المفقودة حتى السنة الحالية+1).
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_journal_entries");
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
    const fy = await db.fiscalYear.create({ data: { year, status: "open" } });
    await db.fiscalPeriod.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        fiscalYearId: fy.id,
        periodDate: `${year}-${String(i + 1).padStart(2, "0")}`,
        status: "open",
      })),
    });
  }

  const rows = await db.fiscalYear.findMany({
    orderBy: { year: "desc" },
    include: { periods: { orderBy: { periodDate: "asc" }, select: { id: true, periodDate: true, status: true } } },
  });

  return ok({
    years: rows.map((y) => ({
      id: y.id,
      year: y.year,
      status: y.status,
      periods: y.periods.map((p) => ({ id: p.id, periodDate: p.periodDate, status: p.status })),
    })),
  });
}
