import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, featureOn, jsonError, normalizeArabic, ok, parseDay, todayStr } from "@/lib/api-utils";
import { EPS, r3, contractCurrentValue, supervisionExtension } from "@/lib/contrack-core";
import { actualSupervisionEnd, intOr, nextNumberByKey, numOr } from "@/lib/contrack-server";
import { ensureContractSubsidiaries } from "@/lib/subsidiary-server";
import { QUOTE_CONVERT_MARKER, QUOTE_TO_CONTRACT_MARKER } from "@/lib/sales-constants";
import {
  AMOUNT_POLICIES,
  amountGuardProblems,
  amountGuardStrictMessage,
  scalePlanAmounts,
  templatePlanRows,
  type AmountPolicy,
} from "@/lib/contract-create";

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
  let finalAmount = amount;

  const contractDate = parseDay(body.contractDate);
  if (!contractDate) return jsonError("تاريخ العقد مطلوب بصيغة YYYY-MM-DD");

  const stagesIn = Array.isArray(body.stages) ? (body.stages as Record<string, unknown>[]) : [];
  let planIn = Array.isArray(body.plan) ? (body.plan as Record<string, unknown>[]) : [];

  // ===== سيناريو المالك 2026-11 — الدفعة الأولى عند التعاقد =====
  // دفعة أولى عند التعاقد غير مربوطة بمرحلة (stageId=null)، تُعتبر مستحقة عند تفعيل العقد.
  // العقود تُولد بحالة «نشط» ⇒ الاستحقاق لحظة الإنشاء؛ وإن عاد العقد لاحقًا إلى «نشط» عبر
  // PATCH (من مسودة/متوقف) فسطر الدفعة الأولى غير المستحق يُستحق آليًا عند التفعيل (route [id]).
  const dpIn = body.downPayment && typeof body.downPayment === "object" ? (body.downPayment as Record<string, unknown>) : null;
  const dpAmount = dpIn ? numOr(dpIn.amount, 0) : 0;
  if (dpIn && !(dpAmount > 0)) return jsonError("مبلغ الدفعة الأولى عند التعاقد يجب أن يكون أكبر من صفر");
  const dpDueDate = dpIn ? parseDay(dpIn.dueDate) || contractDate : "";
  const dpAmountR = dpIn ? r3(dpAmount) : 0;

  // ===== حارس المبلغ amount_guard (المرحلة 3/ج — مطابقة المكتبي) =====
  // الفرق بين قيمة العقد ومجموع الدفعات (اتجاهين، عتبة 0.001):
  //  الميزة معطّلة ⇒ منع صارم برسالة الأصل الحرفية · مفعّلة ⇒ سياسة إلزامية من الخيارات الثلاثة
  const planSumCheck = r3(planIn.reduce((s, p) => s + numOr(p.amount, 0), 0) + dpAmountR);
  const agProblems = (planIn.length || dpAmountR > 0) ? amountGuardProblems(amount, planSumCheck) : [];
  if (agProblems.length) {
    if (!(await featureOn("amount_guard"))) {
      return jsonError(amountGuardStrictMessage(amount, agProblems), 400);
    }
    const policy = String(body.amountPolicy || "");
    if (!AMOUNT_POLICIES.includes(policy as AmountPolicy)) {
      return jsonError(
        "يوجد فرق بين قيمة العقد ومجموع الدفعات — اختر: تحديث المبلغ أو توزيع الدفعات أو الحفظ بالفرق",
        400
      );
    }
    if (policy === "update_amount") {
      finalAmount = planSumCheck;
    } else if (policy === "scale_plan") {
      const scaled = scalePlanAmounts(
        planIn.map((p) => numOr(p.amount, 0)),
        amount
      );
      planIn = planIn.map((p, i) => ({ ...p, amount: scaled[i] }));
    }
    // keep_diff ⇒ يُحفظ بالفرق (يُسجل في التقرير — كالأصل)
  }
  if (planIn.reduce((s, p) => s + numOr(p.amount, 0), 0) + dpAmountR > r3(finalAmount + EPS)) {
    return jsonError(dpIn ? "مجموع الدفعات مع الدفعة الأولى يتجاوز قيمة العقد" : "مجموع الدفعات يتجاوز قيمة العقد");
  }

  const contractName = String(body.contractName || "");
  const contractType = String(body.contractType || "غير محدد");
  const description = String(body.description || "");
  const notes = String(body.notes || "");

  // ===== وحدة «العقود وعروض الأسعار» — تحويل عرض سعر إلى عقد (قرار المالك) =====
  // يُرسل quotationId من معالج العقد المعبأ من العرض المقبول؛ بعد الإنشاء تُوسم ملاحظات
  // العرض آليًا «تحويل إلى عقد» داخل المعاملة نفسها (ذريًا مع إنشاء العقد) — والحرس
  // يمنع العرض المحوَّل سابقًا (لعقد أو لفاتورة) من التحويل مرة أخرى.
  const quotationId = Math.trunc(numOr(body.quotationId, 0));
  let fromQuote: { id: number; quotationNumber: string; notes: string } | null = null;
  if (quotationId > 0) {
    const q = await db.quotation.findUnique({ where: { id: quotationId } });
    if (!q) return jsonError("عرض السعر غير موجود", 404);
    if (q.notes.includes(QUOTE_TO_CONTRACT_MARKER)) return jsonError("عرض السعر محوَّل إلى عقد مسبقًا");
    if (q.notes.includes(QUOTE_CONVERT_MARKER)) return jsonError("عرض السعر محوَّل إلى فاتورة مسبقًا");
    fromQuote = { id: q.id, quotationNumber: q.quotationNumber, notes: q.notes };
  }

  const startDate = parseDay(body.startDate);
  const endDate = parseDay(body.endDate);
  const signDate = parseDay(body.signDate);
  const qty = numOr(body.qty, 1);
  const unitPrice = numOr(body.unitPrice, 0);

  // ===== Task 89b — الحالات الأربع (مطابقة المكتبي ContractDialog/_apply_mode) =====
  // النوع يُجلب دائمًا: اليدوي (manual_path) يُشتق من علم النوع لا من العميل،
  // والإشراف (تاريخ تعهد + أشهر × قيمة شهر − خصم) يجعل قيمة العقد الصافي المحسوب خادميًا (المبلغ مقفل)،
  // والشامل يستقبل مكوّناته كلقطة contract_components عند الإنشاء.
  const type = await db.contractType.findFirst({ where: { name: contractType } });
  const manualPath = type ? type.manualTrack : Boolean(body.manualPath);
  const supStartDate = parseDay(body.supStartDate) || "";
  const supMonths = Math.trunc(numOr(body.supMonths, 0));
  const supMonthly = numOr(body.supMonthly, 0);
  const supDiscount = numOr(body.supDiscount, 0);
  const supActive = (Boolean(type?.isSupervision) || Boolean(supStartDate)) && supMonths > 0 && supMonthly > 0;
  if (supActive) {
    const net = r3(supMonths * supMonthly - supDiscount);
    if (!(net > 0)) return jsonError("صافي قيمة الإشراف (الأشهر × قيمة الشهر − الخصم) يجب أن يكون أكبر من صفر");
    finalAmount = net;
  }
  const componentsIn = Array.isArray(body.components) ? (body.components as Record<string, unknown>[]) : [];
  // الإشراف: جدول الدفعات مفرغ كالمكتبي — التحصيل عبر أشهر الإشراف وسندات القبض مباشرة
  if (supActive && (planIn.length > 0 || dpIn)) {
    return jsonError("عقد الإشراف لا يقبل دفعات يدوية — التحصيل يتم عبر أشهر الإشراف وسندات القبض");
  }

  // ===== توليد الخطة من قالب النوع عند غياب الدفعات اليدوية (المرحلة 3/ج) =====
  // مطابقة workflow_service._generate_type_payments_from_template: بلا خطة يدوية
  // + قالب النوع فيه صفوف ⇒ تُولَّد الدفعات (النسبة من القيمة · اليدوي كما هو · المرنة تُتخطى)
  // والاستحقاق = تاريخ العقد + أيام القالب، وربط المرحلة بالاسم (V4.48) بترتيب القالب.
  // قرار المالك 2026-11: شرط الاستحقاق من قالب القوائم المرجعية يتوارث مع كل عقد يُنشأ من النوع.
  let tplRows: { title: string; amount: number; dueDate: string; triggerStageId: number | null; triggerKind: string }[] = [];
  if (planIn.length === 0) {
    const type = await db.contractType.findFirst({
      where: { name: contractType },
      include: { paymentTemplates: { orderBy: { payNo: "asc" as const } } },
    });
    if (type && type.paymentTemplates.length) {
      const gen = templatePlanRows(
        type.paymentTemplates.map((t) => ({
          title: t.title,
          pct: Number(t.pct),
          amountFixed: Number(t.amountFixed),
          daysOffset: t.daysOffset,
          triggerStageId: t.triggerStageId,
          triggerKind: t.triggerKind,
        })),
        finalAmount,
        contractDate
      );
      tplRows = gen.map((r) => ({
        title: r.title,
        amount: r.amount,
        dueDate: r.dueDate,
        triggerStageId: r.triggerStageId ?? null,
        triggerKind: r.triggerKind ?? "",
      }));
    }
  }
  // أسماء مراحل الربط من القالب (لمطابقة اسم نظيرتها في نسخة العقد — V4.48)
  const wfTriggerName = new Map<number, string>();
  {
    const ids = [...new Set(tplRows.map((r) => r.triggerStageId).filter((x): x is number => x !== null))];
    const rows = ids.length
      ? await db.workflowStage.findMany({ where: { id: { in: ids } }, select: { id: true, stageName: true } })
      : [];
    for (const s of rows) wfTriggerName.set(s.id, s.stageName);
  }

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
            amount: finalAmount,
            contractDate,
            description,
            notes,
            startDate,
            endDate,
            signDate,
            qty,
            unitPrice,
            manualPath,
            supStartDate: supActive ? supStartDate : "",
            supMonths: supActive ? supMonths : 0,
            supMonthly: supActive ? supMonthly : 0,
            supDiscount: supActive ? supDiscount : 0,
            status: "نشط",
          },
        });
        // البند الثالث NOVA — ضمان الحسابات الفرعية للعقد (ذمم 1121xxxx + WIP 1125xxxx)
        // في نفس المعاملة — ضمان رخو: أي فشل لا يُسقط إنشاء العقد، وأول ترحيل
        // يعيد المحاولة خاملًا (self-healing — docs/subsidiary-wip-design.md §1.2)
        try {
          await ensureContractSubsidiaries(tx, contract);
        } catch {
          // بلا شيء — الضمان الخامل في نقاط الترحيل يغطيها
        }
        // لقطة مكوّنات الشامل (المكتبي contract_components عند الإنشاء) — compKey = اسم نوع المكوّن
        for (const c of componentsIn) {
          const label = String(c.label || c.compKey || "").trim();
          if (!label) continue;
          await tx.contractComponent.create({
            data: {
              contractId: contract.id,
              compKey: label,
              label,
              kind: String(c.kind || "qty") === "months" ? "months" : "qty",
              enabled: c.enabled !== false,
              qty: numOr(c.qty, 1),
              months: Math.trunc(numOr(c.months, 0)),
              monthly: numOr(c.monthly, 0),
            },
          });
        }
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
              // Task 89b — طابع الإشرافي على المرحلة (من قوالب «مراحل المتابعة» الإشرافية)
              isSupervision: Boolean(s.isSupervision),
              supMonthly: numOr(s.supMonthly, 0),
              sortOrder: s.sortOrder !== undefined ? intOr(s.sortOrder, i) : i,
            },
            select: { id: true },
          });
          stageRows.push(st);
        }
        // خطة الدفعات — sortOrder بالترتيب · وعند غياب الخطة اليدوية: صفوف قالب النوع المولّدة
        // (ربط المرحلة بالاسم كـ_template_to_contract_stage_map — الأسماء المكررة تُستهلك بالترتيب)
        const stageNamePool = new Map<string, number[]>();
        for (let i = 0; i < stagesIn.length; i++) {
          const nm = String(stagesIn[i].name || "").trim();
          if (!nm) continue;
          const arr = stageNamePool.get(nm) ?? [];
          arr.push(stageRows[i].id);
          stageNamePool.set(nm, arr);
        }
        const takeStage = (wfId: number | null): number | null => {
          if (!wfId || !wfTriggerName.has(wfId)) return null;
          const nm = wfTriggerName.get(wfId)!;
          const arr = stageNamePool.get(nm);
          if (!arr || !arr.length) return null;
          return arr.shift()!;
        };
        const insertPlan = planIn.length
          ? planIn.map((p, i) => ({
              title: String(p.title || `دفعة ${i + 1}`).trim() || `دفعة ${i + 1}`,
              dueDate: parseDay(p.dueDate),
              amount: numOr(p.amount, 0),
              sortOrder: i,
              stageId:
                (p.stageIndex !== undefined && Number(p.stageIndex) >= 0 && stageRows[intOr(p.stageIndex, -1)]
                  ? stageRows[intOr(p.stageIndex, -1)].id
                  : p.stageId
                  ? intOr(p.stageId, 0) || null
                  : null) as number | null,
              // شرط الاستحقاق المرسل من الواجهة (توليد القالب) — "" ⇒ تطبيع القديم تحت
              triggerKind: String(p.triggerKind || ""),
            }))
          : tplRows.map((r, i) => ({
              title: r.title,
              dueDate: r.dueDate,
              amount: r.amount,
              sortOrder: i,
              stageId: takeStage(r.triggerStageId),
              triggerKind: r.triggerKind,
            }));
        for (const p of insertPlan) {
          // تطبيع شرط الاستحقاق — مطابقة مسار plan POST: بلا مرحلة ⇒ بتاريخ،
          // مع مرحلة وبلا شرط صريح ⇒ عند الإنجاز (السلوك المعتمد)
          let triggerKind = ["", "date", "stage_start", "stage_end"].includes(p.triggerKind) ? p.triggerKind : "";
          if (!p.stageId) triggerKind = triggerKind === "stage_start" || triggerKind === "stage_end" ? "date" : triggerKind || "date";
          else if (!triggerKind) triggerKind = "stage_end";
          await tx.paymentPlanItem.create({
            data: {
              contractId: contract.id,
              title: p.title,
              dueDate: p.dueDate,
              amount: p.amount,
              sortOrder: p.sortOrder,
              stageId: p.stageId,
              triggerKind,
            },
          });
        }
        // سيناريو المالك — الدفعة الأولى عند التعاقد: سطر مستقل أول الخطة، بلا مرحلة،
        // مستحق فورًا (العقد يُولد «نشط» = مفعّل لحظة الإنشاء) — سدوده ضمن حارس المبلغ أعلاه
        if (dpIn) {
          await tx.paymentPlanItem.create({
            data: {
              contractId: contract.id,
              title: "الدفعة الأولى عند التعاقد",
              dueDate: dpDueDate,
              amount: dpAmountR,
              sortOrder: -1,
              stageId: null,
              isDownPayment: true,
              triggeredAt: todayStr(),
              notes: "مستحقة عند تفعيل العقد — الدفعة الأولى غير مربوطة بمرحلة",
            },
          });
        }
        // تحويل عرض سعر — الوسم ذري مع إنشاء العقد (وحدة «العقود وعروض الأسعار»)
        if (fromQuote) {
          await tx.quotation.update({
            where: { id: fromQuote.id },
            data: {
              notes: `${fromQuote.notes ? `${fromQuote.notes}\n` : ""}${QUOTE_TO_CONTRACT_MARKER} ${contractNumber} بتاريخ ${todayStr()}`,
            },
          });
        }
        await tx.contractEvent.create({
          data: {
            contractId: contract.id,
            eventType: "إنشاء عقد",
            description: `تم إنشاء العقد ${contractNumber} للعميل ${customer.name} بقيمة ${finalAmount}${fromQuote ? ` — من تحويل عرض السعر ${fromQuote.quotationNumber}` : ""}`,
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
