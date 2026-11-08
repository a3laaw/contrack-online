// ============================================================
// ConTrack Online — موديول المخازن: طبقة الخادم (docs/warehouses-design.md §4/§5)
// البذر المؤجل للحسابات + بناء الحركة الموحدة من الأذون + نشر القيود عبر
// المحرك الموحد postJournalEntry حصرًا (لا مسار كتابة ثانٍ للأستاذ — خط واحد).
// ============================================================

import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { postJournalEntry, type Tx } from "@/lib/journal-server";
import type { JournalLineDims, JournalLineInput } from "@/lib/journal-server";
import { r3 } from "@/lib/warehouses-constants";
import { WAREHOUSE_ACCOUNTS } from "@/lib/warehouses-constants";
import {
  computeBalances,
  docMovements,
  type DocHeadInput,
  type DocLineInput,
  type MovementInput,
  type StockBalance,
} from "@/lib/warehouses-core";

type Client = Tx | PrismaClient;

/** خادم المخازن يستهلك نفس أنواع النواة */
export type { StockBalance, MovementInput };

async function accountByCode(client: Client, code: string, type: string) {
  return client.account.findFirst({ where: { code, type }, select: { id: true, code: true, name: true } });
}

/**
 * ضمان حسابي المخازن في دليل الشركة — بذر مؤجل عند أول قيد يحتاجهما (د9 — نمط ensureOne في hr-server):
 * 1160 «مخزون المواد» شقيق 1150 · 5115 «فروق الجرد والهدر» شقيق 5110 — بنفس الأب وبنفس بنية الشجرة.
 */
export async function ensureWarehouseAccounts(
  tx: Tx
): Promise<{ stock: { id: number; name: string }; countDiff: { id: number; name: string } }> {
  const [stock, countDiff] = await Promise.all([
    accountByCode(tx, WAREHOUSE_ACCOUNTS.stock.code, WAREHOUSE_ACCOUNTS.stock.type),
    accountByCode(tx, WAREHOUSE_ACCOUNTS.countDiff.code, WAREHOUSE_ACCOUNTS.countDiff.type),
  ]);

  async function ensureOne(
    existing: { id: number; name: string } | null,
    def: { code: string; name: string; type: string; xbrl: string },
    siblingCode: string
  ): Promise<{ id: number; name: string }> {
    if (existing) return existing;
    const sibling = await tx.account.findFirst({
      where: { code: siblingCode, type: def.type },
      select: { parentId: true },
    });
    if (!sibling) {
      throw new Error(`حساب «${def.name}» (${def.code}) مطلوب وغير موجود في الدليل — بذِر الدليل القياسي أولًا`);
    }
    const created = await tx.account.create({
      data: {
        code: def.code,
        name: def.name,
        type: def.type,
        nature: def.type === "asset" || def.type === "expense" ? "debit" : "credit",
        parentId: sibling.parentId,
        isLeaf: true,
        allowPosting: true,
        isActive: true,
        isSystem: true,
        notes: "المخازن — بذر مؤجل عند أول قيد (docs/warehouses-design.md §5 — د9)",
        xbrlElement: def.xbrl,
      },
    });
    return { id: created.id, name: created.name };
  }

  return {
    stock: await ensureOne(stock, WAREHOUSE_ACCOUNTS.stock, "1150"),
    countDiff: await ensureOne(countDiff, WAREHOUSE_ACCOUNTS.countDiff, "5110"),
  };
}

/** حساب ثابت بالكود من دليل الشركة — القصور رسالة عربية واضحة (نمط HR) */
async function requireAccount(client: Client, code: string, type: string): Promise<{ id: number; name: string }> {
  const acc = await accountByCode(client, code, type);
  if (!acc) throw new Error(`حساب «${code}» مطلوب وغير موجود في دليل الشركة — بذِر الدليل القياسي أولًا`);
  return acc;
}

/** رأس إذن كما تُقرأ من DB → مدخل النواة */
export function docHeadOf(
  doc: {
    kind: string;
    entrySource: string;
    vdate: string;
    warehouseId: number;
    targetWarehouseId: number | null;
    contractId: number | null;
    payAccountId: number | null;
    status: string;
  }
): DocHeadInput {
  return {
    kind: doc.kind as DocHeadInput["kind"],
    entrySource: doc.entrySource as DocHeadInput["entrySource"],
    vdate: doc.vdate,
    warehouseId: doc.warehouseId,
    targetWarehouseId: doc.targetWarehouseId,
    contractId: doc.contractId,
    payAccountId: doc.payAccountId,
    status: doc.status as DocHeadInput["status"],
  };
}

/** أسطر إذن كما تُقرأ من DB → مدخل النواة */
export function docLinesOf(
  lines: { itemId: number; boqItemId: number | null; qty: unknown; countedQty: unknown; snapUnitCost: unknown; note?: string }[]
): DocLineInput[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    boqItemId: l.boqItemId,
    qty: Number(l.qty),
    countedQty: Number(l.countedQty ?? 0),
    snapUnitCost: Number(l.snapUnitCost),
    note: l.note ?? "",
  }));
}

/** بناء الحركة الموحدة من أذون الشركة (المرحّلة حصرًا — الملغاة شفافة تلقائيًا في النواة) */
export async function loadStockMovements(): Promise<MovementInput[]> {
  const docs = await db.stockDoc.findMany({
    where: { status: "posted" },
    select: {
      kind: true, entrySource: true, vdate: true, warehouseId: true,
      targetWarehouseId: true, contractId: true, payAccountId: true, status: true,
      lines: { select: { itemId: true, boqItemId: true, qty: true, countedQty: true, snapUnitCost: true, note: true } },
    },
  });
  const movements: MovementInput[] = [];
  for (const d of docs) movements.push(...docMovements(docHeadOf(d), docLinesOf(d.lines)));
  return movements;
}

/** أرصدة الشركة الاشتقاقية حتى تاريخ (اختياري) مع أسماء الأصناف والمستودعات */
export async function loadBalances(asOf?: string): Promise<{
  balances: (StockBalance & { itemName: string; unit: string; category: string; minQty: number; warehouseName: string; belowMin: boolean })[];
  totals: { qty: number; value: number };
}> {
  const [movements, items, warehouses] = await Promise.all([
    loadStockMovements(),
    db.stockItem.findMany({ select: { id: true, name: true, unit: true, category: true, minQty: true, active: true } }),
    db.warehouse.findMany({ select: { id: true, name: true, active: true } }),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const whById = new Map(warehouses.map((w) => [w.id, w]));
  const raw = computeBalances(movements, asOf);
  const balances = raw
    .filter((b) => itemById.has(b.itemId) && whById.has(b.warehouseId))
    .map((b) => {
      const item = itemById.get(b.itemId)!;
      const wh = whById.get(b.warehouseId)!;
      return {
        ...b,
        itemName: item.name,
        unit: item.unit,
        category: item.category,
        minQty: Number(item.minQty),
        warehouseName: wh.name,
        belowMin: Number(item.minQty) > 0 && b.qty <= Number(item.minQty),
      };
    });
  const totals = {
    qty: r3(balances.reduce((s, b) => s + b.qty, 0)),
    value: r3(balances.reduce((s, b) => s + b.value, 0)),
  };
  return { balances, totals };
}

// ==================== نشر قيود الأذون (§5) ====================

export interface PostedDocJournal {
  journalEntryId: number | null; // التحويل بلا قيد
}

/**
 * نشر قيد الإذن حسب نوعه (الجدول §5 من التصميم) — عبر postJournalEntry حصرًا:
 * • إدخال نقدي: مدين 1160 ↔ دائن حساب الدفع · آجل: دائن 2111 · مرتجع موقع: دائن 5110 ببُعد العقد
 * • صرف: مدين 5110 بسطر لكل بند (بُعد العقد وبُعد بند BOQ عند الربط) ↔ دائن 1160
 *   — وفرع البيع (docs/sales-design.md د4): صرف آلي مرتبط بفاتورة بيع ⇒ مدين **5116 تكلفة المبيعات** بلا بُعد عقد
 * • جرد: نقص مدين 5115/دائن 1160 والزيادة بعكسها — سطر لكل فرق
 * • تحويل: بلا قيد (نقل موقع لا قيمة)
 */
export async function postStockDocJournal(
  tx: Tx,
  doc: {
    docNumber: string;
    kind: string;
    entrySource: string;
    vdate: string;
    warehouseId: number;
    contractId: number | null;
    contractNumber?: string | null;
    /** المبيعات: إذن الصرف الآلي المرتبط بفاتورة بيع — يبدّل مدين الصرف من 5110 إلى 5116 (د4) */
    saleInvoiceId?: number | null;
    saleInvoiceNumber?: string | null;
    /** معرف حساب 5116 (يجب أن يمرّه مستدعي المبيعات بعد البذر المؤجل — لا استيراد معكوس) */
    saleCostAccountId?: number | null;
    party: string;
    payAccountId: number | null;
    payAccountName: string;
    totalAmount: number;
  },
  lines: { itemId: number; boqItemId: number | null; qty: number; snapUnitCost: number; amount: number }[],
  actor: string
): Promise<PostedDocJournal> {
  const accounts = await ensureWarehouseAccounts(tx);

  // التحويل — بلا قيد عمدًا (أصل واحد داخل الشركة)
  if (doc.kind === "transfer") return { journalEntryId: null };

  const contractLabel = doc.contractNumber ? ` — عقد ${doc.contractNumber}` : "";

  if (doc.kind === "entry") {
    const stockAcc = accounts.stock;
    let creditAcc: { id: number; name: string };
    let creditLine: JournalLineInput;
    if (doc.entrySource === "cash") {
      if (!doc.payAccountId) throw new Error("الإدخال النقدي يتطلب حساب الدفع");
      creditAcc = { id: doc.payAccountId, name: doc.payAccountName || "حساب الدفع" };
      creditLine = { accountId: creditAcc.id, debit: 0, credit: doc.totalAmount, description: `نقد ${doc.party ? `— ${doc.party}` : ""}` };
    } else if (doc.entrySource === "credit") {
      creditAcc = await requireAccount(tx, "2111", "liability");
      creditLine = { accountId: creditAcc.id, debit: 0, credit: doc.totalAmount, description: `مورد ${doc.party}`.trim() };
    } else {
      // مرتجع موقع — يخفض تكلفة المواد على العقد (بُعد العقد إلزامي هنا)
      creditAcc = await requireAccount(tx, "5110", "expense");
      creditLine = {
        accountId: creditAcc.id, debit: 0, credit: doc.totalAmount,
        description: `مرتجع مواد من الموقع${contractLabel}`,
        ...(doc.contractId ? { contractId: doc.contractId } : {}),
      };
    }
    const posted = await postJournalEntry(
      tx,
      {
        entryDate: doc.vdate,
        description: `إذن إدخال مخزني ${doc.docNumber}${doc.entrySource === "return" ? " (مرتجع موقع)" : ""}${contractLabel}`,
        sourceType: "inventory_entry",
        lines: [
          { accountId: stockAcc.id, debit: doc.totalAmount, credit: 0, description: `مخزون المواد ${doc.party ? `— ${doc.party}` : ""}`.trim() },
          creditLine,
        ],
      },
      actor
    );
    return { journalEntryId: posted.id };
  }

  if (doc.kind === "issue") {
    const stockAcc = accounts.stock;
    // فرع البيع (docs/sales-design.md د4): صرف آلي على فاتورة بيع — تكلفة المبيعات 5116، بلا بُعد عقد.
    // حساب 5116 يمرّر مسبقًا من مستدعي المبيعات (بذر مؤجل عنده — لا دورة استيراد مع sales-server).
    if (doc.saleInvoiceId) {
      if (!doc.saleCostAccountId) {
        throw new Error("حساب تكلفة المبيعات مطلوب لإذن صرف البيع — بذِر المبيعات أولًا (د4)");
      }
      const saleLabel = doc.saleInvoiceNumber ? ` ${doc.saleInvoiceNumber}` : "";
      const linesIn: JournalLineInput[] = lines.map((l) => ({
        accountId: doc.saleCostAccountId as number,
        debit: l.amount,
        credit: 0,
        description: `تكلفة المبيعات${saleLabel}`,
      }));
      linesIn.push({ accountId: stockAcc.id, debit: 0, credit: doc.totalAmount, description: "مخزون المواد" });
      const salePosted = await postJournalEntry(
        tx,
        {
          entryDate: doc.vdate,
          description: `إذن صرف بيع آلي ${doc.docNumber}${saleLabel}`,
          sourceType: "inventory_issue",
          lines: linesIn,
        },
        actor
      );
      return { journalEntryId: salePosted.id };
    }
    const materialsAcc = await requireAccount(tx, "5110", "expense");
    const linesIn: JournalLineInput[] = lines.map((l) => ({
      accountId: materialsAcc.id,
      debit: l.amount,
      credit: 0,
      description: "صرف مواد للموقع",
      ...(doc.contractId ? { contractId: doc.contractId } : {}),
      ...(l.boqItemId ? { boqItemId: l.boqItemId } : {}),
    }));
    linesIn.push({ accountId: stockAcc.id, debit: 0, credit: doc.totalAmount, description: "مخزون المواد" });
    const posted = await postJournalEntry(
      tx,
      {
        entryDate: doc.vdate,
        description: `إذن صرف مخزني ${doc.docNumber}${contractLabel}`,
        sourceType: "inventory_issue",
        lines: linesIn,
      },
      actor
    );
    return { journalEntryId: posted.id };
  }

  // الجرد — فرق القيمة فقط: نقص مدين 5115/دائن 1160 · زيادة بعكسها
  const stockAcc = accounts.stock;
  const diffAcc = accounts.countDiff;
  const linesIn: JournalLineInput[] = [];
  for (const l of lines) {
    if (l.amount < 0) {
      linesIn.push({ accountId: diffAcc.id, debit: r3(-l.amount), credit: 0, description: "نقص/هدر جرد" });
      linesIn.push({ accountId: stockAcc.id, debit: 0, credit: r3(-l.amount), description: "مخزون المواد" });
    } else if (l.amount > 0) {
      linesIn.push({ accountId: stockAcc.id, debit: l.amount, credit: 0, description: "زيادة جرد" });
      linesIn.push({ accountId: diffAcc.id, debit: 0, credit: l.amount, description: "فروق الجرد" });
    }
  }
  if (linesIn.length === 0) return { journalEntryId: null }; // جرد بلا فروق قيمية
  const posted = await postJournalEntry(
    tx,
    {
      entryDate: doc.vdate,
      description: `إذن جرد مخزني ${doc.docNumber}${contractLabel}`,
      sourceType: "inventory_count",
      lines: linesIn,
    },
    actor
  );
  return { journalEntryId: posted.id };
}

/** أبعاد سطر القيد الموثقة — مرجع داخلي */
export type { JournalLineDims };
