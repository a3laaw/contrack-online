import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, adminGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { TX_OPTS, postJournalEntry } from "@/lib/journal-server";
import { buildEosSettlementLines, leaveBalanceAtEnd } from "@/lib/hr-server";
import { monthLabelAr } from "@/lib/hr-constants";

type P = { params: Promise<{ id: string }> };

/**
 * POST: استقرار نهاية الخدمة (المدير حصرًا — ذري):
 * قيد التسوية عبر المحرك الموحد (مدين 2161/5210 + 2211/5211 / دائن 2160) ⇒ تعطيل الموظف
 * ⇒ status=مستقرة برابط القيد. الدفع النقدي لاحقًا بسند PV من 2160 كالمسير.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = guard.user.username;

  const termination = await db.employeeTermination.findUnique({
    where: { id },
    include: { employee: true },
  });
  if (!termination) return jsonError("التوثيق غير موجود", 404);
  if (termination.status === "مستقرة") return jsonError("التوثيق مستقر من قبل — القيد مربوط بمساره");
  if (termination.entryId) return jsonError("التوثيق له قيد من قبل — الحالة غير متسقة");

  const employee = termination.employee;

  // لقطة الرصيد السنوي لحظة الاستقرار (قد تتغير بين التوثيق والاستقرار — يعاد الحساب دائمًا — G9)
  const approvedDays = await db.employeeLeave.aggregate({
    where: { employeeId: employee.id, leaveType: "سنوية", status: { in: ["معتمدة", "بدأت", "منتهية"] }, startDate: { lte: termination.endDate } },
    _sum: { days: true },
  });
  const balance = leaveBalanceAtEnd(employee, termination.endDate, Number(approvedDays._sum.days ?? 0));

  const agreementAmount = termination.scenario === "اتفاق الطرفين" && Number(termination.eosAmount) > 0 ? Number(termination.eosAmount) : null;

  try {
    const result = await db.$transaction(
      async (tx) => {
        const { lines, calc } = await buildEosSettlementLines(tx, {
          employeeId: employee.id,
          employeeName: employee.name,
          wage: Number(employee.salary),
          hireDate: employee.hireDate,
          endDate: termination.endDate,
          scenario: termination.scenario,
          annualLeaveBalance: balance.balance,
          agreementAmount,
        });
        if (calc.total <= 0) {
          throw new Error("إجمالي التسوية صفر — لا قيد ولا استقرار (راجع السيناريو والأجر)");
        }

        const entryDate = termination.endDate;
        const label = `تسوية نهاية خدمة — ${employee.name} (${termination.scenario})`;
        const posted = await postJournalEntry(
          tx,
          {
            entryDate,
            description: label,
            sourceType: "eos_settlement",
            sourceId: termination.id,
            lines,
          },
          actor
        );

        await tx.employeeTermination.update({
          where: { id: termination.id },
          data: {
            status: "مستقرة",
            entryId: posted.id,
            serviceYears: calc.years,
            eosAmount: calc.eosAmount,
            leaveEncashment: calc.leaveEncashment,
            total: calc.total,
            wageAtEnd: Number(employee.salary),
            notes: String(body.notes || "").trim() || termination.notes,
          },
        });

        // تعطيل الموظف — نهاية الخدمة الفعلية (السلف والمسير يستثنيان غير النشط)
        await tx.employee.update({ where: { id: employee.id }, data: { active: false, notes: employee.notes } });

        await audit(tx, {
          username: actor,
          action: "استقرار نهاية خدمة",
          entityType: "employee_termination",
          entityId: termination.id,
          entityName: `${label} — الإجمالي ${calc.total} د.ك / قيد #${posted.entryNo}`,
          oldStatus: "محسوبة",
          newStatus: "مستقرة",
          reason: String(body.reason || "").trim(),
        });
        return { entryNo: posted.entryNo, entryId: posted.id, total: calc.total };
      },
      TX_OPTS
    );

    return ok({ settled: true, entryId: result.entryId, entryNo: result.entryNo, total: result.total, monthLabel: monthLabelAr(termination.endDate.slice(0, 7)) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("مقفلة") || msg.includes("غير موجود في الدليل") || msg.includes("صفر")) return jsonError(msg);
    console.error(e);
    return jsonError("تعذر استقرار التسوية", 500);
  }
}
