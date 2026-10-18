import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, nextNumber, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3, receiptBankFee } from "@/lib/contrack-core";
import { getSettingsRow, loadContractCore } from "@/lib/contrack-server";
import {
  VoucherError,
  insertVoucherJournal,
  createFeeChildVoucher,
  splitEven,
  normalizeAccount,
} from "@/lib/voucher-server";

interface GroupLine {
  contractId: number;
  amount: number;
  method: string;
  vdate: string;
  description: string;
}

/**
 * القبض المجمع (للمدير): فحص سقف لكل سطر أولًا داخل المعاملة (وإلا 400 قبل أي حفظ)،
 * ثم RV لكل سطر بمرجع BT-#### ورقم سطر، وعمولة واحدة على الإجمالي مقسومة بالتساوي (سند ابن واحد PV).
 */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const linesIn = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  if (linesIn.length === 0) return jsonError("سطور القبض المجمع مطلوبة");

  const lines: GroupLine[] = [];
  for (let i = 0; i < linesIn.length; i++) {
    const l = linesIn[i];
    const contractId = Number(l.contractId || 0);
    const amount = Number(l.amount || 0);
    const vdate = parseDay(l.vdate);
    const method = String(l.method || "").trim();
    if (!contractId) return jsonError(`سطر ${i + 1}: العقد مطلوب`);
    if (!(amount > 0)) return jsonError(`سطر ${i + 1}: القيمة يجب أن تكون أكبر من صفر`);
    if (!vdate) return jsonError(`سطر ${i + 1}: التاريخ مطلوب بصيغة YYYY-MM-DD`);
    lines.push({ contractId, amount, method, vdate, description: String(l.description || "") });
  }

  // تحميل العقود وقيمها المستحقة قبل المعاملة
  const cores = new Map<number, NonNullable<Awaited<ReturnType<typeof loadContractCore>>>>();
  for (const line of lines) {
    if (!cores.has(line.contractId)) {
      const core = await loadContractCore(line.contractId);
      if (!core) return jsonError(`العقد رقم ${line.contractId} غير موجود`, 404);
      if (["مغلق", "ملغى"].includes(core.contract.status)) {
        return jsonError(`العقد ${core.contract.contractNumber} بحالة «${core.contract.status}» — لا يقبل حركات مالية`);
      }
      cores.set(line.contractId, core);
    }
  }

  const firstMethod = lines[0].method;
  const totalAmount = r3(lines.reduce((s, l) => s + l.amount, 0));

  try {
    const result = await db.$transaction(async (tx) => {
      // فحص السقف لكل سطر أولًا — قبل أي حفظ
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const core = cores.get(line.contractId)!;
        const dueValue = r3(Math.max(core.current, core.sup ? core.sup.totalDue : 0));
        const agg = await tx.voucher.aggregate({
          where: { contractId: line.contractId, vtype: "receipt", cancelled: false },
          _sum: { amount: true },
        });
        const collected = r3(Number(agg._sum.amount || 0));
        const remaining = r3(dueValue - collected);
        if (line.amount > remaining + 1e-9 && !body.allowOverpay) {
          throw new VoucherError(
            `سطر ${i + 1} (${core.contract.contractNumber}): قيمة السند تتجاوز المبلغ المتبقي من العقد (${remaining} د.ك فقط). سيتم تسجيل الزيادة كـ (دفعة مقدمة) على العقد.`,
            400
          );
        }
      }

      const groupRef = await nextNumber("BT", 4, tx);
      const settings = await getSettingsRow(tx);
      const methods = await tx.paymentMethod.findMany();
      const created: { id: number; voucherNumber: string; contractId: number }[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const core = cores.get(line.contractId)!;
        const method = line.method || firstMethod;
        const account = normalizeAccount("", method);
        const voucherNumber = await nextNumber("RV", 4, tx);
        const voucher = await tx.voucher.create({
          data: {
            voucherNumber,
            vtype: "receipt",
            vdate: line.vdate,
            party: core.contract.customer.name,
            partyType: "customer",
            partyId: core.contract.customerId,
            method,
            account,
            amount: line.amount,
            description: line.description || `قبض مجمع ${groupRef}`,
            contractId: line.contractId,
            receiptGroupRef: groupRef,
            receiptGroupLine: i + 1,
          },
        });
        await insertVoucherJournal(tx, {
          id: voucher.id,
          voucherNumber: voucher.voucherNumber,
          vtype: "receipt",
          vdate: line.vdate,
          amount: line.amount,
          account,
          method,
          contractId: line.contractId,
          subContractId: null,
          expenseAccountSnapshot: "",
          custodyAccountSnapshot: "",
          partyType: "customer",
        });
        await tx.contractEvent.create({
          data: {
            contractId: line.contractId,
            eventType: "سند قبض",
            description: `سند قبض ${voucher.voucherNumber} بمبلغ ${line.amount} ضمن الدفعة المجمعة ${groupRef} (سطر ${i + 1})`,
            username: guard.user.username,
          },
        });
        created.push({ id: voucher.id, voucherNumber: voucher.voucherNumber, contractId: line.contractId });
      }

      // عمولة واحدة على الإجمالي مقسومة بالتساوي — سند ابن واحد مرتبط بأول RV
      let feeChild: { id: number; voucherNumber: string; amount: number } | null = null;
      const fee = receiptBankFee(
        firstMethod,
        totalAmount,
        methods.map((m) => ({ name: m.name, feeType: m.feeType, feeValue: Number(m.feeValue), isActive: m.isActive })),
        {
          bankFeeAmount: Number(settings.bankFeeAmount),
          bankFeeMethod: settings.bankFeeMethod,
          bankFeeEnabled: settings.bankFeeEnabled,
        }
      );
      if (fee > EPS) {
        feeChild = await createFeeChildVoucher(tx, {
          parent: {
            id: created[0].id,
            voucherNumber: created[0].voucherNumber,
            vdate: lines[0].vdate,
            method: firstMethod,
            account: normalizeAccount("", firstMethod),
            contractId: null,
          },
          fee,
          allocationRows: splitEven(
            fee,
            lines.map((l) => l.contractId)
          ),
        });
        // صحّح بيانات الابن لتخص المجموعة كاملة
        await tx.voucher.update({
          where: { id: feeChild.id },
          data: {
            description: `رسوم بنكية عن الدفعة المجمعة ${groupRef}`,
            notes: `BANK_FEE:${groupRef}`,
          },
        });
        await tx.journalEntry.updateMany({
          where: { sourceType: "bank_fee_alloc", sourceId: feeChild.id },
          data: { description: `توزيع رسوم بنكية بالتساوي عن المجموعة ${groupRef}` },
        });
      }

      await audit(tx, {
        username: guard.user.username,
        action: "إنشاء",
        entityType: "voucher_group",
        entityId: created[0].id,
        entityName: groupRef,
      });

      return { groupRef, vouchers: created, feeChild };
    });
    return ok(result, 201);
  } catch (e) {
    if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("تضارب في الترقيم، أعد المحاولة", 409);
    }
    console.error(e);
    return jsonError("تعذر إنشاء الدفعة المجمعة", 500);
  }
}
