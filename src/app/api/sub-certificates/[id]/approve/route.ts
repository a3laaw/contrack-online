import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, todayStr } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { canSubCertApprove, SUBCERT_APPROVED, SUBCERT_SUBMITTED } from "@/lib/phase-a-core";

type P = { params: Promise<{ id: string }> };

/**
 * اعتماد المستخلص: مقدم → معتمد — لحظة الحقيقة (§3.4):
 * تُجمَّد اللقطات (cumulativeQty لكل سطر + cumulativeAmount للمستخلص = Σ gross غير الملغاة حتى الآن).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  try {
    const result = await db.$transaction(
      async (tx) => {
        const cert = await tx.subCertificate.findUnique({
          where: { id },
          include: { lines: true },
        });
        if (!cert) throw new Error("المستخلص غير موجود");
        if (!canSubCertApprove(cert.status)) {
          throw new Error(`المستخلص بحالة «${cert.status}» — الاعتماد من «مقدم» حصرًا`);
        }
        if (cert.status !== SUBCERT_SUBMITTED) throw new Error("حالة غير متوقعة");

        // لقطة التراكمي: gross هذا المستخلص + Σ gross للمعتمد والمدفوع قبله (غير الملغاة)
        const agg = await tx.subCertificate.aggregate({
          where: { subContractId: cert.subContractId, status: { in: ["معتمد", "مدفوع"] } },
          _sum: { grossAmount: true },
        });
        const cumulativeAmount = r3(Number(agg._sum.grossAmount || 0) + Number(cert.grossAmount));

        // لقطة التراكمي الكمي لكل سطر: كميته + Σ كميات نفس البند في المستخلصات المعتمدة/المدفوعة
        const approvedLines = await tx.subCertificateLine.findMany({
          where: {
            subItemId: { not: null },
            certificate: { subContractId: cert.subContractId, status: { in: ["معتمد", "مدفوع"] } },
          },
          select: { subItemId: true, qty: true },
        });
        const usedByItem = new Map<number, number>();
        for (const l of approvedLines) {
          if (l.subItemId != null) {
            usedByItem.set(l.subItemId, (usedByItem.get(l.subItemId) || 0) + Number(l.qty));
          }
        }
        for (const line of cert.lines) {
          const cum = line.subItemId != null ? (usedByItem.get(line.subItemId) || 0) + Number(line.qty) : Number(line.qty);
          await tx.subCertificateLine.update({
            where: { id: line.id },
            data: { cumulativeQty: r3(cum) },
          });
        }

        await tx.subCertificate.update({
          where: { id },
          data: {
            status: SUBCERT_APPROVED,
            cumulativeAmount,
            approveBy: guard.user.username,
            approveAt: todayStr(),
          },
        });
        await audit(tx, {
          username: guard.user.username,
          action: "اعتماد",
          entityType: "subCertificate",
          entityId: id,
          entityName: cert.certNumber,
          oldStatus: cert.status,
          newStatus: SUBCERT_APPROVED,
        });
        return { cumulativeAmount };
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    return ok({ status: SUBCERT_APPROVED, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("غير موجود") || msg.includes("حالة")) return jsonError(msg, 400);
    console.error("فشل اعتماد المستخلص:", e);
    return jsonError("تعذر اعتماد المستخلص، حاول مجددًا", 500);
  }
}
