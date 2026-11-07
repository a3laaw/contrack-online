import { NextRequest, NextResponse } from "next/server";
import { authGuard, jsonError } from "@/lib/api-utils";
import { computeBankRecon } from "@/lib/bank-recon-server";
import { getSettingsRow } from "@/lib/contrack-server";
import { buildBankReconHtml } from "@/lib/pdf/bank-recon-html";
import { renderHtmlToPdf } from "@/lib/pdf/render-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Task 113 — طباعة تقرير التسوية البنكية والفوارق PDF
 * GET /api/reports/bank-reconciliation/pdf?bankAccountId=&asOf=&statementBalance=&tolerance=&window=
 * التقرير نفسه هو تقرير الفوارق — يُطبع دائمًا ولو بفروق (الفرق غير المفسَّر يظهر بوضوح).
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const bankAccountId = Number(sp.get("bankAccountId") || 0);
  const asOf = (sp.get("asOf") || "").trim();
  const statementBalance = Number(sp.get("statementBalance") || 0);
  const tolerance = Number(sp.get("tolerance") || 0);
  const windowDays = Number(sp.get("window") || 15);
  if (!bankAccountId) return jsonError("اختر حساب البنك أولًا.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return jsonError("تاريخ التسوية مطلوب بصيغة YYYY-MM-DD.", 400);

  try {
    const r = await computeBankRecon({
      bankAccountId,
      asOf,
      statementBalance,
      tolerance: Number.isFinite(tolerance) ? tolerance : 0,
      windowDays: Number.isFinite(windowDays) ? windowDays : 15,
    });

    const settings = await getSettingsRow();
    const s = settings as unknown as Record<string, unknown>;
    const hexColor = (v: unknown) =>
      typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : undefined;

    const html = buildBankReconHtml(
      {
        account: r.account,
        asOf,
        bankOnly: r.bankOnly.map((l) => ({ cdate: l.cdate, amount: l.amount, descr: l.descr })),
        glOnly: r.glOnly.map((l) => ({ entryNo: l.entryNo, entryDate: l.entryDate, description: l.description, amount: l.amount })),
        pairs: r.pairs.map((p) => ({ cdate: p.bank.cdate, descr: p.bank.descr, entryNo: p.gl.entryNo, dayGap: p.dayGap, amount: p.bank.amount })),
        totals: r.totals,
      },
      {
        company: {
          name: settings.companyName,
          address: (settings as unknown as Record<string, string>).companyAddress || "",
          phone: settings.companyPhone,
          email: (settings as unknown as Record<string, string>).companyEmail || "",
        },
        currency: settings.currency || "د.ك",
        primary: hexColor(s.invoice_primary ?? s.invoicePrimary),
        accent: hexColor(s.invoice_accent ?? s.invoiceAccent),
      }
    );

    const asciiName = `bank_reconciliation_${r.account.code}_${asOf}.pdf`;
    const utf8Name = encodeURIComponent(`تسوية بنكية ${r.account.name} ${asOf}.pdf`);
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
    return jsonError(e instanceof Error ? e.message : "تعذر إنشاء التقرير.", 400);
  }
}
