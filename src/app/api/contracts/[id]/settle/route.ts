import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, todayStr } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

/**
 * تصفية وإغلاق العقد — POST /api/contracts/[id]/settle
 * المرجع الحرفي المكتبي: services/extras_service.py::close_contract (338) عبر
 * ui/contract_hub.py::_settle_contract (1834):
 * 1) حاجز المتبقي: «لا يمكن إغلاق العقد · ما زال عليه مبلغ متبقٍ: X»
 * 2) حاجز المراحل: «لا يمكن إغلاق العقد · التحصيل مكتمل لكن مسار المراحل لم يكتمل بعد.»
 * 3) status='مغلق' + حدث «إغلاق العقد — تصفية كاملة · تم تحصيل كامل القيمة» + تدقيق.
 * ملاحظة موثقة: المكتبي لا يولّد سندًا ولا يسوّي مطالبات داخل التصفية
 * (auto_settle_contract تُستدعى بعد حفظ السندات فقط)، ومستحقات الباطن
 * (contract_sub_dues) تحذير غير مانع يُعرض في حوار التأكيد من GET overview.
 * بيانات حوار التأكيد (القيمة/المحصّل/المتبقي/المستحقات) من GET /api/contracts/[id]/overview.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);

  // حاجز المتبقي (close_contract)
  const remaining = r3(core.current - core.collected);
  if (remaining > EPS) {
    return jsonError(
      `لا يمكن إغلاق العقد · ما زال عليه مبلغ متبقٍ: ${remaining.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    );
  }

  // حاجز مسار المراحل (close_contract) — الجارية: بدأت ولم تُنهَ
  const stages = core.stages.filter((s) => s.level === 1);
  const stageRequired = stages.length > 0;
  const stagesComplete = !stages.some((s) => s.startDate && !s.endDate);
  if (stageRequired && !stagesComplete) {
    return jsonError("لا يمكن إغلاق العقد · التحصيل مكتمل لكن مسار المراحل لم يكتمل بعد.");
  }

  await db.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
      data: { status: "مغلق" },
    });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "إغلاق العقد",
        description: "تصفية كاملة · تم تحصيل كامل القيمة",
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تصفية وإغلاق",
      entityType: "contract",
      entityId: contractId,
      entityName: core.contract.contractNumber,
      oldStatus: core.contract.status,
      newStatus: "مغلق",
    });
  });

  return ok({
    closed: true,
    status: "مغلق",
    message: "تم إغلاق العقد · تصفية كاملة ✅",
    closedAt: todayStr(),
  });
}
