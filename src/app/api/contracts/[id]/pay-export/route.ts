import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";
import { computeSubPlan } from "@/lib/voucher-server";

type P = { params: Promise<{ id: string }> };

/**
 * تصدير كتل الدفعات (CSV/Excel نصي بترميز UTF-8 مع BOM) — المرجع المكتبي:
 * ui/contract_hub.py::_export_pay_view (1332): جدول لكل كتلة (العميل ثم كل مقاول)
 * مع قسم «بنود …» أسفل جدول كل مقاول ثم صفوف الإجماليات.
 */

const HEADS = ["العنوان", "الاستحقاق", "المبلغ", "المغطى", "المتبقي", "الحالة"];
const ITEM_HEADS = ["الوصف", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"];

function esc(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

  const rows: (string | number)[][] = [];
  const lineRows = (lines: { title: string; dueDate: string; amountN: number; covered: number; remaining: number; stateLabel?: string }[]) =>
    lines.map((l) => [l.title, l.dueDate, money(l.amountN), money(l.covered), money(l.remaining), l.stateLabel || ""]);

  // ① كتلة العميل «دفعاتنا على العميل»
  rows.push([`دفعاتنا على العميل — ${core.contract.contractNumber}`]);
  rows.push(HEADS);
  const cLines = core.computed.lines;
  rows.push(...lineRows(cLines));
  const cTot = r3(cLines.reduce((s, l) => s + l.amountN, 0));
  const cPaid = r3(cLines.reduce((s, l) => s + l.covered, 0));
  rows.push(["الإجمالي", "", money(cTot), money(cPaid), money(r3(cTot - cPaid)), ""]);
  rows.push([""]);

  // ② كتلة لكل مقاول باطن (غير ملغى يُعرض بحالته كما في الشاشة)
  const subs = await db.subContract.findMany({
    where: { contractId },
    include: { subcontractor: { select: { name: true, subCode: true } }, items: { select: { id: true } } },
    orderBy: { id: "asc" },
  });
  const sTotAll = { due: 0, paid: 0 };
  for (const s of subs) {
    const plan = await computeSubPlan(s.id);
    const items = await db.subContractItem.findMany({
      where: { subContractId: s.id },
      include: { boqItem: { select: { description: true, unit: true } } },
      orderBy: { id: "asc" },
    });
    const title = `${s.subcontractor.name}${s.subcontractor.subCode ? ` (${s.subcontractor.subCode})` : ""} · بنود: ${items.length} · قيمة العقد ${money(Number(s.amount))}${s.status ? ` · ${s.status}` : ""}`;
    rows.push([title]);
    rows.push(HEADS);
    if (plan) {
      rows.push(...lineRows(plan.lines));
      sTotAll.due = r3(sTotAll.due + plan.planTotal);
      sTotAll.paid = r3(sTotAll.paid + plan.paid);
      rows.push(["الإجمالي", "", money(plan.planTotal), money(plan.paid), money(r3(plan.planTotal - plan.paid)), ""]);
    }
    if (items.length > 0) {
      rows.push([`بنود ${s.subcontractor.name}`]);
      rows.push(ITEM_HEADS);
      for (const it of items) {
        rows.push([
          it.boqItem?.description || "",
          Number(it.qty),
          it.boqItem?.unit || "",
          money(Number(it.unitPrice)),
          money(Number(it.amount)),
        ]);
      }
    }
    rows.push([""]);
  }
  if (subs.length > 0) {
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
