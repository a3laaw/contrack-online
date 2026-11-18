import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, todayStr } from "@/lib/api-utils";
import { canInvoiceSubmit, INV_STATE_SUBMITTED } from "@/lib/invoice-state-core";

type P = { params: Promise<{ id: string }> };

/**
 * ز2 — تقديم مستخلص العميل: مسودة → مقدم (آلة حالات مغلقة — docs/boq-state-timeline-design.md §3)
 * مرآة مسار الشقيقة sub-certificates/[id]/submit — المسودة تخرج من قابلية التحرير وتنتظر الاعتماد.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const inv = await db.invoice.findUnique({ where: { id } });
  if (!inv) return jsonError("الفاتورة غير موجودة", 404);
  if (inv.status === "void") return jsonError("الفاتورة ملغاة — لا تقديم بعد الإلغاء");
  if (!canInvoiceSubmit(inv.state)) {
    return jsonError(`الفاتورة بحالة ولاية «${inv.state}» — التقديم من «مسودة» حصرًا`);
  }

  await db.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id },
      data: { state: INV_STATE_SUBMITTED, submitBy: guard.user.username, submitAt: todayStr() },
    });
    if (inv.contractId) {
      await tx.contractEvent.create({
        data: {
          contractId: inv.contractId,
          eventType: "تقديم مستخلص",
          description: `تقديم مسودة المستخلص ${inv.invoiceNumber} بمبلغ ${Number(inv.total)} للاعتماد`,
          username: guard.user.username,
        },
      });
    }
    await audit(tx, {
      username: guard.user.username,
      action: "تقديم",
      entityType: "invoice",
      entityId: id,
      entityName: inv.invoiceNumber,
      oldStatus: inv.state,
      newStatus: INV_STATE_SUBMITTED,
    });
  });
  return ok({ state: INV_STATE_SUBMITTED });
}
