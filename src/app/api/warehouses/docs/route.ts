// GET/POST /api/warehouses/docs — قائمة أذون المخازن + إنشاء إذن (مرحّل بقيد فوري — لا مسودات)
// docs/warehouses-design.md §4/§5 — المعاملة الواحدة: ترقيم + رأس + أسطر + لقطات + قيد + audit.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, nextNumber, ok, parseDay } from "@/lib/api-utils";
import { TX_OPTS } from "@/lib/journal-server";
import { DOC_KINDS, DOC_PREFIXES, r3, type DocKind } from "@/lib/warehouses-constants";
import {
  docMovements,
  validateAvailability,
  validateStockDoc,
  type DocHeadInput,
  type DocLineInput,
} from "@/lib/warehouses-core";
import { loadBalances, loadStockMovements, postStockDocJournal } from "@/lib/warehouses-server";

const KIND_LABELS: Record<DocKind, string> = { entry: "إدخال", issue: "صرف", transfer: "تحويل", count: "جرد" };

/** GET: قائمة الأذون بفلاتر (نوع/حالة/مستودع/عقد/فترة) — الأحدث أولًا */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const where: Record<string, unknown> = {};
  const kind = sp.get("kind") ?? "";
  if (kind && (DOC_KINDS as readonly string[]).includes(kind)) where.kind = kind;
  const status = sp.get("status") ?? "";
  if (status === "posted" || status === "cancelled") where.status = status;
  const warehouseId = Number(sp.get("warehouseId") ?? "");
  if (Number.isFinite(warehouseId) && warehouseId > 0) {
    // المستودع مصدرًا أو مستهدفًا (لأذون التحويل)
    where.OR = [{ warehouseId }, { targetWarehouseId: warehouseId }];
  }
  const contractId = Number(sp.get("contractId") ?? "");
  if (Number.isFinite(contractId) && contractId > 0) where.contractId = contractId;
  const from = parseDay(sp.get("from") ?? "");
  const to = parseDay(sp.get("to") ?? "");
  if (from || to) {
    where.vdate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  const docs = await db.stockDoc.findMany({
    where,
    orderBy: { id: "desc" },
    take: 200,
    select: {
      id: true, docNumber: true, kind: true, entrySource: true, vdate: true,
      warehouseId: true, targetWarehouseId: true, contractId: true, party: true,
      totalAmount: true, status: true, cancelReason: true, cancelledAt: true, notes: true,
      createdBy: true, createdAt: true,
      warehouse: { select: { name: true } },
      targetWarehouse: { select: { name: true } },
      contract: { select: { contractNumber: true, contractName: true } },
      _count: { select: { lines: true } },
    },
  });

  return ok({
    docs: docs.map((d) => ({
      id: d.id,
      docNumber: d.docNumber,
      kind: d.kind,
      kindLabel: KIND_LABELS[d.kind as DocKind] ?? d.kind,
      entrySource: d.entrySource,
      vdate: d.vdate,
      warehouseId: d.warehouseId,
      warehouseName: d.warehouse.name,
      targetWarehouseId: d.targetWarehouseId,
      targetWarehouseName: d.targetWarehouse?.name ?? "",
      contractId: d.contractId,
      contractNumber: d.contract?.contractNumber ?? "",
      contractName: d.contract?.contractName ?? "",
      party: d.party,
      totalAmount: r3(Number(d.totalAmount)),
      lineCount: d._count.lines,
      status: d.status,
      cancelReason: d.cancelReason,
      cancelledAt: d.cancelledAt,
      notes: d.notes,
      createdBy: d.createdBy,
    })),
  });
}

/** POST: إنشاء إذن جديد — التحقق النقي ثم المعاملة الواحدة (مستند + أسطر + لقطات + قيد + audit) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = String(body.kind ?? "");
  if (!(DOC_KINDS as readonly string[]).includes(kind)) return jsonError("نوع الإذن غير معروف");
  const vdate = parseDay(body.vdate);
  if (!vdate) return jsonError("تاريخ الإذن مطلوب بصيغة YYYY-MM-DD");
  const warehouseId = Number(body.warehouseId ?? 0);
  const targetWarehouseId = Number(body.targetWarehouseId ?? 0) || null;
  const contractId = Number(body.contractId ?? 0) || null;
  const payAccountId = Number(body.payAccountId ?? 0) || null;
  const party = String(body.party ?? "").trim();
  const notes = String(body.notes ?? "").trim();
  const entrySource = kind === "entry" ? String(body.entrySource ?? "") : "";

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) return jsonError("الإذن بلا أسطر — أضف صنفًا واحدًا على الأقل");
  const parsedLines: DocLineInput[] = [];
  for (const rl of rawLines) {
    const l = (rl ?? {}) as Record<string, unknown>;
    parsedLines.push({
      itemId: Number(l.itemId ?? 0),
      boqItemId: Number(l.boqItemId ?? 0) || null,
      qty: r3(Number(l.qty ?? 0)),
      countedQty: r3(Number(l.countedQty ?? 0)),
      snapUnitCost: r3(Number(l.snapUnitCost ?? 0)), // للصرف/الجرد يعيد الخادم اشتقاقه — مدخل العميل يُتجاهل
      note: String(l.note ?? "").trim(),
    });
  }

  const head: DocHeadInput = {
    kind: kind as DocHeadInput["kind"],
    entrySource: entrySource as DocHeadInput["entrySource"],
    vdate,
    warehouseId,
    targetWarehouseId,
    contractId,
    payAccountId,
    party,
  };

  // 1) التحقق النقي (جدول القواعد المغلق — G8)
  const coreErrors = validateStockDoc(head, parsedLines);
  if (coreErrors.length > 0) return jsonError(coreErrors[0]);

  // 2) التحقق المرجعي (الكيانات موجودة ونشطة — والبند يعود لعقد الإذن)
  const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId }, select: { id: true, name: true, active: true } });
  if (!warehouse) return jsonError("المستودع غير موجود", 404);
  if (!warehouse.active && kind !== "count") return jsonError("المستودع موقوف — لا أذون جديدة عليه");
  let targetName = "";
  if (targetWarehouseId) {
    const target = await db.warehouse.findFirst({ where: { id: targetWarehouseId }, select: { id: true, name: true, active: true } });
    if (!target) return jsonError("المستودع المستهدف غير موجود", 404);
    if (!target.active) return jsonError("المستودع المستهدف موقوف");
    targetName = target.name;
  }
  let contractNumber: string | null = null;
  if (contractId) {
    const contract = await db.contract.findFirst({ where: { id: contractId }, select: { id: true, contractNumber: true, status: true } });
    if (!contract) return jsonError("العقد غير موجود", 404);
    if (contract.status === "ملغى" || contract.status === "مسودة")
      return jsonError(`العقد ${contract.contractNumber} ${contract.status === "ملغى" ? "ملغى" : "مسودة"} — لا صرف مخزني عليه`);
    contractNumber = contract.contractNumber;
    const boqIds = parsedLines.map((l) => l.boqItemId).filter((x): x is number => x != null);
    if (boqIds.length > 0) {
      const boqRows = await db.boqItem.findMany({
        where: { id: { in: boqIds }, contractId, deleted: false },
        select: { id: true },
      });
      if (boqRows.length !== new Set(boqIds).size) return jsonError("أحد بنود الكميات المرتبطة لا يعود لعقد الإذن");
    }
  }
  const itemIds = Array.from(new Set(parsedLines.map((l) => l.itemId)));
  const items = await db.stockItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, active: true } });
  if (items.length !== itemIds.length) return jsonError("أحد الأصناف غير موجود", 404);
  const inactive = items.filter((i) => !i.active && kind !== "count");
  if (inactive.length > 0) return jsonError(`الصنف «${inactive[0].name}» موقوف — لا حركة جديدة عليه`);
  const itemNames = new Map(items.map((i) => [i.id, i.name]));
  const whNames = new Map<number, string>([[warehouseId, warehouse.name]]);
  if (targetWarehouseId) whNames.set(targetWarehouseId, targetName);

  // 3) اشتقاق أسعار اللقطات: الصرف/الجرد من المتوسط المرجح الاشتقاقي (الخادم حصرًا — د2)
  if (kind === "issue" || kind === "count" || kind === "transfer") {
    const { balances: bal } = await loadBalances();
    for (const l of parsedLines) {
      const b = bal.find((x) => x.itemId === l.itemId && x.warehouseId === warehouseId);
      l.snapUnitCost = b && b.qty > 0 ? b.wac : 0;
    }
    if (kind === "count") {
      // الجرد: الفرق = المفحوص − المسجّل يُشتق هنا ويجمَّد على السطر
      for (const l of parsedLines) {
        const b = bal.find((x) => x.itemId === l.itemId && x.warehouseId === warehouseId);
        l.qty = r3((l.countedQty ?? 0) - (b?.qty ?? 0));
      }
      for (let i = parsedLines.length - 1; i >= 0; i--) {
        if (parsedLines[i].qty === 0) parsedLines.splice(i, 1); // التطابق لا سطر له
      }
      if (parsedLines.length === 0) return jsonError("الجرد مطابق تمامًا — لا فروق ليقيّدها إذن");
    }
  }

  // 4) فحص السالب بإعادة تشغيل الخط الزمني (د4 — درس G9)
  const existingMovements = await loadStockMovements();
  const incoming = docMovements(head, parsedLines);
  const violations = validateAvailability(existingMovements, incoming);
  if (violations.length > 0) {
    const v = violations[0];
    const itemName = itemNames.get(v.itemId) ?? `#${v.itemId}`;
    const whName = whNames.get(v.warehouseId) ?? `#${v.warehouseId}`;
    return jsonError(
      `الكمية غير متوفرة — الصنف «${itemName}» بمستودع «${whName}»: المتاح ${v.available} والمطلوب ${v.required}`
    );
  }

  const totalAmount = r3(parsedLines.reduce((s, l) => s + Math.abs(r3(l.qty * l.snapUnitCost)), 0));

  // 5) المعاملة الواحدة: ترقيم + رأس + أسطر + قيد + audit (نمط payroll approve)
  const result = await db.$transaction(async (tx) => {
    const docNumber = await nextNumber(DOC_PREFIXES[kind as DocKind], 4, tx);
    const payAccountName = payAccountId
      ? ((await tx.account.findFirst({ where: { id: payAccountId }, select: { name: true } }))?.name ?? "")
      : "";
    const doc = await tx.stockDoc.create({
      data: {
        docNumber,
        kind,
        entrySource,
        vdate,
        warehouseId,
        targetWarehouseId,
        contractId,
        party,
        payAccountId,
        payAccountName,
        totalAmount,
        status: "posted",
        notes,
        createdBy: guard.user.username,
      },
    });
    await tx.stockDocLine.createMany({
      data: parsedLines.map((l) => ({
        docId: doc.id,
        itemId: l.itemId,
        boqItemId: l.boqItemId ?? null,
        qty: l.qty,
        countedQty: kind === "count" ? l.countedQty ?? 0 : 0,
        snapUnitCost: l.snapUnitCost,
        amount: r3(l.qty * l.snapUnitCost),
        note: l.note ?? "",
      })),
    });
    const journal = await postStockDocJournal(
      tx,
      {
        docNumber,
        kind,
        entrySource,
        vdate,
        warehouseId,
        contractId,
        contractNumber,
        party,
        payAccountId,
        payAccountName,
        totalAmount,
      },
      parsedLines.map((l) => ({
        itemId: l.itemId,
        boqItemId: l.boqItemId ?? null,
        qty: l.qty,
        snapUnitCost: l.snapUnitCost,
        amount: r3(l.qty * l.snapUnitCost),
      })),
      guard.user.username
    );
    if (journal.journalEntryId) {
      await tx.stockDoc.update({ where: { id: doc.id }, data: { journalEntryId: journal.journalEntryId } });
    }
    await audit(tx, {
      username: guard.user.username,
      action: "إنشاء",
      entityType: "stock_doc",
      entityId: doc.id,
      entityName: `${docNumber} (${KIND_LABELS[kind as DocKind]})`,
      newStatus: "posted",
    });
    return { docId: doc.id, docNumber, journalEntryId: journal.journalEntryId, totalAmount };
  }, TX_OPTS);

  return ok(result, 201);
}
