import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adminGuard, authGuard, jsonError, ok } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { intOr } from "@/lib/contrack-server";
import { employeeAdvanceRemaining } from "@/lib/voucher-server";

type P = { params: Promise<{ id: string }> };

/** GET: موظف واحد برصيده وعدد حركاته */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);
  const emp = await db.employee.findUnique({ where: { id } });
  if (!emp) return jsonError("الموظف غير موجود", 404);

  const rows = await db.voucher.findMany({
    where: { advanceEmployeeId: id, cancelled: false },
    select: { vtype: true, amount: true },
  });
  const advanced = r3(rows.filter((v) => v.vtype === "payment").reduce((s, v) => s + Number(v.amount), 0));
  const recovered = r3(rows.filter((v) => v.vtype === "custody_return").reduce((s, v) => s + Number(v.amount), 0));
  const deducted = r3(rows.filter((v) => v.vtype === "salary_deduction").reduce((s, v) => s + Number(v.amount), 0));
  return ok({
    employee: {
      ...emp,
      advanced,
      recovered,
      deducted,
      balance: r3(advanced - recovered - deducted),
      movements: rows.length,
    },
  });
}

/** PATCH: تعديل بيانات الموظف (اسم/هاتف/ملاحظات/تفعيل) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);
  const emp = await db.employee.findUnique({ where: { id } });
  if (!emp) return jsonError("الموظف غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.EmployeeUpdateInput = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError("اسم الموظف مطلوب");
    data.name = name;
  }
  if (body.phone !== undefined) data.phone = String(body.phone).trim();
  if (body.notes !== undefined) data.notes = String(body.notes).trim();
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (!Object.keys(data).length) return ok({ employee: emp });

  try {
    const updated = await db.employee.update({ where: { id }, data });
    return ok({ employee: updated });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("اسم الموظف مستخدم مسبقًا");
    }
    console.error(e);
    return jsonError("تعذر تعديل الموظف", 500);
  }
}

/** DELETE (مدير): يُرفض إن كانت له سلف نشطة برصيد ≠ 0 أو أي حركة سلف سارية */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);
  const emp = await db.employee.findUnique({ where: { id } });
  if (!emp) return jsonError("الموظف غير موجود", 404);

  const activeVouchers = await db.voucher.count({ where: { advanceEmployeeId: id, cancelled: false } });
  if (activeVouchers > 0) {
    const bal = await employeeAdvanceRemaining(db, id);
    if (Math.abs(bal) > EPS) {
      return jsonError(`لا يمكن حذف موظف له سلف قائمة (الرصيد ${bal} د.ك)`);
    }
    return jsonError("لا يمكن حذف موظف له سلف قائمة — ألغِ سندات السلف أولًا");
  }

  await db.employee.delete({ where: { id } });
  return ok({ deleted: true, id, name: emp.name });
}
