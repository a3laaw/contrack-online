import { NextRequest, NextResponse } from "next/server";
import { authGuard, jsonError } from "@/lib/api-utils";
import { buildGeneralLedger } from "@/lib/accounting-reports-server";
import { getSettingsRow } from "@/lib/contrack-server";
import { buildGeneralLedgerHtml } from "@/lib/pdf/gl-html";
import { renderHtmlToPdf } from "@/lib/pdf/render-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * دفتر الأستاذ PDF خادميًا — Task 108 — GET /api/reports/ledger/general/pdf
 * نفس معاملات مسار JSON بتخطيط الكشوفات الموحد (شريط الشركة + بطاقة الحساب + الإجماليات).
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_ledger");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const accountId = Number(sp.get("accountId") || 0);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return jsonError("اختيار الحساب مطلوب لطباعة دفتر الأستاذ.");
  }
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  const customerId = Number(sp.get("customerId") || 0) || undefined;
  const contractId = Number(sp.get("contractId") || 0) || undefined;
  const subContractId = Number(sp.get("subContractId") || 0) || undefined;
  const costCenter = (sp.get("costCenter") || "").trim() || undefined;

  const result = await buildGeneralLedger({ accountId, from, to, customerId, contractId, subContractId, costCenter });
  if (!result) return jsonError("الحساب غير موجود في دليل الشركة.", 404);

  const settings = await getSettingsRow();
  const s = settings as unknown as Record<string, unknown>;
  const hexColor = (v: unknown) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : undefined;

  const filterParts: string[] = [];
  if (customerId) filterParts.push("عميل محدد");
  if (contractId) filterParts.push("عقد محدد");
  if (subContractId) filterParts.push("عقد باطن محدد");
  if (costCenter) filterParts.push(`مركز التكلفة: ${costCenter}`);

  const html = buildGeneralLedgerHtml(
    {
      account: { code: result.account.code, name: result.account.name, nature: result.account.nature, type: result.account.type },
      periodText:
        from || to
          ? `${from || "بداية الدفتر"} ← ${to || "آخر الدفتر"}`
          : "كامل الدفتر",
      filtersText: filterParts.length ? `الفلاتر: ${filterParts.join(" · ")}` : undefined,
      opening: result.opening,
      rows: result.rows.map((r) => ({
        date: r.entryDate,
        ref: `#${r.entryNo}`,
        desc: r.lineDescription || r.description,
        dims: [r.customerName, r.contractNumber ? `عقد ${r.contractNumber}` : "", r.subcontractLabel, r.costCenter ? `مركز: ${r.costCenter}` : ""]
          .filter(Boolean)
          .join(" · "),
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
        side: r.balanceSide,
      })),
      totals: result.totals,
      closing: result.closing,
    },
    {
      company: {
        name: settings.companyName,
        address: settings.companyAddress,
        phone: settings.companyPhone,
        email: settings.companyEmail,
      },
      currency: settings.currency || "د.ك",
      primary: hexColor(s.invoice_primary ?? s.invoicePrimary),
      accent: hexColor(s.invoice_accent ?? s.invoiceAccent),
    }
  );

  const asciiName = `general_ledger_${encodeURIComponent(result.account.code)}.pdf`;
  const utf8Name = encodeURIComponent(`دفتر الأستاذ ${result.account.code}.pdf`);
  try {
    const pdf = await renderHtmlToPdf(html);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[pdf] فشل توليد دفتر الأستاذ:", e);
    return jsonError(`تعذر إنشاء ملف PDF: ${e instanceof Error ? e.message : "خطأ غير معروف"}`, 500);
  }
}
