import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, adminGuard, jsonError, moduleGuard, nextNumber, ok } from "@/lib/api-utils";
import { TX_OPTS, postJournalEntry, postNamedEntry } from "@/lib/journal-server";
import { VOUCHER_PREFIX, VOUCHER_TYPE_LABELS } from "@/lib/voucher-server";
import { ensureEmployeeAdvanceAccount } from "@/lib/custody-server";
import { postPayrollProvisions } from "@/lib/hr-server";
import { monthEndDate, monthLabelAr } from "@/lib/hr-constants";

type P = { params: Promise<{ id: string }> };

/**
 * POST: اعتماد المسير — ذري (المدير حصرًا):
 * قيد الاعتماد: مدين 5210 (المستحق = الأساسي − خصم الغياب) / دائن 2160 بنفس القيمة،
 * ثم سند SD لكل موظف له خصم سلف (مدين 2160 / دائن 1140 — يخفض الذمة ويحدّث رصيد السلف آليًا).
 * الصافي الباقي على 2160 = صافي المسير → يُدفع لاحقًا بسند PV.
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

  const batch = await db.payrollBatch.findUnique({
    where: { id },
    include: {
      records: { where: { advanceDeduction: { gt: 0 } } },
    },
  });
  if (!batch) return jsonError("المسير غير موجود", 404);
  if (batch.status !== "draft") return jsonError("الاعتماد للمسودات حصرًا");

  // HR-2 — كل سجلات المسير للمخصصات (الرواتب الشهرية فقط تُحسب داخل postPayrollProvisions)
  const allRecords = await db.payrollRecord.findMany({
    where: { batchId: id },
    select: { employeeId: true, snapPaymentBasis: true, baseAmount: true },
  });
  const employeesForProvisions = await db.employee.findMany({
    where: { id: { in: allRecords.map((r) => r.employeeId) } },
    select: { id: true, salary: true, hireDate: true },
  });

  // دبابيس الحسابات — بالكود من دليل الشركة (شجرة البذر تضمنهما)
  const acc5210 = await db.account.findFirst({ where: { code: "5210", type: "expense" }, select: { id: true, code: true, name: true } });
  const acc2160 = await db.account.findFirst({ where: { code: "2160", type: "liability" }, select: { id: true, code: true, name: true } });
  if (!acc5210) return jsonError("حساب «رواتب وأجور» (5210) غير موجود في دليل الحسابات");
  if (!acc2160) return jsonError("حساب «رواتب مستحقة» (2160) غير موجود في دليل الحسابات");

  const earnedGross = Math.round((Number(batch.grossTotal) - Number(batch.deductionTotal)) * 1000) / 1000;
  if (earnedGross <= 0) return jsonError("مستحقات المسير صفر — لا شيء للاعتماد");
  const entryDate = monthEndDate(batch.month);
  const batchLabel = `مسير رواتب ${monthLabelAr(batch.month)} — PR-${batch.batchNo}`;
  const actor = guard.user.username;

  try {
    const result = await db.$transaction(
      async (tx) => {
        // 1) قيد الاعتماد عبر المحرك الموحد (يفحص التوازن والفترة المفتوحة)
        const posted = await postJournalEntry(
          tx,
          {
            entryDate,
            description: `${batchLabel} — مستحقات الاعتماد`,
            sourceType: "payroll",
            sourceId: batch.id,
            lines: [
              { accountId: acc5210.id, debit: earnedGross, credit: 0, description: "رواتب وأجور — مستحق الشهر" },
              { accountId: acc2160.id, debit: 0, credit: earnedGross, description: "رواتب مستحقة" },
            ],
          },
          actor
        );

        // 2) HR-2 — قيد المخصصات المصاحب (يُتخطى بصمت إن كانت الفئات صفرًا — §7)
        const provisionEntryId = await postPayrollProvisions(tx, {
          batchId: batch.id,
          month: batch.month,
          records: allRecords,
          employees: employeesForProvisions,
          actor,
          batchLabel,
        });

        // 3) سندات SD لخصم السلف — الطرفان مثبتان صراحةً: مدين 2160 / دائن حساب السلف الفعلي
        //    (نفس حساب منح السلف ensureEmployeeAdvanceAccount — لا اعتماد على قاعدة 1140 الافتراضية
        //     حتى لا يتباعد حساب المنح عن حساب الخصم — درس مُصحح أثناء التحقق الحي)
        const advanceAccount = await ensureEmployeeAdvanceAccount(tx);
        const vdate = entryDate;
        for (const rec of batch.records) {
          const amount = Number(rec.advanceDeduction);
          if (amount <= 0) continue;
          const voucherNumber = await nextNumber(VOUCHER_PREFIX.salary_deduction, 4, tx);
          const voucher = await tx.voucher.create({
            data: {
              voucherNumber,
              vtype: "salary_deduction",
              vdate,
              party: rec.snapName,
              partyType: "",
              partyId: null,
              method: "",
              account: "",
              accountId: acc2160.id,
              accountSnapshot: acc2160.name,
              advanceEmployeeId: rec.employeeId,
              amount,
              description: `خصم سلفة ضمن ${batchLabel}`,
            },
          });
          await postNamedEntry(tx, {
            entryDate: vdate,
            description: `${VOUCHER_TYPE_LABELS.salary_deduction} ${voucherNumber}`,
            debit: { name: acc2160.name, accountId: acc2160.id },
            credit: { name: advanceAccount.name, accountId: advanceAccount.id },
            amount,
            sourceType: "voucher",
            sourceId: voucher.id,
            dims: { employeeId: rec.employeeId },
          });
          await tx.payrollRecord.update({ where: { id: rec.id }, data: { deductionVoucherId: voucher.id } });
          await audit(tx, {
            username: actor,
            action: "إنشاء",
            entityType: "voucher",
            entityId: voucher.id,
            entityName: `${VOUCHER_TYPE_LABELS.salary_deduction} ${voucherNumber} — ${rec.snapName}`,
          });
        }

        // 4) توثيق الاعتماد
        await tx.payrollBatch.update({
          where: { id: batch.id },
          data: {
            status: "approved",
            approvedBy: actor,
            approvedAt: new Date(),
            journalEntryId: posted.id,
            provisionEntryId,
          },
        });
        await audit(tx, {
          username: actor,
          action: "اعتماد مسير",
          entityType: "payroll_batch",
          entityId: batch.id,
          entityName: batchLabel,
          oldStatus: "draft",
          newStatus: `approved / قيد #${posted.entryNo}${provisionEntryId ? " + مخصصات" : ""}`,
          reason: String(body.reason || "").trim(),
        });
        return { entryNo: posted.entryNo, entryId: posted.id, provisionEntryId };
      },
      TX_OPTS
    );

    return ok({ approved: true, entryId: result.entryId, entryNo: result.entryNo, provisionEntryId: result.provisionEntryId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("مقفلة")) return jsonError(msg);
    if (msg.includes("غير موجود في الدليل")) return jsonError(msg);
    console.error(e);
    return jsonError("تعذر اعتماد المسير", 500);
  }
}
