import { NextRequest, NextResponse } from "next/server";
import { authGuard, jsonError } from "@/lib/api-utils";
import { buildFinancialStatements } from "@/lib/financial-statements-server";
import { getSettingsRow } from "@/lib/contrack-server";
import { buildIxbrlDocument, checkCoverage } from "@/lib/xbrl-core";

export const runtime = "nodejs";

/**
 * وثيقة iXBRL — Task 111 — GET /api/xbrl/preview?asOf=YYYY-MM-DD&from=&download=1&force=1
 * معاينة داخلية (inline) ثم تنزيل بـ download=1 (مرفق). اكتمال الخريطة شرط التصدير النهائي —
 * force=1 يسمح بتصدير ناقص موسوم (حظر الطباعة النهائية عند الفشل كالقوائم).
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_zakat_xbrl");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const asOf = (sp.get("asOf") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return jsonError("تاريخ القوائم (حتى) مطلوب بصيغة YYYY-MM-DD.", 400);
  const from = (sp.get("from") || "").trim();
  const download = sp.get("download") === "1";
  const force = sp.get("force") === "1";

  const fs = await buildFinancialStatements({ asOf, from: from || undefined });
  const coverage = checkCoverage({
    income: fs.income,
    balanceSheet: fs.balanceSheet,
    equity: fs.equity,
    cashflow: fs.cashflow,
  });
  if (!coverage.complete && download && !force) {
    return jsonError(
      `خريطة XBRL غير مكتملة — ${coverage.uncovered.length} بندًا بقيمة بلا عنصر. راجع تقرير الاكتمال أو صدّر بمسودة force=1.`,
      409
    );
  }
  const settings = await getSettingsRow();
  const year = Number(asOf.slice(0, 4));
  const { html } = buildIxbrlDocument({
    meta: {
      companyName: settings.companyName || "شركة",
      companyLicense: settings.companyLicense || "",
      year,
      asOf,
      from: fs.from,
      currency: "KWD",
    },
    income: fs.income,
    balanceSheet: fs.balanceSheet,
    equity: fs.equity,
    cashflow: fs.cashflow,
    coverage,
    force,
  });

  const asciiName = `ixbrl_${year}_${asOf}.html`;
  const utf8Name = encodeURIComponent(`التقديم-iXBRL-${year}.html`);
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": download
        ? `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`
        : "inline",
      "Cache-Control": "no-store",
    },
  });
}
