import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";
import { computeSubPlan } from "@/lib/voucher-server";
import { buildXlsxBuffer, XLSX_MIME, type XlsxSheet } from "@/lib/xlsx-core";

type P = { params: Promise<{ id: string }> };

/**
 * تصدير كتل الدفعات — GET /api/contracts/[id]/pay-export [&format=xlsx|csv] (الافتراضي csv)
 * المرجع المكتبي: ui/contract_hub.py::_export_pay_view (1332): جدول لكل كتلة
 * (العميل ثم كل مقاول) مع قسم «بنود …» أسفل جدول كل مقاول ثم صفوف الإجماليات.
 * المرحلة 8: xlsx حقيقي — ورقة لكل كتلة + ورقة بنود لكل مقاول + ورقة إجماليات.
 */

const HEADS = ["العنوان", "الاستحقاق", "المبلغ", "المغطى", "المتبقي", "الحالة"];
const ITEM_HEADS = ["الوصف", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"];

function esc(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface PayBlock {
  title: string;
  lines: { title: string; dueDate: string; amountN: number; covered: number; remaining: number; stateLabel?: string }[];
  hasPlan: boolean;
  totals: { due: number; paid: number };
  items: { description: string; qty: number; unit: string; unitPrice: number; amount: number }[];
}

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);

  const cur = core.contract.currency || "د.ك";
  const money = (n: number) => `${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${cur}`;

  const lineRows = (lines: PayBlock["lines"]) =>
    lines.map((l) => [l.title, l.dueDate, money(l.amountN), money(l.covered), money(l.remaining), l.stateLabel || ""]);

  // ① كتلة العميل «دفعاتنا على العميل»
  const clientBlock: PayBlock = {
    title: `دفعاتنا على العميل — ${core.contract.contractNumber}`,
    lines: core.computed.lines,
    hasPlan: true,
    totals: {
      due: r3(core.computed.lines.reduce((s, l) => s + l.amountN, 0)),
      paid: r3(core.computed.lines.reduce((s, l) => s + l.covered, 0)),
    },
    items: [],
  };

  // ② كتلة لكل مقاول باطن (غير ملغى يُعرض بحالته كما في الشاشة)
  const subs = await db.subContract.findMany({
    where: { contractId },
    include: { subcontractor: { select: { name: true, subCode: true } }, items: { select: { id: true } } },
    orderBy: { id: "asc" },
  });
  const subBlocks: PayBlock[] = [];
  const sTotAll = { due: 0, paid: 0 };
  for (const s of subs) {
    const plan = await computeSubPlan(s.id);
    const items = await db.subContractItem.findMany({
      where: { subContractId: s.id },
      include: { boqItem: { select: { description: true, unit: true } } },
      orderBy: { id: "asc" },
    });
    subBlocks.push({
      title: `${s.subcontractor.name}${s.subcontractor.subCode ? ` (${s.subcontractor.subCode})` : ""} · بنود: ${items.length} · قيمة العقد ${money(Number(s.amount))}${s.status ? ` · ${s.status}` : ""}`,
      lines: plan?.lines ?? [],
      hasPlan: Boolean(plan),
      totals: { due: plan?.planTotal ?? 0, paid: plan?.paid ?? 0 },
      items: items.map((it) => ({
        description: it.boqItem?.description || "",
        qty: Number(it.qty),
        unit: it.boqItem?.unit || "",
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
      })),
    });
    sTotAll.due = r3(sTotAll.due + (plan?.planTotal ?? 0));
    sTotAll.paid = r3(sTotAll.paid + (plan?.paid ?? 0));
  }

  const format = (req.nextUrl.searchParams.get("format") || "csv").trim().toLowerCase();

  // ===== المرحلة 8: xlsx حقيقي — ورقة لكل كتلة + بنود + إجماليات =====
  if (format === "xlsx") {
    const sheets: XlsxSheet[] = [
      {
        name: `دفعات العميل ${core.contract.contractNumber || ""}`.slice(0, 28),
        columns: HEADS.map((h) => ({ header: h })),
        rows: lineRows(clientBlock.lines),
        numberCols: [2, 3, 4],
        totalsRow: ["الإجمالي", "", clientBlock.totals.due, clientBlock.totals.paid, r3(clientBlock.totals.due - clientBlock.totals.paid), ""],
      },
    ];
    for (const b of subBlocks) {
      sheets.push({
        name: `دفعات ${b.title.split(" · ")[0]}`.slice(0, 28),
        columns: HEADS.map((h) => ({ header: h })),
        rows: lineRows(b.lines),
        numberCols: [2, 3, 4],
        totalsRow: ["الإجمالي", "", b.totals.due, b.totals.paid, r3(b.totals.due - b.totals.paid), ""],
      });
      if (b.items.length > 0) {
        sheets.push({
          name: `بنود ${b.title.split(" · ")[0]}`.slice(0, 28),
          columns: ITEM_HEADS.map((h) => ({ header: h })),
          rows: b.items.map((it) => [it.description, it.qty, it.unit, it.unitPrice, it.amount]),
          numberCols: [1, 3, 4],
          totalsRow: null,
        });
      }
    }
    if (subBlocks.length > 0) {
      sheets.push({
        name: "الإجماليات",
        columns: [{ header: "البيان" }, { header: "المبلغ" }, { header: "المغطى" }, { header: "المتبقي" }],
        rows: [
          ["دفعاتنا على العميل", clientBlock.totals.due, clientBlock.totals.paid, r3(clientBlock.totals.due - clientBlock.totals.paid)],
          ...subBlocks.map((b, i) => [
            `${subs[i].subcontractor.name} (SB-${subs[i].id})`,
            b.totals.due,
            b.totals.paid,
            r3(b.totals.due - b.totals.paid),
          ] as (string | number)[]),
        ],
        numberCols: [1, 2, 3],
        totalsRow: ["إجمالي المقاولين", sTotAll.due, sTotAll.paid, r3(sTotAll.due - sTotAll.paid)],
      });
    }
    const buf = await buildXlsxBuffer({ sheets });
    const filename = `pay-blocks-${contractId}-${encodeURIComponent(core.contract.contractNumber || "")}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ===== CSV (الافتراضي — نفس التخطيط الحرفي السابق) =====
  const rows: (string | number)[][] = [];
  rows.push([clientBlock.title]);
  rows.push(HEADS);
  rows.push(...lineRows(clientBlock.lines));
  rows.push(["الإجمالي", "", money(clientBlock.totals.due), money(clientBlock.totals.paid), money(r3(clientBlock.totals.due - clientBlock.totals.paid)), ""]);
  rows.push([""]);

  for (const b of subBlocks) {
    rows.push([b.title]);
    rows.push(HEADS);
    if (b.hasPlan) {
      rows.push(...lineRows(b.lines));
      rows.push(["الإجمالي", "", money(b.totals.due), money(b.totals.paid), money(r3(b.totals.due - b.totals.paid)), ""]);
    }
    if (b.items.length > 0) {
      rows.push([`بنود ${b.title.split(" · ")[0]}`]);
      rows.push(ITEM_HEADS);
      for (const it of b.items) {
        rows.push([it.description, it.qty, it.unit, money(it.unitPrice), money(it.amount)]);
      }
    }
    rows.push([""]);
  }
  if (subBlocks.length > 0) {
    rows.push(["إجمالي المقاولين", "", money(sTotAll.due), money(sTotAll.paid), money(r3(sTotAll.due - sTotAll.paid)), ""]);
  }

  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const filename = `pay-blocks-${contractId}-${core.contract.contractNumber || ""}.csv`;
  return new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}
