import "server-only";
import { db } from "@/lib/db";
import { STATUS_CANCELLED, type ReportTable } from "@/lib/report-server";

/**
 * تقرير الفرص البيعية (rep_leads) — المرجع المكتبي الحرفي:
 *   reports_page._data_prospects + report_service.prospects_report
 *
 * كل عميل مسجل وليس له أي عقد ساري أو سابق (العقود الملغاة لا تُحسب عقودًا).
 * الفترة اختيارية: تحصر النتائج بتاريخ تسجيل العميل (created_at).
 * الترتيب: الأحدث تسجيلًا أولًا — بلا إجماليات (totals: None في المكتبي).
 */
export async function reportLeads({ from = "", to = "" }: { from?: string; to?: string }): Promise<ReportTable> {
  const hasPeriod = !!(from || to);
  const customers = await db.customer.findMany({
    where: {
      contracts: { none: { status: { notIn: [...STATUS_CANCELLED] } } },
      ...(hasPeriod
        ? {
            createdAt: {
              ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { customerCode: true, name: true, phone: true, address: true, notes: true, createdAt: true },
  });

  const now = Date.now();
  const rows: (string | number)[][] = customers.map((c) => {
    const created = c.createdAt ? c.createdAt.getTime() : 0;
    // منذ (يوم) — كما في المكتبي: julianday('now') − julianday(created_at)
    const daysSince = created ? Math.floor((now - created) / 86_400_000) : 0;
    const regDate = c.createdAt ? c.createdAt.toISOString().slice(0, 10) : "";
    return [c.customerCode, c.name, c.phone || "", c.address || "", regDate, String(daysSince), c.notes || ""];
  });

  return {
    title: "تقرير الفرص البيعية",
    heads: ["رقم العميل", "الاسم", "الهاتف", "العنوان", "تاريخ التسجيل", "منذ (يوم)", "ملاحظات"],
    widths: [24, 50, 26, 40, 30, 20, 40],
    rows,
    numberCols: [],
    accentRows: [],
    note: `عدد الفرص البيعية (عملاء بلا عقود): ${rows.length} · تواصل معهم لتحويلهم لعقود`,
  };
}
