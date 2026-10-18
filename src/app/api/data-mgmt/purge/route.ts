import { NextRequest } from "next/server";
import fs from "fs";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, forbidden, unauthorized, jsonError, ok } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth";
import { ATTACH_DIR } from "@/lib/backups";

type Tx = Prisma.TransactionClient;

interface SnapshotSection {
  table: string;
  rows: unknown[];
}

interface PurgeCtx {
  counters: Record<string, number>;
  snapshot: SnapshotSection[];
  attachmentFiles: string[];
}

function bump(ctx: PurgeCtx, key: string, n: number) {
  ctx.counters[key] = (ctx.counters[key] || 0) + n;
}

async function snap<T>(ctx: PurgeCtx, table: string, rows: T[]): Promise<T[]> {
  if (rows.length) ctx.snapshot.push({ table, rows });
  return rows;
}

/** حارس المطور — أدوات المحو للمطور فقط */
async function developerGuard(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return { response: unauthorized() };
  if (user.role !== "developer") return { response: forbidden("أدوات المحو للمطور فقط") };
  return { user };
}

/** جمع صفوف تبعيات العقد + العدّادات (قبل الحذف) */
async function collectContract(tx: Tx, contractId: number, ctx: PurgeCtx) {
  const contract = await tx.contract.findUnique({ where: { id: contractId } });
  if (!contract) return null;
  await snap(ctx, "contracts", [contract]);

  const subs = await snap(
    ctx,
    "sub_contracts",
    await tx.subContract.findMany({ where: { contractId } })
  );
  const subIds = subs.map((s) => s.id);

  const subLines = subIds.length
    ? await snap(ctx, "sub_payment_plan", await tx.subPaymentPlanItem.findMany({ where: { subContractId: { in: subIds } } }))
    : [];
  const subLineIds = subLines.map((l) => l.id);

  const subItems = subIds.length
    ? await snap(ctx, "sub_contract_items", await tx.subContractItem.findMany({ where: { subContractId: { in: subIds } } }))
    : [];

  const stages = await snap(ctx, "contract_stages", await tx.contractStage.findMany({ where: { contractId } }));
  const stageIds = stages.map((s) => s.id);

  const boq = await snap(ctx, "boq_items", await tx.boqItem.findMany({ where: { contractId } }));
  const boqIds = boq.map((b) => b.id);

  const tasks = await snap(ctx, "tasks", await tx.task.findMany({ where: { contractId } }));
  const taskIds = tasks.map((t) => t.id);

  const vouchers = await snap(
    ctx,
    "vouchers",
    await tx.voucher.findMany({
      where: { OR: [{ contractId }, { boqItemId: { in: boqIds } }, { subContractId: { in: subIds } }] },
    })
  );
  const voucherIds = vouchers.map((v) => v.id);

  const links = voucherIds.length
    ? await snap(ctx, "voucher_payment_links", await tx.voucherPaymentLink.findMany({ where: { voucherId: { in: voucherIds } } }))
    : [];

  const addendums = await snap(ctx, "addendums", await tx.addendum.findMany({ where: { contractId } }));
  const addIds = addendums.map((a) => a.id);

  const addItems = addIds.length
    ? await snap(
        ctx,
        "addendum_items",
        await tx.addendumItem.findMany({ where: { OR: [{ addendumId: { in: addIds } }, { boqItemId: { in: boqIds } }] } })
      )
    : [];

  const claims = await snap(ctx, "claims", await tx.claim.findMany({ where: { contractId } }));
  const payments = await snap(ctx, "payment_plan", await tx.paymentPlanItem.findMany({ where: { contractId } }));
  const invoices = await snap(ctx, "invoices", await tx.invoice.findMany({ where: { contractId } }));
  const events = await snap(ctx, "contract_events", await tx.contractEvent.findMany({ where: { contractId } }));
  const scopes = await snap(ctx, "contract_scope", await tx.contractScope.findMany({ where: { contractId } }));
  const groupItems = await snap(ctx, "contract_group_items", await tx.contractGroupItem.findMany({ where: { contractId } }));
  const attachments = await snap(ctx, "contract_attachments", await tx.contractAttachment.findMany({ where: { contractId } }));
  const comments = await snap(ctx, "customer_comments", await tx.comment.findMany({ where: { contractId } }));
  const visits = taskIds.length
    ? await snap(ctx, "visits", await tx.visit.findMany({ where: { taskId: { in: taskIds } } }))
    : [];
  const journal = await snap(
    ctx,
    "journal_entries",
    await tx.journalEntry.findMany({
      where: { OR: [{ contractId }, { sourceType: "voucher", sourceId: { in: voucherIds } }] },
    })
  );

  bump(ctx, "vouchers", vouchers.length);
  bump(ctx, "payments", payments.length);
  bump(ctx, "stages", stages.length);
  bump(ctx, "addendums", addendums.length);
  bump(ctx, "claims", claims.length);
  bump(ctx, "invoices", invoices.length);
  bump(ctx, "subContracts", subs.length);
  bump(ctx, "comments", comments.length);
  bump(ctx, "tasks", tasks.length);
  bump(ctx, "visits", visits.length);
  bump(ctx, "attachments", attachments.length);
  bump(ctx, "boqItems", boq.length);
  bump(ctx, "subLines", subLines.length);
  bump(ctx, "subItems", subItems.length);
  bump(ctx, "subSources", subLines.length); // مصدر لكل خط باطن تقريبًا — يُحسب فعليًا أدناه
  bump(ctx, "paymentLinks", links.length);
  bump(ctx, "journal", journal.length);
  bump(ctx, "events", events.length);

  return { contract, subIds, subLineIds, voucherIds, addIds, boqIds, taskIds, attachments };
}

/** حذف تبعيات العقد والأب — الأبناء قبل الآباء (ضمن معاملة) */
async function deleteContractInTx(tx: Tx, contractId: number, ctx: PurgeCtx) {
  const collected = await collectContract(tx, contractId, ctx);
  if (!collected) return null;
  const { subIds, subLineIds, voucherIds, addIds, boqIds, taskIds, attachments } = collected;

  // عدّاد مصادر الباطن الفعلي
  if (subLineIds.length) {
    const n = await tx.subPaymentSource.count({ where: { subLineId: { in: subLineIds } } });
    bump(ctx, "subSources", n);
  }

  // 1) مصادر دفعات الباطن
  if (subLineIds.length) {
    const r = await tx.subPaymentSource.deleteMany({ where: { subLineId: { in: subLineIds } } });
    bump(ctx, "deleted", r.count);
  }
  // 2) خطوط دفع الباطن
  if (subIds.length) {
    const r = await tx.subPaymentPlanItem.deleteMany({ where: { subContractId: { in: subIds } } });
    bump(ctx, "deleted", r.count);
  }
  // 3) بنود عقود الباطن
  if (subIds.length) {
    const r = await tx.subContractItem.deleteMany({ where: { subContractId: { in: subIds } } });
    bump(ctx, "deleted", r.count);
  }
  // 4) عقود الباطن
  if (subIds.length) {
    const r = await tx.subContract.deleteMany({ where: { contractId } });
    bump(ctx, "deleted", r.count);
  }
  // 5) روابط الدفعات
  if (voucherIds.length) {
    const r = await tx.voucherPaymentLink.deleteMany({ where: { voucherId: { in: voucherIds } } });
    bump(ctx, "deleted", r.count);
  }
  // 6) قيود اليومية (بالعياد: contractId أو مصدرها السندات المحذوفة)
  const jr = await tx.journalEntry.deleteMany({
    where: { OR: [{ contractId }, { sourceType: "voucher", sourceId: { in: voucherIds } }] },
  });
  bump(ctx, "deleted", jr.count);
  // 7) السندات — فك ارتباط الأبناء (رسوم الأبناء) ثم الحذف
  if (voucherIds.length) {
    await tx.voucher.updateMany({ where: { parentVoucherId: { in: voucherIds } }, data: { parentVoucherId: null } });
    const r = await tx.voucher.deleteMany({ where: { id: { in: voucherIds } } });
    bump(ctx, "deleted", r.count);
  }
  // 8) أجزاء الملاحق
  if (addIds.length || boqIds.length) {
    const r = await tx.addendumItem.deleteMany({
      where: { OR: [{ addendumId: { in: addIds } }, { boqItemId: { in: boqIds } }] },
    });
    bump(ctx, "deleted", r.count);
  }
  // 9) الملاحق
  if (addIds.length) {
    const r = await tx.addendum.deleteMany({ where: { contractId } });
    bump(ctx, "deleted", r.count);
  }
  // 10) المطالبات
  const cr = await tx.claim.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", cr.count);
  // 11) خطة الدفعات
  const pr = await tx.paymentPlanItem.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", pr.count);
  // 12) بنود الكميات
  const br = await tx.boqItem.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", br.count);
  // 13) المراحل
  const sr = await tx.contractStage.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", sr.count);
  // 14) الأحداث
  const er = await tx.contractEvent.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", er.count);
  // 15) بنود مجموعات العقد (عمود عادي)
  const gri = await tx.contractGroupItem.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", gri.count);
  // 16) نطاق العقد
  const sc = await tx.contractScope.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", sc.count);
  // 17) مرفقات العقد (الصفوف — الملفات تُحذف من القرص بعد نجاح المعاملة)
  const ar = await tx.contractAttachment.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", ar.count);
  for (const a of attachments) {
    if (a.storedPath) ctx.attachmentFiles.push(a.storedPath);
  }
  // 18) تعليقات العقد
  const cm = await tx.comment.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", cm.count);
  // 19) زيارات مهام العقد (قبل المهام — قيد المفتاح)
  if (taskIds.length) {
    const vr = await tx.visit.deleteMany({ where: { taskId: { in: taskIds } } });
    bump(ctx, "deleted", vr.count);
  }
  // 20) مهام العقد
  const tr = await tx.task.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", tr.count);
  // 21) الفواتير
  const ir = await tx.invoice.deleteMany({ where: { contractId } });
  bump(ctx, "deleted", ir.count);
  // 22) العقد نفسه
  await tx.contract.delete({ where: { id: contractId } });
  bump(ctx, "deleted", 1);

  return collected.contract;
}

/** حذف تبعيات العميل والأب — عقوده أولًا ثم ما تبقى (ضمن معاملة) */
async function deleteCustomerInTx(tx: Tx, customerId: number, ctx: PurgeCtx) {
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;
  await snap(ctx, "customers", [customer]);

  const contracts = await tx.contract.findMany({ where: { customerId }, select: { id: true } });
  bump(ctx, "contracts", contracts.length);

  // 1) عقود العميل (كل تبعياتها) — الأبناء قبل الأب
  for (const c of contracts) {
    await deleteContractInTx(tx, c.id, ctx);
  }

  // 2) فواتير العميل المتبقية
  const inv = await tx.invoice.deleteMany({ where: { customerId } });
  bump(ctx, "deleted", inv.count);
  ctx.counters["invoices"] = (ctx.counters["invoices"] || 0) + inv.count;

  // 3) مجموعات العقد
  const groups = await snap(ctx, "contract_groups", await tx.contractGroup.findMany({ where: { customerId } }));
  const groupIds = groups.map((g) => g.id);
  if (groupIds.length) {
    const gi = await tx.contractGroupItem.deleteMany({ where: { groupId: { in: groupIds } } });
    bump(ctx, "deleted", gi.count);
    const g = await tx.contractGroup.deleteMany({ where: { customerId } });
    bump(ctx, "deleted", g.count);
  }
  bump(ctx, "groups", groups.length);

  // 4) تعليقات العميل
  const comments = await snap(ctx, "customer_comments", await tx.comment.findMany({ where: { customerId } }));
  const cm = await tx.comment.deleteMany({ where: { customerId } });
  bump(ctx, "deleted", cm.count);
  bump(ctx, "comments", comments.length);

  // 5) زيارات العميل (ومهامه المرتبطة بالزيارات أولًا)
  const custTasks = await snap(ctx, "tasks", await tx.task.findMany({ where: { customerId } }));
  const custTaskIds = custTasks.map((t) => t.id);
  const visits = await snap(
    ctx,
    "visits",
    await tx.visit.findMany({ where: { OR: [{ customerId }, { taskId: { in: custTaskIds } }] } })
  );
  const vr = await tx.visit.deleteMany({ where: { OR: [{ customerId }, { taskId: { in: custTaskIds } }] } });
  bump(ctx, "deleted", vr.count);
  bump(ctx, "visits", visits.length);

  // 6) مهام العميل
  const tr = await tx.task.deleteMany({ where: { customerId } });
  bump(ctx, "deleted", tr.count);
  bump(ctx, "tasks", custTasks.length);

  // 7) أسماء المطابقة (عمود عادي)
  const ma = await tx.matchAlias.deleteMany({ where: { customerId } });
  bump(ctx, "deleted", ma.count);

  // 8) العميل نفسه
  await tx.customer.delete({ where: { id: customerId } });
  bump(ctx, "deleted", 1);

  return customer;
}

/** عدّادات المعاينة — بلا أي كتابة */
async function previewCounters(kind: "contract" | "customer", id: number) {
  if (kind === "contract") {
    const contract = await db.contract.findUnique({ where: { id } });
    if (!contract) return null;
    const subIds = (await db.subContract.findMany({ where: { contractId: id }, select: { id: true } })).map((s) => s.id);
    const subLineIds = subIds.length
      ? (await db.subPaymentPlanItem.findMany({ where: { subContractId: { in: subIds } }, select: { id: true } })).map((l) => l.id)
      : [];
    const boqIds = (await db.boqItem.findMany({ where: { contractId: id }, select: { id: true } })).map((b) => b.id);
    const taskIds = (await db.task.findMany({ where: { contractId: id }, select: { id: true } })).map((t) => t.id);
    const voucherIds = (
      await db.voucher.findMany({
        where: { OR: [{ contractId: id }, { boqItemId: { in: boqIds } }, { subContractId: { in: subIds } }] },
        select: { id: true },
      })
    ).map((v) => v.id);
    const addIds = (await db.addendum.findMany({ where: { contractId: id }, select: { id: true } })).map((a) => a.id);

    const counters: Record<string, number> = {
      vouchers: voucherIds.length,
      payments: await db.paymentPlanItem.count({ where: { contractId: id } }),
      stages: await db.contractStage.count({ where: { contractId: id } }),
      addendums: addIds.length,
      claims: await db.claim.count({ where: { contractId: id } }),
      invoices: await db.invoice.count({ where: { contractId: id } }),
      subContracts: subIds.length,
      comments: await db.comment.count({ where: { contractId: id } }),
      tasks: taskIds.length,
      visits: taskIds.length ? await db.visit.count({ where: { taskId: { in: taskIds } } }) : 0,
      attachments: await db.contractAttachment.count({ where: { contractId: id } }),
      boqItems: boqIds.length,
      subLines: subLineIds.length,
      subItems: subIds.length ? await db.subContractItem.count({ where: { subContractId: { in: subIds } } }) : 0,
      subSources: subLineIds.length ? await db.subPaymentSource.count({ where: { subLineId: { in: subLineIds } } }) : 0,
      paymentLinks: voucherIds.length ? await db.voucherPaymentLink.count({ where: { voucherId: { in: voucherIds } } }) : 0,
      journal: await db.journalEntry.count({
        where: { OR: [{ contractId: id }, { sourceType: "voucher", sourceId: { in: voucherIds } }] },
      }),
      events: await db.contractEvent.count({ where: { contractId: id } }),
    };
    return { entity: contract, counters };
  }

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return null;
  const contractIds = (await db.contract.findMany({ where: { customerId: id }, select: { id: true } })).map((c) => c.id);
  const counters: Record<string, number> = {
    contracts: contractIds.length,
    invoices: await db.invoice.count({ where: { customerId: id } }),
    comments: await db.comment.count({ where: { customerId: id } }),
    tasks: await db.task.count({ where: { customerId: id } }),
    visits: await db.visit.count({ where: { customerId: id } }),
    groups: await db.contractGroup.count({ where: { customerId: id } }),
    vouchers: contractIds.length ? await db.voucher.count({ where: { contractId: { in: contractIds } } }) : 0,
    addendums: contractIds.length ? await db.addendum.count({ where: { contractId: { in: contractIds } } }) : 0,
    claims: contractIds.length ? await db.claim.count({ where: { contractId: { in: contractIds } } }) : 0,
    subContracts: contractIds.length ? await db.subContract.count({ where: { contractId: { in: contractIds } } }) : 0,
    attachments: contractIds.length
      ? await db.contractAttachment.count({ where: { contractId: { in: contractIds } } })
      : 0,
  };
  return { entity: customer, counters };
}

const TREE_LABELS: Record<string, string> = {
  contracts: "العقود",
  vouchers: "السندات",
  payments: "دفعات الخطة",
  stages: "المراحل",
  addendums: "الملاحق",
  claims: "المطالبات",
  invoices: "الفواتير",
  subContracts: "عقود الباطن",
  subLines: "خطوط باطن",
  subItems: "بنود الباطن",
  subSources: "مصادر الباطن",
  paymentLinks: "روابط الدفعات",
  comments: "التعليقات",
  tasks: "المهام",
  visits: "الزيارات",
  attachments: "المرفقات",
  boqItems: "بنود الكميات",
  journal: "قيود اليومية",
  events: "الأحداث",
  groups: "مجموعات العقود",
  deleted: "إجمالي المحذوف",
};

const ENTITY_KINDS = ["contract", "customer"] as const;

/** سجل المحو PurgeAudit — GET ?kind=&q= */
export async function GET(req: NextRequest) {
  const guard = await developerGuard(req);
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const kind = (sp.get("kind") || "").trim();
  const q = (sp.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 500);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  const where: Prisma.PurgeAuditWhereInput = {};
  if (kind) where.entity = kind;
  if (q) {
    where.OR = [
      { label: { contains: q } },
      { reason: { contains: q } },
      { purgedBy: { contains: q } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.purgeAudit.findMany({ where, orderBy: { id: "desc" }, take: limit, skip: offset }),
    db.purgeAudit.count({ where }),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    purgedAt: r.purgedAt,
    purgedBy: r.purgedBy,
    entity: r.entity,
    entityId: r.entityId,
    label: r.label,
    reason: r.reason,
    snapshotSize: r.snapshot.length,
  }));

  return ok({ items, total });
}

/** معاينة/تنفيذ المحو — POST {action:'preview'|'execute', kind, id, reason} */
export async function POST(req: NextRequest) {
  const guard = await developerGuard(req);
  if ("response" in guard) return guard.response;
  const username = guard.user.username;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    kind?: string;
    id?: number;
    reason?: string;
  };

  const action = body.action === "preview" ? "preview" : body.action === "execute" ? "execute" : "";
  if (!action) return jsonError("الإجراء غير صحيح — المطلوب action: 'preview' أو 'execute'");

  const kind = (ENTITY_KINDS as readonly string[]).includes(String(body.kind))
    ? (body.kind as "contract" | "customer")
    : null;
  if (!kind) return jsonError("النوع غير صحيح — المطلوب kind: 'contract' أو 'customer'");

  const id = Number(body.id) || 0;
  if (id <= 0) return jsonError("المعرف الرقمي للكيان مطلوب");

  // ===== المعاينة: شجرة التبعيات بلا تنفيذ =====
  if (action === "preview") {
    const res = await previewCounters(kind, id);
    if (!res) {
      return jsonError(kind === "contract" ? "العقد غير موجود" : "العميل غير موجود", 404);
    }
    const { entity, counters } = res;
    const label =
      kind === "contract"
        ? `عقد ${(entity as { contractNumber: string }).contractNumber} — ${(entity as { contractName: string }).contractName || "بلا اسم"}`
        : `عميل ${(entity as { customerCode: string }).customerCode} — ${(entity as { name: string }).name}`;
    const total = Object.entries(counters).reduce(
      (acc, [k, n]) => acc + (k === "contracts" || k === "journal" || k === "events" || k === "subSources" || k === "subItems" || k === "paymentLinks" || k === "boqItems" ? 0 : n),
      0
    );
    return ok({
      preview: true,
      kind,
      id,
      label,
      tree: Object.entries(counters).map(([key, count]) => ({ key, label: TREE_LABELS[key] || key, count })),
      total,
    });
  }

  // ===== التنفيذ: لقطة ثم حذف ضمن معاملة =====
  const reason = String(body.reason || "").trim();
  if (!reason) return jsonError("سبب المحو إلزامي");

  const exists =
    kind === "contract"
      ? await db.contract.findUnique({ where: { id }, select: { id: true } })
      : await db.customer.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError(kind === "contract" ? "العقد غير موجود" : "العميل غير موجود", 404);

  const ctx: PurgeCtx = { counters: {}, snapshot: [], attachmentFiles: [] };
  let auditId = 0;
  let label = "";

  try {
    await db.$transaction(async (tx) => {
      // 1) جمع الصفوف (لقطة كاملة قبل الحذف)
      if (kind === "contract") {
        const contract = await tx.contract.findUnique({ where: { id } });
        if (contract) {
          label = `عقد ${contract.contractNumber} — ${contract.contractName || "بلا اسم"}`;
        }
        await deleteContractInTx(tx, id, ctx);
      } else {
        const customer = await tx.customer.findUnique({ where: { id } });
        if (customer) {
          label = `عميل ${customer.customerCode} — ${customer.name}`;
        }
        await deleteCustomerInTx(tx, id, ctx);
      }

      if (!label) throw new Error("تعذر العثور على الكيان أثناء المعاملة");

      // 2) لقطة PurgeAudit داخل المعاملة نفسها
      const pa = await tx.purgeAudit.create({
        data: {
          purgedBy: username,
          entity: kind,
          entityId: id,
          label,
          reason,
          snapshot: JSON.stringify({ main: label, counters: ctx.counters, sections: ctx.snapshot }),
        },
      });
      auditId = pa.id;

      // 3) سطر تدقيق
      await audit(tx, {
        username,
        action: "محو كيان",
        entityType: kind,
        entityId: id,
        entityName: label,
        reason,
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`فشل المحو — لم يُحذف شيء: ${msg}`, 500);
  }

  // 4) حذف ملفات المرفقات من القرص بعد نجاح المعاملة
  let filesRemoved = 0;
  for (const p of ctx.attachmentFiles) {
    try {
      if (p.startsWith(ATTACH_DIR) && fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
        filesRemoved += 1;
      }
    } catch {
      /* تجاهل فشل حذف ملف واحد */
    }
  }

  return ok({
    purged: true,
    auditId,
    label,
    counts: ctx.counters,
    filesRemoved,
    message: `تم محو ${label} بنجاح — محفوظة لقطة كاملة في سجل المحو رقم #${auditId}`,
  });
}
