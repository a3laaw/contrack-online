import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import {
  canSubCertDelete,
  canSubCertEdit,
  computeSubCertNet,
  validateSubCertDeductions,
  validateSubCertLines,
  type SubCertLineInput,
} from "@/lib/phase-a-core";
import { computeSubAdvanceRecovery, loadSubCertAvailability, loadSubCertItemsWithAvailability } from "@/lib/sub-certificate-server";

type P = { params: Promise<{ id: string }> };

/** GET: المستخلص كاملًا مع أسطره + المتاحات الكمية الحالية لبنوده */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const cert = await db.subCertificate.findUnique({
    where: { id },
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
  });
  if (!cert) return jsonError("المستخلص غير موجود", 404);

  const items = await loadSubCertItemsWithAvailability(db, cert.subContractId);
  return ok({ certificate: cert, items });
}

/** PATCH: تعديل مسودة حصرًا — الأسطر والخصومات والملاحظات (اللقطات تُجمَّد عند الاعتماد) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const cert = await db.subCertificate.findUnique({ where: { id } });
  if (!cert) return jsonError("المستخلص غير موجود", 404);
  if (!canSubCertEdit(cert.status)) {
    return jsonError(`المستخلص بحالة «${cert.status}» — التعديل للمسودة حصرًا`);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.certDate !== undefined) {
    const d = parseDay(body.certDate);
    if (!d) return jsonError("تاريخ المستخلص غير صالح");
    data.certDate = d;
  }
  if (body.periodFrom !== undefined) data.periodFrom = parseDay(body.periodFrom) || "";
  if (body.periodTo !== undefined) data.periodTo = parseDay(body.periodTo) || "";
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim();
  if (body.otherDeductionNote !== undefined) data.otherDeductionNote = String(body.otherDeductionNote || "").trim();

  const ded = validateSubCertDeductions({
    retentionRate: body.retentionRate !== undefined ? body.retentionRate : cert.retentionRate,
    otherDeductions: body.otherDeductions !== undefined ? body.otherDeductions : cert.otherDeductions,
  });
  if (!ded.ok) return jsonError(ded.error);

  let lines: SubCertLineInput[] | null = null;
  if (body.lines !== undefined) {
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    lines = rawLines.map((l) => {
      const row = l as Record<string, unknown>;
      const sid = Number(row.subItemId ?? 0);
      return {
        subItemId: Number.isFinite(sid) && sid > 0 ? Math.trunc(sid) : null,
        description: String(row.description ?? "").trim(),
        qty: Number(row.qty ?? 0),
        unitPrice: Number(row.unitPrice ?? 0),
      };
    });
  }

  try {
    const updated = await db.$transaction(
      async (tx) => {
        const current = await tx.subCertificate.findUnique({
          where: { id },
          select: { status: true, grossAmount: true },
        });
        if (!current || !canSubCertEdit(current.status)) {
          throw new Error("المستخلص لم يبقَ مسودة — حدث تغيير متزامن");
        }

        let gross = Number(current.grossAmount);
        if (lines) {
          const availability = await loadSubCertAvailability(tx, cert.subContractId);
          // عند تعديل الأسطر: كميات هذا المستخلص نفسه تُعاد إلى المتاح (السطور القديمة ستُستبدل)
          const oldLines = await tx.subCertificateLine.findMany({
            where: { certificateId: id, subItemId: { not: null } },
            select: { subItemId: true, qty: true },
          });
          for (const ol of oldLines) {
            if (ol.subItemId != null) {
              availability.set(ol.subItemId, (availability.get(ol.subItemId) ?? 0) + Number(ol.qty));
            }
          }
          const checked = validateSubCertLines(lines, availability);
          if (!checked.ok) throw new Error(checked.error);
          gross = checked.gross;
          await tx.subCertificateLine.deleteMany({ where: { certificateId: id } });
          await tx.subCertificateLine.createMany({
            data: lines.map((l) => ({
              certificateId: id,
              subItemId: l.subItemId && l.subItemId > 0 ? l.subItemId : null,
              description: l.description,
              qty: r3(l.qty),
              unitPrice: r3(l.unitPrice),
              amount: r3(l.qty * l.unitPrice),
            })),
          });
        }

        const retentionAmount = r3((gross * ded.retentionRate) / 100);
        const advanceRecovery = await computeSubAdvanceRecovery(tx, cert.subContractId, gross);
        const netAmount = computeSubCertNet(gross, retentionAmount, advanceRecovery, ded.otherDeductions);

        const row = await tx.subCertificate.update({
          where: { id },
          data: {
            ...data,
            grossAmount: gross,
            retentionRate: ded.retentionRate,
            retentionAmount,
            advanceRecovery,
            otherDeductions: ded.otherDeductions,
            netAmount,
          },
        });
        await audit(tx, {
          username: guard.user.username,
          action: "تعديل",
          entityType: "subCertificate",
          entityId: id,
          entityName: cert.certNumber,
        });
        return row;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    return ok({
      certificate: {
        id: updated.id,
        status: updated.status,
        grossAmount: r3(Number(updated.grossAmount)),
        netAmount: r3(Number(updated.netAmount)),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("السطر") || msg.includes("مسودة") || msg.includes("المستخلص يحتاج")) {
      return jsonError(msg, 400);
    }
    console.error("فشل تعديل مستخلص الباطن:", e);
    return jsonError("تعذر تعديل المستخلص، حاول مجددًا", 500);
  }
}

/** DELETE: حذف مسودة حصرًا (الأسطر Cascade) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const cert = await db.subCertificate.findUnique({ where: { id } });
  if (!cert) return jsonError("المستخلص غير موجود", 404);
  if (!canSubCertDelete(cert.status)) {
    return jsonError(`المستخلص بحالة «${cert.status}» — الحذف للمسودة حصرًا (ألغِه بدلًا من الحذف)`);
  }

  await db.$transaction(async (tx) => {
    await tx.subCertificate.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "subCertificate",
      entityId: id,
      entityName: cert.certNumber,
    });
  });
  return ok({ deleted: true, certNumber: cert.certNumber });
}
