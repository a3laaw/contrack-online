import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, nextNumber, ok, parseDay } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import {
  computeSubCertNet,
  SUBCERT_DRAFT,
  SUBCERT_STATUSES,
  validateSubCertDeductions,
  validateSubCertLines,
  type SubCertLineInput,
} from "@/lib/phase-a-core";
import {
  computeSubAdvanceRecovery,
  loadSubCertItemsWithAvailability,
  nextCertNo,
} from "@/lib/sub-certificate-server";

/**
 * مستخلصات الباطن SubIPC (المرحلة أ — docs/retention-subipc-advance-design.md §3):
 *  • GET: قائمة بفلتري subContractId/status — مع بنود كل عقد باطن ومتاحاتها الكمية.
 *  • POST: إنشاء مسودة (آلة الحالات مغلقة — التعديل/الحذف للمسودة حصرًا).
 *    التراكمي الكمي يُرفض فيه السطر المتجاوز للمتاح، والصافي ≥ 0 محركًا.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const subContractId = Number(sp.get("subContractId") || 0);
  const statusFilter = (sp.get("status") || "all").trim();

  const where: Record<string, unknown> = {};
  if (Number.isFinite(subContractId) && subContractId > 0) where.subContractId = subContractId;
  if (statusFilter !== "all" && (SUBCERT_STATUSES as readonly string[]).includes(statusFilter)) {
    where.status = statusFilter;
  }

  const rows = await db.subCertificate.findMany({
    where,
    include: {
      subContract: {
        select: {
          id: true,
          contractId: true,
          description: true,
          contract: { select: { id: true, contractNumber: true, contractName: true } },
          subcontractor: { select: { id: true, name: true, subCode: true } },
        },
      },
      lines: { orderBy: { id: "asc" } },
      paidVoucher: { select: { id: true, voucherNumber: true, cancelled: true } },
    },
    orderBy: [{ subContractId: "asc" }, { certNo: "desc" }],
    take: 1000,
  });

  const certificates = rows.map((c) => ({
    id: c.id,
    subContractId: c.subContractId,
    contractId: c.subContract.contractId,
    contractNumber: c.subContract.contract.contractNumber,
    contractName: c.subContract.contract.contractName,
    subcontractorName: c.subContract.subcontractor.name,
    subCode: c.subContract.subcontractor.subCode,
    certNo: c.certNo,
    certNumber: c.certNumber,
    certDate: c.certDate,
    periodFrom: c.periodFrom,
    periodTo: c.periodTo,
    grossAmount: r3(Number(c.grossAmount)),
    retentionRate: r3(Number(c.retentionRate)),
    retentionAmount: r3(Number(c.retentionAmount)),
    advanceRecovery: r3(Number(c.advanceRecovery)),
    otherDeductions: r3(Number(c.otherDeductions)),
    otherDeductionNote: c.otherDeductionNote,
    netAmount: r3(Number(c.netAmount)),
    cumulativeAmount: r3(Number(c.cumulativeAmount)),
    status: c.status,
    submitBy: c.submitBy,
    submitAt: c.submitAt,
    approveBy: c.approveBy,
    approveAt: c.approveAt,
    paidVoucherId: c.paidVoucherId,
    paidVoucherNumber: c.paidVoucher?.voucherNumber ?? null,
    paidVoucherCancelled: c.paidVoucher?.cancelled ?? false,
    cancelReason: c.cancelReason,
    notes: c.notes,
    lines: c.lines.map((l) => ({
      id: l.id,
      subItemId: l.subItemId,
      description: l.description,
      qty: r3(Number(l.qty)),
      unitPrice: r3(Number(l.unitPrice)),
      amount: r3(Number(l.amount)),
      cumulativeQty: r3(Number(l.cumulativeQty)),
    })),
  }));

  // بنود العقد الباطن ومتاحاتها — للنافذة المفتوحة حاليًا في الواجهة
  let items: Awaited<ReturnType<typeof loadSubCertItemsWithAvailability>> = [];
  if (Number.isFinite(subContractId) && subContractId > 0) {
    items = await loadSubCertItemsWithAvailability(db, subContractId);
  }

  return ok({ certificates, items });
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const subContractId = Number(body.subContractId || 0);
  if (!Number.isFinite(subContractId) || subContractId <= 0) return jsonError("عقد الباطن مطلوب");
  const certDate = parseDay(body.certDate);
  if (!certDate) return jsonError("تاريخ المستخلص مطلوب بصيغة YYYY-MM-DD");
  const periodFrom = parseDay(body.periodFrom) || "";
  const periodTo = parseDay(body.periodTo) || "";
  const notes = String(body.notes || "").trim();
  const otherDeductionNote = String(body.otherDeductionNote || "").trim();

  const ded = validateSubCertDeductions(body);
  if (!ded.ok) return jsonError(ded.error);

  const sc = await db.subContract.findUnique({
    where: { id: subContractId },
    include: { contract: { select: { id: true, status: true, contractNumber: true } } },
  });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);
  if (sc.status === "ملغى") return jsonError("لا يمكن إنشاء مستخلصات على عقد باطن ملغى");
  if (sc.contract.status === "ملغى") return jsonError("العقد الأب ملغى — لا مستخلصات");

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: SubCertLineInput[] = rawLines.map((l) => {
    const row = l as Record<string, unknown>;
    const sid = Number(row.subItemId ?? 0);
    return {
      subItemId: Number.isFinite(sid) && sid > 0 ? Math.trunc(sid) : null,
      description: String(row.description ?? "").trim(),
      qty: Number(row.qty ?? 0),
      unitPrice: Number(row.unitPrice ?? 0),
    };
  });

  try {
    const created = await db.$transaction(
      async (tx) => {
        const availability = await (async () => {
          const { loadSubCertAvailability } = await import("@/lib/sub-certificate-server");
          return loadSubCertAvailability(tx, subContractId);
        })();
        const checked = validateSubCertLines(lines, availability);
        if (!checked.ok) throw new Error(checked.error);

        const gross = checked.gross;
        const retentionAmount = r3((gross * ded.retentionRate) / 100);
        const advanceRecovery = await computeSubAdvanceRecovery(tx, subContractId, gross);
        const netAmount = computeSubCertNet(gross, retentionAmount, advanceRecovery, ded.otherDeductions);

        const certNo = await nextCertNo(tx, subContractId);
        const certNumber = await nextNumber("SUBIPC", 4, tx);
        const cert = await tx.subCertificate.create({
          data: {
            subContractId,
            certNo,
            certNumber,
            certDate,
            periodFrom,
            periodTo,
            grossAmount: gross,
            retentionRate: ded.retentionRate,
            retentionAmount,
            advanceRecovery,
            otherDeductions: ded.otherDeductions,
            otherDeductionNote,
            netAmount,
            status: SUBCERT_DRAFT,
            notes,
            lines: {
              create: lines.map((l) => ({
                subItemId: l.subItemId && l.subItemId > 0 ? l.subItemId : null,
                description: l.description,
                qty: r3(l.qty),
                unitPrice: r3(l.unitPrice),
                amount: r3(l.qty * l.unitPrice),
              })),
            },
          },
        });
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء",
          entityType: "subCertificate",
          entityId: cert.id,
          entityName: certNumber,
        });
        return cert;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    return ok(
      {
        certificate: {
          id: created.id,
          certNo: created.certNo,
          certNumber: created.certNumber,
          status: created.status,
          grossAmount: r3(Number(created.grossAmount)),
          netAmount: r3(Number(created.netAmount)),
        },
      },
      201
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("السطر") || msg.includes("سطرًا") || msg.includes("المستخلص يحتاج")) {
      return jsonError(msg, 400);
    }
    console.error("فشل إنشاء مستخلص الباطن:", e);
    return jsonError("تعذر إنشاء المستخلص، حاول مجددًا", 500);
  }
}
