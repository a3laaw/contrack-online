import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { EPS, r3, todayStr } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

/**
 * ملف العميل — دفعة واحدة (مقابل المكتبي customer_contracts_summary + نظرة عامة):
 * - العميل + الشارات (contractsCount/activeCount/remaining/overdueCount/overdueDays)
 * - ملخص عام (current/collected/paid/remaining/cheques14)
 * - أهم العقود (أكبر متبقٍ أولًا · 5 صفوف كما في المكتبي)
 * - كل عقود العميل لقائمة Master-Detail (مع hasOverdue/overdueDays/overdueTitle لكل عقد)
 * - صفوف السجل الزمني (أحداث عقود العميل — آخر 40 حدثًا نعرض منها 12 كما في المكتبي)
 *
 * الحسابات لحظية من الحركات (لا أرصدة مخزنة):
 * - قيمة العقد = amount + Σ ملاحق معتمدة net + تمديد الإشراف (contractCurrentValue)
 * - المحصّل = سندات قبض سارية · المدفوع = سندات صرف سارية
 * - العقود الملغاة/المسودة تُستثنى من الإجماليات المالية (كالمكتبي)
 * - «أقصى تأخر»: خطوط خطة بمتبقٍ > 0.001 وأيام استحقاق سالبة (بانتظار المرحلة/المتخطاة مستبعدة)
 * - «شيكات 14 يوم»: سندات بطريقة شيك بتاريخ استحقاق خلال 14 يومًا قادمة (يشمل المتأخر منها —
 *   كالمكتبي due_cheques: days_left <= 14 بلا حد أدنى) على عقود هذا العميل
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      customerCode: true,
      name: true,
      phone: true,
      email: true,
      governorate: true,
      area: true,
      block: true,
      plot: true,
      address: true,
      notes: true,
      folderPath: true,
    },
  });
  if (!customer) return jsonError("العميل غير موجود", 404);

  const contractsRaw = await db.contract.findMany({
    where: { customerId: id },
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      contractType: true,
      status: true,
      startDate: true,
      endDate: true,
    },
    orderBy: { id: "desc" },
  });

  // الحسابات المالية لكل عقد عبر نفس محرك مركز العقد/التقارير (اتساق الأرقام)
  const cores = await Promise.all(contractsRaw.map((c) => loadContractCore(c.id)));

  // المدفوع (سندات صرف سارية) لكل عقد — خارج loadContractCore
  const paymentRows = contractsRaw.length
    ? await db.voucher.groupBy({
        by: ["contractId"],
        where: {
          contractId: { in: contractsRaw.map((c) => c.id) },
          vtype: "payment",
          cancelled: false,
        },
        _sum: { amount: true },
      })
    : [];
  const paidByContract = new Map<number, number>();
  for (const g of paymentRows) {
    if (g.contractId != null) paidByContract.set(g.contractId, r3(Number(g._sum.amount || 0)));
  }

  const contracts = contractsRaw.map((c, i) => {
    const core = cores[i];
    if (!core) {
      return {
        id: c.id,
        contractNumber: c.contractNumber,
        name: c.contractName || c.contractNumber,
        contractType: c.contractType,
        status: c.status,
        startDate: c.startDate,
        endDate: c.endDate,
        current: 0,
        collected: 0,
        paid: 0,
        remaining: 0,
        hasOverdue: false,
        overdueDays: 0,
        overdueTitle: "",
        isSupervision: false,
      };
    }
    // أقصى تأخر لهذا العقد: خط بمتبقٍ > 0.001 وdaysDiff سالب (كالمكتبي؛ المتخطاة مستبعدة صراحةً
    // لأن حساب الويب يترك daysDiff الحقيقي للخطوط المتخطاة بينما المكتبي يجعلها 999999)
    let daysLate = 0;
    let title = "";
    if (c.status !== "مغلق" && c.status !== "ملغى") {
      for (const line of core.computed.lines) {
        if (line.remaining > EPS && line.daysDiff < 0 && line.state !== "skipped") {
          const late = -line.daysDiff;
          if (late > daysLate) {
            daysLate = late;
            title = line.title;
          }
        }
      }
    }
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      name: c.contractName || c.contractNumber,
      contractType: c.contractType,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      current: core.current,
      collected: core.collected,
      paid: paidByContract.get(c.id) || 0,
      remaining: r3(core.current - core.collected),
      hasOverdue: daysLate > 0,
      overdueDays: daysLate,
      overdueTitle: title,
      isSupervision: Boolean(core.sup),
    };
  });

  // الإجماليات: العد يشمل الكل · المال يستثني الملغى والمسودة (كالمكتبي)
  let tCurrent = 0,
    tCollected = 0,
    tPaid = 0;
  for (const c of contracts) {
    if (c.status !== "ملغى" && c.status !== "مسودة") {
      tCurrent += c.current;
      tCollected += c.collected;
      tPaid += c.paid;
    }
  }
  const active = contracts.filter((c) => c.status === "نشط").length;
  const overdueContracts = contracts.filter((c) => c.hasOverdue);
  const totals = {
    count: contracts.length,
    active,
    overdueCount: overdueContracts.length,
    overdueDays: overdueContracts.reduce((m, c) => Math.max(m, c.overdueDays), 0),
    current: r3(tCurrent),
    collected: r3(tCollected),
    paid: r3(tPaid),
    remaining: r3(tCurrent - tCollected),
  };

  // شيكات 14 يوم: سندات بطريقة «شيك» بتاريخ استحقاق خلال 14 يومًا (كالمكتبي
  // due_cheques(14) المصفّاة على أرقام عقود هذا العميل) — يشمل ما فات استحقاقه
  let cheques14 = 0;
  if (contracts.length > 0) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 14);
    const hz = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, "0")}-${String(horizon.getDate()).padStart(2, "0")}`;
    const chequeVouchers = await db.voucher.findMany({
      where: {
        contractId: { in: contractsRaw.map((c) => c.id) },
        cancelled: false,
        method: { contains: "شيك" },
        chequeDueDate: { not: "" },
      },
      select: { chequeDueDate: true },
    });
    cheques14 = chequeVouchers.filter((v) => v.chequeDueDate && v.chequeDueDate <= hz).length;
  }

  // أهم العقود: المتبقي الأكبر أولًا (5 صفوف كما في المكتبي)
  const topContracts = [...contracts]
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 5)
    .map((c) => ({
      id: c.id,
      contractNumber: c.contractNumber,
      name: c.name,
      status: c.status,
      current: c.current,
      collected: c.collected,
      remaining: c.remaining,
    }));

  // السجل الزمني: آخر 40 حدثًا لعقود العميل ثم أعلى 12 عرضًا (كالمكتبي)
  const nameById = new Map(contracts.map((c) => [c.id, c.name]));
  const eventsRaw =
    contracts.length > 0
      ? await db.contractEvent.findMany({
          where: { contractId: { in: contractsRaw.map((c) => c.id) } },
          orderBy: [{ eventTime: "desc" }, { id: "desc" }],
          take: 40,
        })
      : [];
  const timeline = eventsRaw.slice(0, 12).map((e) => ({
    contractId: e.contractId,
    contractName: nameById.get(e.contractId) || "عقد",
    eventTime: e.eventTime.toISOString(),
    eventType: e.eventType,
    description: e.description,
    username: e.username,
  }));

  return ok({
    customer,
    totals,
    cheques14,
    topContracts,
    contracts,
    timeline,
    meta: {
      today: todayStr(),
      overdueTooltip:
        totals.overdueCount > 0
          ? `على العميل ${totals.overdueCount} عقد بقسط متأخر (أقصى تأخر ${totals.overdueDays} يومًا)`
          : "",
    },
  });
}
