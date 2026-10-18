import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adminGuard, authGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";

/** رصيد الموظف = ΣPV سلفة − ΣCV رد − ΣSD خصم (سارية) — محسوب لحظيًا */

/** GET: الموظفون مع أرصدة السلف وحركة كل نوع */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const activeOnly = sp.get("active") === "1";

  const [employees, voucherRows] = await Promise.all([
    db.employee.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: { name: "asc" },
    }),
    db.voucher.findMany({
      where: { advanceEmployeeId: { not: null }, cancelled: false },
      select: { advanceEmployeeId: true, vtype: true, amount: true },
    }),
  ]);

  const byEmployee = new Map<number, { advanced: number; recovered: number; deducted: number; movements: number }>();
  for (const v of voucherRows) {
    const id = v.advanceEmployeeId as number;
    const e = byEmployee.get(id) || { advanced: 0, recovered: 0, deducted: 0, movements: 0 };
    e.movements += 1;
    if (v.vtype === "payment") e.advanced = r3(e.advanced + Number(v.amount));
    else if (v.vtype === "custody_return") e.recovered = r3(e.recovered + Number(v.amount));
    else if (v.vtype === "salary_deduction") e.deducted = r3(e.deducted + Number(v.amount));
    byEmployee.set(id, e);
  }

  const items = employees.map((emp) => {
    const m = byEmployee.get(emp.id) || { advanced: 0, recovered: 0, deducted: 0, movements: 0 };
    return {
      id: emp.id,
      name: emp.name,
      phone: emp.phone,
      notes: emp.notes,
      active: emp.active,
      advanced: m.advanced,
      recovered: m.recovered,
      deducted: m.deducted,
      balance: r3(m.advanced - m.recovered - m.deducted),
      movements: m.movements,
    };
  });

  return ok({
    employees: items,
    totals: {
      advanced: r3(items.reduce((s, e) => s + e.advanced, 0)),
      recovered: r3(items.reduce((s, e) => s + e.recovered, 0)),
      deducted: r3(items.reduce((s, e) => s + e.deducted, 0)),
      balance: r3(items.reduce((s, e) => s + e.balance, 0)),
    },
  });
}

/** POST: إضافة موظف (اسم فريد إلزامي) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم الموظف مطلوب");
    const created = await db.employee.create({
      data: {
        name,
        phone: String(body.phone || "").trim(),
        notes: String(body.notes || "").trim(),
        active: body.active === undefined ? true : Boolean(body.active),
      },
    });
    return ok({ employee: created }, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("اسم الموظف مستخدم مسبقًا");
    }
    console.error(e);
    return jsonError("تعذر إضافة الموظف", 500);
  }
}
