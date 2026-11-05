import { NextRequest, NextResponse } from "next/server";
import { authGuard, jsonError } from "@/lib/api-utils";
import { buildFinancialStatements } from "@/lib/financial-statements-server";
import { getSettingsRow } from "@/lib/contrack-server";
import { buildFinancialStatementHtml, allChecksPass } from "@/lib/pdf/financial-statements-html";
import { renderHtmlToPdf } from "@/lib/pdf/render-pdf";
import { FS_STATEMENT_LABEL, type FsStatementKind } from "@/lib/financial-statements-core";

export const runtime = "nodejs";
export const maxDuration = 60;

const KINDS: FsStatementKind[] = ["bs", "is", "eq", "cf"];

/**
 * طباعة قائمة مالية PDF خادميًا — Task 110 — GET /api/reports/financial-statements/pdf
 * GET ?kind=bs|is|eq|cf&asOf=YYYY-MM-DD&from=YYYY-MM-DD&force=1
 * الفحوص المفاجسة تمنع الطباعة النهائية — force=1 يخرج «مسودة» موسومة بذلك.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_financial_statements");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const kind = (sp.get("kind") || "").trim() as FsStatementKind;
  if (!KINDS.includes(kind)) {
    return jsonError("نوع القائمة مطلوب: bs (مركز مالي) | is (دخل) | eq (حقوق ملكية) | cf (تدفقات نقدية).", 400);
  }
  const asOf = (sp.get("asOf") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return jsonError("تاريخ القوائم (حتى) مطلوب بصيغة YYYY-MM-DD.", 400);
  }
  const from = (sp.get("from") || "").trim();
  const force = sp.get("force") === "1";

  const result = await buildFinancialStatements({ asOf, from: from || undefined });

  const periodText = kind === "bs" ? `حتى ${asOf}` : `${result.from} ← ${asOf}`;
  const checksBadges = [
    { label: "ميزان المراجعة متوازن", passed: result.checks.trialBalanced },
    { label: "المركز المالي متوازن", passed: result.balanceSheet.balanced },
    { label: "التدفقات تطابق النقد", passed: result.cashflow.reconciles },
    { label: "حقوق الملكية متسقة", passed: result.equity.consistent },
  ];

  if (!allChecksPass({ kind, rows: [], income: result.income, balanceSheet: result.balanceSheet, equity: result.equity, cashflow: result.cashflow }) && !force) {
    return jsonError(
      `فحوص التوازن لم تكتمل — لا تُطبع القوائم النهائية. (${result.checks.notes.join(" · ")}) — يمكن الطباعة كمسودة عبر force=1.`,
      409
    );
  }

  const settings = await getSettingsRow();
  const s = settings as unknown as Record<string, unknown>;
  const hexColor = (v: unknown) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : undefined;

  const html = buildFinancialStatementHtml(
    {
      kind,
      rows: [],
      income: result.income,
      balanceSheet: result.balanceSheet,
      equity: result.equity,
      cashflow: result.cashflow,
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
      title: `${FS_STATEMENT_LABEL[kind]} — القرار الوزاري 44/2016`,
      periodText,
      checksBadges,
      checkNotes: result.checks.notes,
      force,
    }
  );

  const asciiName = `financial_statement_${kind}_${asOf}.pdf`;
  const utf8Name = encodeURIComponent(`${FS_STATEMENT_LABEL[kind]} ${asOf}.pdf`);
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
    console.error("[pdf] فشل توليد القائمة المالية:", e);
    return jsonError(`تعذر إنشاء ملف PDF: ${e instanceof Error ? e.message : "خطأ غير معروف"}`, 500);
  }
}
