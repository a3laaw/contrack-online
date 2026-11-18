import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { deriveBoqTimeline } from "@/lib/boq-state-core";

type P = { params: Promise<{ id: string }> };

/**
 * ز3 — الأحداث المؤرخة لخط زمن حالة BOQ (docs/boq-state-timeline-design.md §5):
 * فتح/تقديم/اعتماد لكل مستخلص من حقوله المؤرخة (invoiceDate/submitAt/approveAt — ز2) +
 * الملاحق المعتمدة بتاريخ اعتمادها + الإلغاء من أحداث العقد («إلغاء فاتورة»).
 * نقطة لكل حدث في الشريط الزمني — الضغط عليها يفتح «كما كان في» ذلك التاريخ.
 * حد v1 موثق: الاستيراد بلا حدث مؤرخ في القاعدة فلا يظهر هنا.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const [invoices, addendums, voidEvents] = await Promise.all([
    db.invoice.findMany({
      where: { contractId },
      select: { id: true, invoiceNumber: true, invoiceDate: true, status: true, submitAt: true, approveAt: true, total: true },
      orderBy: [{ invoiceDate: "asc" }, { id: "asc" }],
    }),
    db.addendum.findMany({
      where: { contractId, side: "client", status: "معتمد" },
      select: { addendumNumber: true, approvedDate: true, description: true },
      orderBy: [{ approvedDate: "asc" }, { id: "asc" }],
    }),
    db.contractEvent.findMany({
      where: { contractId, eventType: "إلغاء فاتورة" },
      select: { eventTime: true, description: true },
      orderBy: { eventTime: "asc" },
    }),
  ]);

  const events = deriveBoqTimeline({
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      status: inv.status,
      submitAt: inv.submitAt,
      approveAt: inv.approveAt,
      total: Number(inv.total),
    })),
    addendums,
    voidEvents: voidEvents.map((e) => ({ eventTime: e.eventTime.toISOString(), description: e.description })),
  });

  return ok({ events });
}
