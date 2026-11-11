import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { canReleaseRetention } from "@/lib/phase-a-core";
import { ensurePeriodForDate, postNamedEntry } from "@/lib/journal-server";
import { resolveContractSubsidiary } from "@/lib/subsidiary-server";
import { resolveInvoiceIssueSides, resolveRetentionSide } from "@/lib/invoice-server";

type P = { params: Promise<{ id: string }> };

/**
 * الإفراج عن محتجزات مستخلص العميل (المرحلة أ — docs/retention-subipc-advance-design.md §1.4):
 *  • حواجز: غير ملغاة · محتجز > 0 · غير مفرج عنه · فترة التاريخ مفتوحة.
 *  • القيد: مدين ذمم/فرعي العقد · دائن 1122 بمبلغ R — نقل الالتزام من محتجز
 *    إلى ذمم قابلة للتحصيل، ثم يُحصَّل بسند قبض عادي (لا تغيير على منطق القبض).
 *  • حدث عقد + تدقيق. مدير حصرًا (adminGuard).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const releaseDate = parseDay(body.releaseDate) || todayStr();

  try {
    const result = await db.$transaction(
      async (tx) => {
        const inv = await tx.invoice.findUnique({
          where: { id },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            status: true,
            total: true,
            retentionAmount: true,
            retentionReleased: true,
            customerId: true,
            contractId: true,
            customer: { select: { name: true } },
            contract: { select: { id: true, contractNumber: true } },
          },
        });
        if (!inv) throw new Error("الفاتورة غير موجودة");

        const retentionAmount = r3(Number(inv.retentionAmount));
        const gate = canReleaseRetention({
          status: inv.status,
          retentionAmount,
          retentionReleased: inv.retentionReleased,
        });
        if (!gate.ok) throw new Error(gate.error);

        // بوابة الفترة المالية — قبل أي كتابة
        const period = await ensurePeriodForDate(tx, releaseDate);
        if (!period.open) throw new Error(`فترة ${releaseDate.slice(0, 7)} مقفلة — لا يمكن النشر عليها.`);

        // مدين الإفراج: الفرعي الآلي للعقد (اتساقًا مع قيد الإصدار) وإلا طرف العملاء المعلن
        let debitSide: { name: string; accountId: number | null } | null = null;
        if (inv.contractId) {
          try {
            const sub = await resolveContractSubsidiary(tx, inv.contractId, "ar");
            if (sub) debitSide = { accountId: sub.id, name: sub.name };
          } catch {
            // الفرعي غير متاح — الطرف المعلن كما هو
          }
        }
        if (!debitSide) {
          const sides = await resolveInvoiceIssueSides(tx);
          debitSide = sides.debit;
        }
        const creditSide = await resolveRetentionSide(tx);

        const entry = await postNamedEntry(tx, {
          entryDate: releaseDate,
          description: `إفراج عن محتجزات الفاتورة ${inv.invoiceNumber} — ${inv.customer.name}`,
          debit: { name: debitSide.name, accountId: debitSide.accountId },
          credit: { name: creditSide.name, accountId: creditSide.accountId },
          amount: retentionAmount,
          dims: { customerId: inv.customerId, contractId: inv.contractId ?? null },
          sourceType: "invoice_retention_release",
          sourceId: inv.id,
          actor: guard.user.username,
        });

        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            retentionReleased: true,
            retentionReleasedAt: releaseDate,
            retentionReleaseEntryId: entry.id,
          },
        });

        if (inv.contractId) {
          await tx.contractEvent.create({
            data: {
              contractId: inv.contractId,
              eventType: "إفراج عن محتجزات",
              description: `إفراج عن محتجزات الفاتورة ${inv.invoiceNumber} بمبلغ ${retentionAmount} (قيد #${entry.entryNo}) — العقد ${inv.contract?.contractNumber ?? ""}`,
              username: guard.user.username,
            },
          });
        }
        await audit(tx, {
          username: guard.user.username,
          action: "إفراج محتجزات",
          entityType: "invoice",
          entityId: inv.id,
          entityName: inv.invoiceNumber,
        });
        return {
          invoiceNumber: inv.invoiceNumber,
          retentionAmount,
          entryNo: entry.entryNo,
          releasedAt: releaseDate,
        };
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    return ok({ released: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (
      msg.includes("غير موجودة") ||
      msg.includes("ملغاة") ||
      msg.includes("لا توجد محتجزات") ||
      msg.includes("مُفرج") ||
      msg.includes("مقفلة")
    ) {
      return jsonError(msg, 400);
    }
    console.error("فشل الإفراج عن المحتجزات:", e);
    return jsonError("تعذر الإفراج عن المحتجزات، حاول مجددًا", 500);
  }
}
