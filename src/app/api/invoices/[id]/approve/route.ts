import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";
import { approveInvoiceTx } from "@/lib/invoice-server";
import { INV_STATE_APPROVED } from "@/lib/invoice-state-core";

type P = { params: Promise<{ id: string }> };

/**
 * ز2 — اعتماد مستخلص العميل: مقدم → معتمد — «لحظة الحقيقة» (docs/boq-state-timeline-design.md §3):
 * داخل المعاملة: إعادة حارس المتاح الكمي (المسودات المنافسة تُحسم هنا — أول اعتماد يستهلك المتاح)
 * + تجميد لقطات cumulativeQty + لقطة استرداد الدفعة المقدمة + نشر قيد الإصدار (بوابة الفترة
 * المفتوحة على invoiceDate — فشله يتراجع كليًا) + التأشيرة approveBy/approveAt.
 * قبله في هذا المسار: سقف الفوترة المالي عبر loadContractCore (نفس مستوى حماية الإنشاء القائم).
 * مرآة مسار الشقيقة sub-certificates/[id]/approve.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  try {
    // سقف الفوترة المالي لحظة الحقيقة (قبل المعاملة — المعتمد السابق + هذه ≤ القيمة الحالية):
    // المسودة/المقدم لا تستهلكان القيمة، فالمسودات المتنافسة تُحسم هنا: أول اعتماد يجتاز والباقي يُرفض برسالة صريحة
    const inv0 = await db.invoice.findUnique({
      where: { id },
      select: { contractId: true, total: true, state: true, status: true },
    });
    if (!inv0) return jsonError("الفاتورة غير موجودة", 404);
    if (inv0.status === "void") return jsonError("الفاتورة ملغاة — لا اعتماد بعد الإلغاء", 400);
    if (inv0.contractId) {
      const core = await loadContractCore(inv0.contractId);
      if (!core) return jsonError("العقد غير موجود", 404);
      const approvedAgg = await db.invoice.aggregate({
        where: { contractId: inv0.contractId, status: { not: "void" }, state: INV_STATE_APPROVED },
        _sum: { total: true },
      });
      const remaining = r3(core.current - r3(Number(approvedAgg._sum.total || 0)));
      if (r3(Number(inv0.total)) > remaining + EPS) {
        return jsonError(`اعتماد الفاتورة تتجاوز المتبقي المعتمد من العقد (${remaining} د.ك)`);
      }
    }

    const result = await db.$transaction(
      async (tx) => {
        const res = await approveInvoiceTx(tx, id, guard.user.username);
        const inv = await tx.invoice.findUnique({
          where: { id },
          select: { contractId: true, total: true, state: true },
        });
        if (inv?.contractId) {
          const advanceNote = res.advanceRecovered > 0 ? ` — استرداد دفعة مقدمة ${r3(res.advanceRecovered)}` : "";
          await tx.contractEvent.create({
            data: {
              contractId: inv.contractId,
              eventType: "اعتماد مستخلص",
              description: `اعتماد المستخلص ${res.invoiceNumber} بمبلغ ${Number(inv.total)} ونشر قيد الإصدار #${res.entryNo}${advanceNote}`,
              username: guard.user.username,
            },
          });
        }
        await audit(tx, {
          username: guard.user.username,
          action: "اعتماد",
          entityType: "invoice",
          entityId: id,
          entityName: res.invoiceNumber,
          oldStatus: "مقدم",
          newStatus: INV_STATE_APPROVED,
        });
        return res;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    return ok({ state: INV_STATE_APPROVED, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (
      msg.includes("غير موجودة") ||
      msg.includes("حالة") ||
      msg.includes("المتاح") ||
      msg.includes("بنود BOQ") ||
      msg.includes("مقفلة") ||
      msg.includes("ملغاة") ||
      msg.includes("أرشيفية")
    ) {
      return jsonError(msg, 400);
    }
    console.error("فشل اعتماد الفاتورة:", e);
    return jsonError("تعذر اعتماد الفاتورة، حاول مجددًا", 500);
  }
}
