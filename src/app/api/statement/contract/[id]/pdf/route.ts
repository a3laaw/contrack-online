import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, parseDay } from "@/lib/api-utils";
import { buildContractStatement } from "@/lib/report-server";
import { getSettingsRow } from "@/lib/contrack-server";
import { buildStatementHtml } from "@/lib/pdf/statement-html";
import { renderHtmlToPdf } from "@/lib/pdf/render-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

type P = { params: Promise<{ id: string }> };

/**
 * كشف حساب العقد PDF خادميًا — GET /api/statement/contract/[id]/pdf?from=&to=
 * يعيد استخدام باني البيانات نفسه لمسار JSON (buildContractStatement) ثم يطبع HTML
 * المطابق للتخطيط المكتبي (statement_pdf.py) عبر Chromium.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف العقد غير صالح");

  const sp = req.nextUrl.searchParams;
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));

  const data = await buildContractStatement(id, { from, to });
  if (!data) return jsonError("العقد غير موجود", 404);

  // وصف العقد وعنوان العميل ليست ضمن نتيجة الباني — جلب مكمّل واحد
  const extra = await db.contract.findUnique({
    where: { id },
    select: { description: true, customer: { select: { address: true } } },
  });

  const settings = await getSettingsRow();
  const s = settings as unknown as Record<string, unknown>;
  const hexColor = (v: unknown) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : undefined;

  const html = buildStatementHtml(
    {
      customer: {
        name: data.customer.name,
        customerCode: data.customer.customerCode,
        phone: data.customer.phone,
        address: extra?.customer?.address || "",
      },
      contract: {
        contractNumber: data.contract.contractNumber,
        contractDate: data.contract.contractDate,
        amount: data.totals.current,
        description: extra?.description || "",
      },
      rows: data.rows,
      totals: { debit: data.totals.debit, credit: data.totals.credit, remaining: data.totals.remaining },
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

  const contractNumber = data.contract.contractNumber || String(id);
  const asciiName = `statement_${encodeURIComponent(contractNumber)}.pdf`;
  const utf8Name = encodeURIComponent(`كشف حساب ${contractNumber}.pdf`);
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
    console.error("[pdf] فشل توليد كشف العقد:", e);
    return jsonError(
      `تعذر إنشاء ملف PDF: ${e instanceof Error ? e.message : "خطأ غير معروف"}`,
      500
    );
  }
}
