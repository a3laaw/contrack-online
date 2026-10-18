import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { createVoucher, employeeAdvanceRemaining, VoucherError, VOUCHER_TYPE_LABELS } from "@/lib/voucher-server";
import { createEmployeeAdvance } from "@/lib/custody-server";

function err(e: unknown) {
  if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

const KIND_LABELS: Record<string, string> = {
  grant: "صرف سلفة",
  return: "رد نقدي",
  deduction: "خصم من راتب",
};

/** GET: سجل حركات السلف — ?employeeId=&from=&to=&includeCancelled=1 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const employeeId = intOr(sp.get("employeeId"), 0);
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  const includeCancelled = sp.get("includeCancelled") === "1";

  const rows = await db.voucher.findMany({
    where: {
      advanceEmployeeId: { not: null },
      ...(employeeId ? { advanceEmployeeId: employeeId } : {}),
      ...(from || to ? { vdate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(includeCancelled ? {} : { cancelled: false }),
    },
    include: { employee: { select: { id: true, name: true } } },
    orderBy: [{ vdate: "desc" }, { id: "desc" }],
    take: 2000,
  });

  const kindOf = (vtype: string) =>
    vtype === "payment" ? "grant" : vtype === "custody_return" ? "return" : "deduction";

  const vouchers = rows.map((v) => ({
    id: v.id,
    voucherNumber: v.voucherNumber,
    vtype: v.vtype,
    vtypeLabel: VOUCHER_TYPE_LABELS[v.vtype] || v.vtype,
    kind: kindOf(v.vtype),
    kindLabel: KIND_LABELS[kindOf(v.vtype)] || v.vtype,
    vdate: v.vdate,
    amount: Number(v.amount),
    employeeId: v.advanceEmployeeId,
    employeeName: v.employee?.name || "",
    description: v.description,
    cancelled: v.cancelled,
    cancelReason: v.cancelReason,
    cancelledAt: v.cancelledAt,
  }));

  return ok({
    vouchers,
    ...(employeeId ? { balance: await employeeAdvanceRemaining(db, employeeId) } : {}),
  });
}

/**
 * POST حركات السلف عبر السندات: {kind: 'grant'|'return'|'deduction', employeeId, amount, vdate, method?}
 * - grant: PV بـadvanceEmployeeId وparty=اسم الموظف (مدين سلف موظفين دائن الصندوق).
 * - return: CV بسقف قاطع على المتبقي (مدين الصندوق دائن سلف موظفين — بلا أثر إيرادي).
 * - deduction: SD بسقف قاطع (مدين رواتب دائن سلف موظفين — بلا نقدية).
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "action_add_voucher");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = String(body.kind || "").trim();
    const employeeId = intOr(body.employeeId, 0);
    if (!employeeId) return jsonError("الموظف مطلوب");
    if (!["grant", "return", "deduction"].includes(kind)) {
      return jsonError("نوع حركة السلفة غير صالح (المسموح: grant صرف / return رد نقدي / deduction خصم من راتب)");
    }

    if (kind === "deduction") {
      // SD عبر createVoucher — بسقف قاطع على رصيد الموظف
      const emp = await db.employee.findUnique({ where: { id: employeeId } });
      if (!emp) return jsonError("الموظف غير موجود", 404);
      const created = await createVoucher(
        {
          vtype: "salary_deduction",
          amount: Number(body.amount),
          vdate: String(body.vdate || ""),
          advanceEmployeeId: employeeId,
          party: emp.name,
          description: String(body.description || ""),
        },
        guard.user
      );
      return ok(
        {
          voucher: {
            ...created,
            kind,
            kindLabel: KIND_LABELS[kind],
            employeeId,
            employeeName: emp.name,
            balance: await employeeAdvanceRemaining(db, employeeId),
          },
        },
        201
      );
    }

    // grant / return — إنشاء يدوي بنفس الترقيم والقيود (createVoucher لا يربط advanceEmployeeId بهذين النوعين)
    const created = await createEmployeeAdvance(
      {
        kind: kind as "grant" | "return",
        employeeId,
        amount: Number(body.amount),
        vdate: String(body.vdate || ""),
        method: String(body.method || ""),
        account: body.account !== undefined && body.account !== null ? String(body.account) : undefined,
        description: String(body.description || ""),
      },
      guard.user
    );
    return ok(
      {
        voucher: {
          ...created,
          kindLabel: KIND_LABELS[kind],
          balance: await employeeAdvanceRemaining(db, employeeId),
        },
      },
      201
    );
  } catch (e) {
    return err(e);
  }
}
