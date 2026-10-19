import { NextRequest, NextResponse } from "next/server";
import { authGuard, jsonError, parseDay } from "@/lib/api-utils";
import { buildCustomerStatement } from "@/lib/report-server";
import { getSettingsRow } from "@/lib/contrack-server";
import { buildCustomerStatementHtml } from "@/lib/pdf/statement-html";
import { renderHtmlToPdf } from "@/lib/pdf/render-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

type P = { params: Promise<{ id: string }> };

/**
 * الكشف الشامل للعميل PDF خادميًا — GET /api/statement/customer/[id]/pdf?contractId=&from=&to=
 * نفس معاملات مسار JSON (buildCustomerStatement) بتخطيط الكتابة المكتبية بعمود «العقد».
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف العميل غير صالح");

  const sp = req.nextUrl.searchParams;
  const contractId = Number(sp.get("contractId") || 0);
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));

  const data = await buildCustomerStatement(id, {
    contractId: Number.isFinite(contractId) && contractId > 0 ? contractId : undefined,
    from,
    to,
  });
  if (!data) {
    return jsonError(
      Number.isFinite(contractId) && contractId > 0
        ? "العميل أو العقد غير موجود (أو العقد تابع لعميل آخر/ملغى)"
        : "العميل غير موجود",
      404
    );
  }

  const settings = await getSettingsRow();
  const s = settings as unknown as Record<string, unknown>;
  const hexColor = (v: unknown) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : undefined;

  const html = buildCustomerStatementHtml(
    {
      customer: data.customer,
      contractsCount: data.contractsCount,
      contractNumber: data.contract ? (data.contracts.find((c) => c.id === data.contract)?.contractNumber ?? null) : null,
      rows: data.rows,
      totals: {
        debit: data.totals.debit,
        credit: data.totals.credit,
        remaining: data.totals.remaining,
        opening: data.opening,
      },
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
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

  const pdf = await renderHtmlToPdf(html);

  const code = data.customer.customerCode || String(id);
  const asciiName = `statement_customer_${encodeURIComponent(code)}.pdf`;
  const utf8Name = encodeURIComponent(`كشف حساب شامل ${code}.pdf`);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
      "Cache-Control": "no-store",
    },
  });
}
