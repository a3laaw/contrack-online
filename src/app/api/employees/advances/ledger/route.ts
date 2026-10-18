import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { r3 } from "@/lib/contrack-core";

/**
 * كشف سلفة موظف — GET /api/employees/advances/ledger?employeeId=&from=&to=
 * المرجع المكتبي: lifecycle_service.employee_ledger — سلفة/رد/خصم برصيد جارٍ.
 * الرصيد محسوب لحظيًا من الحركات السارية داخل الفترة (بلا تخزين).
 */
const KINDS: Record<string, { kind: string; label: string; sign: 1 | -1 }> = {
  payment: { kind: "advance", label: "💸 سلفة", sign: 1 },
  custody_return: { kind: "recover", label: "↩ رد نقدي", sign: -1 },
  salary_deduction: { kind: "deduct", label: "✂ خصم راتب", sign: -1 },
};

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const employeeId = intOr(sp.get("employeeId"), 0);
  if (!employeeId) return jsonError("الموظف مطلوب");
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));

  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return jsonError("الموظف غير موجود", 404);

  const vouchers = await db.voucher.findMany({
    where: {
      advanceEmployeeId: employeeId,
      cancelled: false,
      vtype: { in: ["payment", "custody_return", "salary_deduction"] },
      ...(from || to ? { vdate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    select: { id: true, voucherNumber: true, vtype: true, vdate: true, amount: true, description: true },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
  });

  let balance = 0;
  const rows = vouchers.map((v) => {
    const meta = KINDS[v.vtype] || { kind: "other", label: "حركة", sign: 1 as const };
    const amount = r3(Number(v.amount));
    balance = r3(balance + meta.sign * amount);
    return {
      voucherId: v.id,
      ref: v.voucherNumber,
      kind: meta.kind,
      label: meta.label,
      vdate: v.vdate,
      description: v.description || "",
      in: meta.sign > 0 ? amount : 0,
      out: meta.sign < 0 ? amount : 0,
      balance,
    };
  });

  return ok({
    employeeId,
    employee: emp.name,
    rows,
    balance,
    dateFrom: from,
    dateTo: to,
  });
}
