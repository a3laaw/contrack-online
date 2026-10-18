import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, normalizeArabic, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3, contractCurrentValue, supervisionExtension } from "@/lib/contrack-core";
import { actualSupervisionEnd, intOr, nextNumberByKey, numOr } from "@/lib/contrack-server";

/** قائمة العقود: فلاتر q / status / customerId — مع القيمة الحالية والقبض وعدد الدفعات */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const status = (req.nextUrl.searchParams.get("status") || "").trim();
  const customerId = Number(req.nextUrl.searchParams.get("customerId") || 0);

  const where: Prisma.ContractWhereInput = {};
  if (status) where.status = status;
  if (Number.isFinite(customerId) && customerId > 0) where.customerId = customerId;

  const contracts = await db.contract.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      addendums: { select: { status: true, amountAdd: true, amountDeduct: true } },
      vouchers: { where: { vtype: "receipt", cancelled: false }, select: { amount: true } },
      _count: { select: { plan: true } },
    },
    orderBy: { id: "desc" },
  });

  // تمديد الإشراف يحتاج مراحل العقود الإشرافية فقط (actualEnd من مرحلة إنهاء إشراف)
  const supIds = contracts
    .filter((c) => Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0)
    .map((c) => c.id);
  const stageRows =
    supIds.length > 0
      ? await db.contractStage.findMany({
          where: { contractId: { in: supIds } },
          select: { contractId: true, name: true, endDate: true, supActualEnd: true },
        })
      : [];
  const stagesByContract = new Map<number, { name: string; endDate: string; supActualEnd: string }[]>();
  for (const s of stageRows) {
    const arr = stagesByContract.get(s.contractId) || [];
    arr.push({ name: s.name, endDate: s.endDate, supActualEnd: s.supActualEnd });
    stagesByContract.set(s.contractId, arr);
  }

  const nq = normalizeArabic(q);
  const rows: Record<string, unknown>[] = [];
  for (const c of contracts) {
    if (nq) {
      const hay = normalizeArabic(`${c.contractNumber} ${c.contractName || ""} ${c.customer.name}`);
      if (!hay.includes(nq)) continue;
    }
    const isSup = Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0;
    let supExt = 0;
    if (isSup) {
      const actualEnd = actualSupervisionEnd(stagesByContract.get(c.id) || []);
      supExt = supervisionExtension(
        {
          id: c.id,
          supStartDate: c.supStartDate,
          supMonths: c.supMonths,
          supMonthly: Number(c.supMonthly),
          supDiscount: Number(c.supDiscount),
          supWaivedMonths: Number(c.supWaivedMonths),
        },
        actualEnd
      );
    }
    const current = contractCurrentValue(
      Number(c.amount),
      c.addendums.map((a) => ({
        status: a.status,
        amountAdd: Number(a.amountAdd),
        amountDeduct: Number(a.amountDeduct),
      })),
      supExt
    );
    const collected = r3(c.vouchers.reduce((s, v) => s + Number(v.amount), 0));
    rows.push({
      id: c.id,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      contractType: c.contractType,
      customerId: c.customerId,
      customerName: c.customer.name,
      contractDate: c.contractDate,
      signDate: c.signDate,
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
      statusReason: c.statusReason,
      cancelledAt: c.cancelledAt,
      amount: Number(c.amount),
      current,
      collected,
      remaining: r3(current - collected),
      planCount: c._count.plan,
      isSupervision: isSup,
    });
  }
  return ok({ contracts: rows });
}

/** إنشاء عقد — CON-0001 عبر عدّاد ذري مع إعادة محاولة 5 مرات، والمراحل والخطة داخل معاملة واحدة */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "action_add_contract");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const customerId = numOr(body.customerId, 0);
  if (!customerId) return jsonError("العميل مطلوب");
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return jsonError("العميل غير موجود", 404);

  const amount = numOr(body.amount, 0);
  if (!(amount > 0)) return jsonError("قيمة العقد يجب أن تكون أكبر من صفر");

  const contractDate = parseDay(body.contractDate);
  if (!contractDate) return jsonError("تاريخ العقد مطلوب بصيغة YYYY-MM-DD");

  const stagesIn = Array.isArray(body.stages) ? (body.stages as Record<string, unknown>[]) : [];
  const planIn = Array.isArray(body.plan) ? (body.plan as Record<string, unknown>[]) : [];

  // سقف الخطة عند الإنشاء: مجموع الدفعات ≤ قيمة العقد + 0.001
  const planSum = r3(planIn.reduce((s, p) => s + numOr(p.amount, 0), 0));
  if (planSum > r3(amount + EPS)) return jsonError("مجموع الدفعات يتجاوز قيمة العقد");

  const contractName = String(body.contractName || "");
  const contractType = String(body.contractType || "غير محدد");
  const description = String(body.description || "");
  const notes = String(body.notes || "");
  const startDate = parseDay(body.startDate);
  const endDate = parseDay(body.endDate);
  const signDate = parseDay(body.signDate);
  const qty = numOr(body.qty, 1);
  const unitPrice = numOr(body.unitPrice, 0);

  let created: { id: number; contractNumber: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        const contractNumber = await nextNumberByKey("contract:number", "CON", 4, tx);
        const contract = await tx.contract.create({
          data: {
            contractNumber,
            contractName,
            customerId,
            contractType,
            amount,
            contractDate,
            description,
            notes,
            startDate,
            endDate,
            signDate,
            qty,
            unitPrice,
            status: "نشط",
          },
        });
        // نسخة المراحل (snapshot)
        const stageRows: { id: number }[] = [];
        for (let i = 0; i < stagesIn.length; i++) {
          const s = stagesIn[i];
          const name = String(s.name || `مرحلة ${i + 1}`).trim() || `مرحلة ${i + 1}`;
          const st = await tx.contractStage.create({
            data: {
              contractId: contract.id,
              name,
              level: intOr(s.level, 1),
              parentName: String(s.parentName || ""),
              expectedDays: intOr(s.expectedDays, 0),
              payPct: numOr(s.payPct, 0),
              payKind: String(s.payKind || ""),
              sortOrder: s.sortOrder !== undefined ? intOr(s.sortOrder, i) : i,
            },
            select: { id: true },
          });
          stageRows.push(st);
        }
        // خطة الدفعات — sortOrder بالترتيب
        for (let i = 0; i < planIn.length; i++) {
          const p = planIn[i];
          const idx = p.stageIndex !== undefined ? intOr(p.stageIndex, -1) : -1;
          const stageId =
            idx >= 0 && stageRows[idx] ? stageRows[idx].id : p.stageId ? intOr(p.stageId, 0) || null : null;
          await tx.paymentPlanItem.create({
            data: {
              contractId: contract.id,
              title: String(p.title || `دفعة ${i + 1}`).trim() || `دفعة ${i + 1}`,
              dueDate: parseDay(p.dueDate),
              amount: numOr(p.amount, 0),
              sortOrder: i,
              stageId,
            },
          });
        }
        await tx.contractEvent.create({
          data: {
            contractId: contract.id,
            eventType: "إنشاء عقد",
            description: `تم إنشاء العقد ${contractNumber} للعميل ${customer.name} بقيمة ${amount}`,
            username: guard.user.username,
          },
        });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء",
          entityType: "contract",
          entityId: contract.id,
          entityName: contractNumber,
        });
        return contract;
      });
      break;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        attempt < 4
      ) {
        lastError = e; // تضارب رقم العقد — أعِد المحاولة برقم جديد
        continue;
      }
      lastError = e;
      created = null;
      break;
    }
  }
  if (!created) {
    console.error("فشل إنشاء عقد:", lastError);
    return jsonError("تعذر إنشاء العقد، حاول مجددًا");
  }
  return ok({ contract: { id: created.id, contractNumber: created.contractNumber } }, 201);
}
