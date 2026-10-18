import "server-only";
import { Prisma } from "@prisma/client";
import {
  contractCurrentValue,
  isSupervision,
  r3,
  EPS,
  todayStr,
  supervisionStatus,
} from "@/lib/contrack-core";
import { actualSupervisionEnd } from "@/lib/contrack-server";

export type Tx = Prisma.TransactionClient;

export class AddendumError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const ADDENDUM_TYPES = ["عقد إضافي", "أمر تغييري"] as const;
export const ADDENDUM_STATUSES = ["مسودة", "تحت المراجعة", "معتمد", "ملغى"] as const;

/** الملاحق القابلة للتعديل (مسودة/تحت المراجعة ولم تُنفَّذ) */
export function addendumEditable(a: { status: string; appliedAt: string }): boolean {
  return (a.status === "مسودة" || a.status === "تحت المراجعة") && !a.appliedAt;
}

/** تاريخ استحقاق جزء الدفعة — يُخزَّن مؤقتًا في حقل unit لأجزاء plan (لا حقل مخصص) */
export function partDueDate(p: { refKind: string; unit: string }): string {
  return p.refKind === "plan" && /^\d{4}-\d{2}-\d{2}$/.test(p.unit || "") ? p.unit : "";
}

/**
 * السياق المالي للعقد: القيمة الحالية (أصلية + معتمد ملاحق مع استبعاد ملحق بعينه + تمديد إشراف) والمحصّل.
 * مستخدم في حارسَي الاعتماد (القيمة ≥ المحصّل) وسقف الخطة.
 */
export async function contractMoneyContext(
  client: Tx,
  contractId: number,
  excludeAddendumId = 0
) {
  const [contract, approved, stages, agg] = await Promise.all([
    client.contract.findUnique({ where: { id: contractId } }),
    client.addendum.findMany({
      where: {
        contractId,
        status: "معتمد",
        ...(excludeAddendumId ? { id: { not: excludeAddendumId } } : {}),
      },
      select: { status: true, amountAdd: true, amountDeduct: true },
    }),
    client.contractStage.findMany({
      where: { contractId },
      select: { name: true, endDate: true, supActualEnd: true },
    }),
    client.voucher.aggregate({
      where: { contractId, vtype: "receipt", cancelled: false },
      _sum: { amount: true },
    }),
  ]);
  if (!contract) throw new AddendumError("العقد غير موجود", 404);
  const supContract = {
    supStartDate: contract.supStartDate,
    supMonths: contract.supMonths,
    supMonthly: Number(contract.supMonthly),
    supDiscount: Number(contract.supDiscount),
    supWaivedMonths: Number(contract.supWaivedMonths),
  };
  const supExt = isSupervision(supContract)
    ? supervisionStatus(supContract, [], actualSupervisionEnd(stages)).extensionValue
    : 0;
  const current = contractCurrentValue(
    Number(contract.amount),
    approved.map((a) => ({
      status: a.status,
      amountAdd: Number(a.amountAdd),
      amountDeduct: Number(a.amountDeduct),
    })),
    supExt
  );
  const collected = r3(Number(agg._sum.amount || 0));
  return { contract, current, collected, supExt };
}

/** إعادة حساب رأس الملحق من أجزاء جهة العميل (amountAdd=Σ إضافات / amountDeduct=Σ خصومات) */
export async function recomputeAddendumHeader(tx: Tx, addendumId: number) {
  const items = await tx.addendumItem.findMany({ where: { addendumId } });
  let add = 0;
  let deduct = 0;
  for (const i of items) {
    if (i.side !== "client") continue;
    if (i.action === "add") add = r3(add + Number(i.amount));
    else if (i.action === "delete") deduct = r3(deduct + Number(i.amount));
  }
  await tx.addendum.update({
    where: { id: addendumId },
    data: { amountAdd: add, amountDeduct: deduct },
  });
  return { add, deduct };
}

/** صافي أجزاء الباطن (إضافات − خصومات) */
function subNetOf(items: { side: string; action: string; amount: Prisma.Decimal | number }[]) {
  return r3(
    items
      .filter((i) => i.side === "sub")
      .reduce(
        (s, i) => s + (i.action === "add" ? Number(i.amount) : -Number(i.amount)),
        0
      )
  );
}

/**
 * اعتماد الملحق وتنفيذ أجزائه (apply_parts حرفيًا من المصدر) داخل معاملة واحدة:
 * - add boq  ⇒ إنشاء BoqItem جديد وتسجيل createdItemId
 * - add plan ⇒ إنشاء PaymentPlanItem (سقف الخطة) وتسجيل createdItemId
 * - delete   ⇒ حذف ناعم (deleted/deletedAddendumId) مع منع حذف بند مربوط بعقد باطن
 *              أو دفعة مرتبطة بسند قبض سارٍ
 * - unlink   ⇒ فصل المرحلة عن دفعات الخطة (stageId=null + وسم في notes)
 * - side=sub ⇒ تعديل قيمة عقد الباطن بصافي الأجزاء (بعد حارس المبلغ > 0)
 * الحارسان الماليان: القيمة الحالية ≥ المحصّل · مبلغ الباطن > 0.
 */
export async function approveAddendumTx(tx: Tx, addendumId: number, username: string) {
  const a = await tx.addendum.findUnique({
    where: { id: addendumId },
    include: { items: { orderBy: { id: "asc" as const } } },
  });
  if (!a) throw new AddendumError("الملحق غير موجود", 404);
  if (a.status === "معتمد") throw new AddendumError("الملحق معتمد مسبقًا");
  if (a.status === "ملغى") throw new AddendumError("الملحق ملغى — لا يمكن اعتماده");
  if (a.appliedAt) throw new AddendumError("تم تنفيذ هذا الملحق مسبقًا");

  const today = todayStr();
  const parts = a.items;
  const clientParts = parts.filter((p) => p.side === "client");

  // إجماليات جهة العميل: من الأجزاء إن وُجدت وإلا من الرأس (ملحق بقيمة صريحة بلا أجزاء)
  const clientAdd = clientParts.length
    ? r3(clientParts.filter((p) => p.action === "add").reduce((s, p) => s + Number(p.amount), 0))
    : a.side === "sub"
      ? 0
      : Number(a.amountAdd);
  const clientDeduct = clientParts.length
    ? r3(clientParts.filter((p) => p.action === "delete").reduce((s, p) => s + Number(p.amount), 0))
    : a.side === "sub"
      ? 0
      : Number(a.amountDeduct);
  const clientNet = r3(clientAdd - clientDeduct);

  // صافي الباطن: من الأجزاء أو من رأس الملحق (قبل تصفيره)
  let subNet = subNetOf(parts);
  if (a.side === "sub" && !parts.length) subNet = r3(Number(a.amountAdd) - Number(a.amountDeduct));
  const subIds = [
    ...new Set(
      parts
        .filter((p) => p.side === "sub")
        .map((p) => p.subContractId || a.subContractId || 0)
        .filter((x) => x > 0)
    ),
  ];
  if (a.side === "sub" && a.subContractId && !subIds.includes(a.subContractId)) {
    subIds.push(a.subContractId);
  }

  // ===== الحارس المالي (2): الخصم لا يجعل مبلغ الباطن صفرًا أو سالبًا =====
  if (a.side === "sub" && subNet < 0) {
    for (const sid of subIds) {
      const sc = await tx.subContract.findUnique({ where: { id: sid } });
      if (!sc) throw new AddendumError("عقد الباطن غير موجود", 404);
      if (r3(Number(sc.amount) + subNet) <= 0.0005) {
        throw new AddendumError("الخصم سيجعل مبلغ الباطن صفرًا أو سالبًا");
      }
    }
  }

  const addPlanParts = clientParts.filter((p) => p.action === "add" && p.refKind === "plan");
  const needCtx = clientDeduct > 0 || addPlanParts.length > 0;
  const ctx = needCtx
    ? await contractMoneyContext(tx, a.contractId, a.id)
    : null;

  // ===== الحارس المالي (1): الخصم لا يجعل القيمة الحالية أقل من المحصّل =====
  if (ctx && clientDeduct > 0) {
    const newValue = r3(ctx.current + clientNet);
    if (newValue < ctx.collected - 0.001) {
      throw new AddendumError("الخصم سيجعل القيمة الحالية أقل من المحصّل");
    }
  }

  // ===== سقف الخطة: Σ الدفعات بعد الإضافة ≤ القيمة بعد الاعتماد + 0.001 =====
  if (ctx && addPlanParts.length) {
    const agg = await tx.paymentPlanItem.aggregate({
      where: { contractId: a.contractId },
      _sum: { amount: true },
    });
    const addPlanSum = r3(addPlanParts.reduce((s, p) => s + Number(p.amount), 0));
    const cap = r3(ctx.current + clientNet + EPS);
    if (r3(Number(agg._sum.amount || 0) + addPlanSum) > cap) {
      throw new AddendumError("مجموع الدفعات يتجاوز القيمة الحالية");
    }
  }

  // ===== فحوص مسبقة للحذف (من المصدر) =====
  for (const p of clientParts.filter((x) => x.action === "delete" && x.refKind === "boq")) {
    const item = await tx.boqItem.findUnique({ where: { id: p.refId } });
    if (!item || item.contractId !== a.contractId) {
      throw new AddendumError("البند المحدد لا يتبع هذا العقد");
    }
    if (item.deleted) throw new AddendumError("البند محذوف بالفعل");
    const links = await tx.subContractItem.count({ where: { boqItemId: p.refId } });
    if (links > 0) throw new AddendumError("البند مرتبط بعقد باطن");
  }
  for (const p of clientParts.filter((x) => x.action === "delete" && x.refKind === "plan")) {
    const line = await tx.paymentPlanItem.findUnique({ where: { id: p.refId } });
    if (!line || line.contractId !== a.contractId) {
      throw new AddendumError("الدفعة المحددة لا تتبع هذا العقد");
    }
    if (line.deletedAddendumId) throw new AddendumError("الدفعة محذوفة بالفعل");
    const links = await tx.voucherPaymentLink.count({
      where: { lineId: p.refId, kind: "receipt", voucher: { cancelled: false } },
    });
    if (links > 0) throw new AddendumError("لا يمكن حذف الدفعة: مرتبطة بسند قبض سارٍ");
  }
  for (const p of clientParts.filter((x) => x.action === "delete" && x.refKind === "stage")) {
    const st = await tx.contractStage.findUnique({ where: { id: p.refId } });
    if (!st || st.contractId !== a.contractId) {
      throw new AddendumError("المرحلة المحددة لا تتبع هذا العقد");
    }
    if (st.deletedAddendumId) throw new AddendumError("المرحلة محذوفة بالفعل");
  }
  for (const p of clientParts.filter((x) => x.action === "unlink")) {
    const st = await tx.contractStage.findUnique({ where: { id: p.refId } });
    if (!st || st.contractId !== a.contractId) {
      throw new AddendumError("المرحلة المحددة لا تتبع هذا العقد");
    }
    const linked = await tx.paymentPlanItem.count({
      where: { contractId: a.contractId, stageId: p.refId },
    });
    if (linked === 0) throw new AddendumError("لا توجد دفعات مرتبطة بهذه المرحلة");
  }

  // ===== التنفيذ الفعلي (apply_parts) =====
  let appliedCount = 0;
  for (const p of clientParts) {
    if (p.action === "add") {
      if (p.refKind === "boq") {
        const created = await tx.boqItem.create({
          data: {
            contractId: a.contractId,
            description: p.description || "بند من ملحق",
            qty: p.qty,
            unit: p.unit,
            unitPrice: p.unitPrice,
            amount: p.amount,
            deleted: false,
          },
        });
        await tx.addendumItem.update({
          where: { id: p.id },
          data: { boqItemId: created.id, refId: created.id, createdItemId: created.id, applied: true },
        });
        appliedCount += 1;
      } else if (p.refKind === "plan") {
        const max = await tx.paymentPlanItem.aggregate({
          where: { contractId: a.contractId },
          _max: { sortOrder: true },
        });
        const created = await tx.paymentPlanItem.create({
          data: {
            contractId: a.contractId,
            title: p.description || "دفعة من ملحق",
            dueDate: partDueDate(p) || ctx?.contract.endDate || today,
            amount: p.amount,
            sortOrder: (max._max.sortOrder ?? -1) + 1,
            triggeredAt: "",
          },
        });
        await tx.addendumItem.update({
          where: { id: p.id },
          data: { refKind: "plan", refId: created.id, createdItemId: created.id, applied: true },
        });
        appliedCount += 1;
      }
    } else if (p.action === "delete") {
      if (p.refKind === "boq") {
        await tx.boqItem.update({
          where: { id: p.refId },
          data: { deleted: true, deletedAddendumId: a.id },
        });
      } else if (p.refKind === "plan") {
        await tx.paymentPlanItem.update({
          where: { id: p.refId },
          data: { deletedAddendumId: a.id },
        });
      } else if (p.refKind === "stage") {
        await tx.contractStage.update({
          where: { id: p.refId },
          data: { deletedAddendumId: a.id },
        });
      }
      await tx.addendumItem.update({ where: { id: p.id }, data: { applied: true } });
      appliedCount += 1;
    } else if (p.action === "unlink") {
      const marker = `فُكّ الربط بالملحق ${a.addendumNumber}`;
      const lines = await tx.paymentPlanItem.findMany({
        where: { contractId: a.contractId, stageId: p.refId },
        select: { id: true, notes: true },
      });
      for (const l of lines) {
        await tx.paymentPlanItem.update({
          where: { id: l.id },
          data: {
            stageId: null,
            notes: l.notes ? `${l.notes}\n${marker}` : marker,
          },
        });
      }
      await tx.addendumItem.update({ where: { id: p.id }, data: { applied: true } });
      appliedCount += 1;
    }
  }

  // ===== حركة قيمة الباطن =====
  let finalPartsCount = parts.length;
  if (a.side === "sub") {
    for (const sid of subIds) {
      const sc = await tx.subContract.findUnique({ where: { id: sid } });
      if (sc && Math.abs(subNet) > 0.0005) {
        await tx.subContract.update({
          where: { id: sid },
          data: { amount: r3(Number(sc.amount) + subNet) },
        });
      }
    }
    // ملحق باطن بقيمة صريحة بلا أجزاء ⇒ يُسجَّل كجزء صناعي ليُعكس عند الإلغاء
    if (!parts.length && Math.abs(subNet) > 0.0005) {
      await tx.addendumItem.create({
        data: {
          addendumId: a.id,
          side: "sub",
          action: subNet >= 0 ? "add" : "delete",
          description: "قيمة الملحق على عقد الباطن",
          amount: Math.abs(subNet),
          applied: true,
        },
      });
      appliedCount += 1;
      finalPartsCount += 1;
    }
  }

  await tx.addendum.update({
    where: { id: a.id },
    data: {
      status: "معتمد",
      approvedDate: today,
      appliedAt: today,
      itemsCount: finalPartsCount,
      // رأس الملحق يمثل صافي جهة العميل فقط (لا يؤثر ملحق الباطن على قيمة عقد العميل)
      amountAdd: clientAdd,
      amountDeduct: clientDeduct,
    },
  });

  await tx.contractEvent.create({
    data: {
      contractId: a.contractId,
      eventType: `اعتماد ${a.addendumType}`,
      description: `${a.addendumNumber} · عميل: +${clientAdd.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}/−${clientDeduct.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} · نُفِّذ ${appliedCount} جزء`,
      username,
    },
  });

  return {
    id: a.id,
    addendumNumber: a.addendumNumber,
    status: "معتمد",
    appliedCount,
    clientAdd,
    clientDeduct,
    clientNet,
    subNet: a.side === "sub" ? subNet : 0,
  };
}

/**
 * إلغاء الملحق (والتراجع الكامل restore_parts حرفيًا إن كان معتمدًا):
 * - المنشأ (createdItemId) يُمحى فعليًا (بند/دفعة)
 * - المحذوف ناعمًا يعود (deleted=false / deletedAddendumId=0)
 * - المرحلة المفكوكة يُعاد ربطها
 * - حركة قيمة الباطن تُعكس
 * حارس: دفعة منشأة رُبط بها سند (أو عليها مطالبة) تمنع الإلغاء.
 */
export async function cancelAddendumTx(tx: Tx, addendumId: number, reason: string, username: string) {
  const a = await tx.addendum.findUnique({
    where: { id: addendumId },
    include: { items: { orderBy: { id: "asc" as const } } },
  });
  if (!a) throw new AddendumError("الملحق غير موجود", 404);
  if (a.status === "ملغى") throw new AddendumError("الملحق ملغى بالفعل");
  const today = todayStr();

  if (a.appliedAt) {
    // ===== فحوص مسبقة للتراجع =====
    for (const p of a.items.filter((i) => i.action === "add" && i.createdItemId > 0)) {
      if (p.refKind === "plan") {
        const links = await tx.voucherPaymentLink.count({
          where: { lineId: p.createdItemId, kind: "receipt", voucher: { cancelled: false } },
        });
        if (links > 0) throw new AddendumError("لا يمكن الإلغاء: دفعة منشأة رُبط بها سند");
        const claims = await tx.claim.count({
          where: { custLineId: p.createdItemId, status: { notIn: ["cancelled", "refused", "archived"] } },
        });
        if (claims > 0) throw new AddendumError("لا يمكن الإلغاء: دفعة منشأة عليها مطالبة سارية");
      } else if (p.refKind === "boq") {
        const vouchers = await tx.voucher.count({
          where: { boqItemId: p.createdItemId, cancelled: false },
        });
        if (vouchers > 0) throw new AddendumError("لا يمكن الإلغاء: بند منشأ عليه سند سارٍ");
      }
    }

    // ===== restore_parts: التراجع عن كل جزء بترتيبه =====
    for (const p of a.items) {
      if (p.side === "client" && p.action === "add") {
        if (p.refKind === "boq" && p.createdItemId > 0) {
          // فك أي ارتباط بعقود باطن أولًا ثم المحي فعليًا (كالمصدر)
          await tx.subContractItem.deleteMany({ where: { boqItemId: p.createdItemId } });
          await tx.boqItem.delete({ where: { id: p.createdItemId } });
        } else if (p.refKind === "plan" && p.createdItemId > 0) {
          await tx.paymentPlanItem.delete({ where: { id: p.createdItemId } });
        }
      } else if (p.side === "client" && p.action === "delete") {
        if (p.refKind === "boq") {
          await tx.boqItem.update({
            where: { id: p.refId },
            data: { deleted: false, deletedAddendumId: 0 },
          });
        } else if (p.refKind === "plan") {
          await tx.paymentPlanItem.update({
            where: { id: p.refId },
            data: { deletedAddendumId: 0 },
          });
        } else if (p.refKind === "stage") {
          await tx.contractStage.update({
            where: { id: p.refId },
            data: { deletedAddendumId: 0 },
          });
        }
      } else if (p.side === "client" && p.action === "unlink") {
        // إعادة ربط المرحلة: الدفعات الموسومة بهذا الملحق تعود لمرحلتها
        const marker = `فُكّ الربط بالملحق ${a.addendumNumber}`;
        const lines = await tx.paymentPlanItem.findMany({
          where: { contractId: a.contractId, stageId: null, notes: { contains: marker } },
          select: { id: true, notes: true },
        });
        for (const l of lines) {
          await tx.paymentPlanItem.update({
            where: { id: l.id },
            data: {
              stageId: p.refId,
              notes: l.notes
                .split("\n")
                .filter((x) => x.trim() !== marker)
                .join("\n")
                .trim(),
            },
          });
        }
      }
    }

    // ===== عكس حركة قيمة الباطن =====
    if (a.side === "sub") {
      const subNet = subNetOf(a.items);
      const subIds = [
        ...new Set(
          a.items
            .filter((i) => i.side === "sub")
            .map((i) => i.subContractId || a.subContractId || 0)
            .filter((x) => x > 0)
        ),
      ];
      if (Math.abs(subNet) > 0.0005) {
        for (const sid of subIds) {
          const sc = await tx.subContract.findUnique({ where: { id: sid } });
          if (sc) {
            await tx.subContract.update({
              where: { id: sid },
              data: { amount: r3(Number(sc.amount) - subNet) },
            });
          }
        }
      }
    }

    await tx.addendum.update({
      where: { id: a.id },
      data: { appliedAt: "", amountAdd: 0, amountDeduct: 0 },
    });
  }

  await tx.addendum.update({
    where: { id: a.id },
    data: { status: "ملغى", cancelReason: reason, cancelledAt: today },
  });

  await tx.contractEvent.create({
    data: {
      contractId: a.contractId,
      eventType: `إلغاء ${a.addendumType}`,
      description: `${a.addendumNumber}${a.appliedAt ? " · مع تراجع كامل عن التنفيذ" : ""} · السبب: ${reason}`,
      username,
    },
  });

  return { id: a.id, addendumNumber: a.addendumNumber, status: "ملغى", restored: Boolean(a.appliedAt) };
}
