import { NextRequest, NextResponse } from "next/server";
import { buildCustomerStatement } from "@/lib/report-server";
import { getSettingsRow } from "@/lib/contrack-server";
import { buildCustomerStatementHtml } from "@/lib/pdf/statement-html";
import { renderHtmlToPdf } from "@/lib/pdf/render-pdf";
import { forCompany, sysDb } from "@/lib/db";
import { PORTAL_GENERIC_REJECT, PORTAL_TOKEN_RATE_PER_HOUR, PORTAL_IP_FAIL_RATE_PER_HOUR, PORTAL_RATE_WINDOW_MS } from "@/lib/portal-constants";
import {
  PORTAL_TOKEN_LENGTH,
  RateWindowStore,
  hashPortalToken,
  validatePortalToken,
} from "@/lib/portal-core";

export const runtime = "nodejs";
export const maxDuration = 60;

type P = { params: Promise<{ token: string }> };

/**
 * ر5 — المسار العام لكشف العميل عبر رمز مؤقت (docs/customer-portal-design.md د4/د5/د6):
 * **بلا authGuard إطلاقًا** — الحرس في هذا المشروع لكل مسار ولا middleware عام.
 * التحقق: طول الرمز → الهاش → الصلاحية/الإبطال → حدود النافذة — والرفض **عام موحد 404**
 * بلا تمييز الأسباب (د4). النجاح يعيد نفس كشف ر2 PDF حرفيًا عبر خط الأنابيب القائم (د5)
 * في سياق `forCompany(companyId)` من صف الرمز نفسه — لا جلسة ولا تجاوز لعميل آخر.
 */

// د6 — نوافذ في الذاكرة المحلية (تشتيت لا جدار — الدفاع الفعلي إنتروبيا الرمز 256-bit)
// المنطق كله في RateWindowStore النقية بالاختبارات — هنا حالتان: ناجحة لكل رمز وفاشلة لكل IP
const tokenHits = new RateWindowStore(PORTAL_TOKEN_RATE_PER_HOUR, PORTAL_RATE_WINDOW_MS);
const ipFails = new RateWindowStore(PORTAL_IP_FAIL_RATE_PER_HOUR, PORTAL_RATE_WINDOW_MS);

function clientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf ? xf.split(",")[0] : "") || req.headers.get("x-real-ip") || "غير معروف";
}

function genericReject(): NextResponse {
  return NextResponse.json({ error: PORTAL_GENERIC_REJECT }, { status: 404 });
}

/** GET /api/portal/statement/[token] — عام: رمز 256-bit هو الهوية، القراءة فقط، بلا جلسة */
export async function GET(req: NextRequest, { params }: P) {
  const { token: rawToken } = await params;
  const now = Date.now();

  // حارس الشكل — أي رمز بغير الطول المعتمد رفض عام فورًا (بلا فهرسة قاعدة)
  if (!rawToken || rawToken.length !== PORTAL_TOKEN_LENGTH) return genericReject();
  const tokenHash = hashPortalToken(rawToken);

  const ip = clientIp(req);

  // د6 — حد المحاولات الفاشلة لكل IP قبل أي قارئة قاعدة
  if (ipFails.exceeds(ip, now)) {
    return NextResponse.json(
      { error: "تجاوزت عدد المحاولات المسموح — حاول بعد ساعة." },
      { status: 429, headers: { "X-Robots-Tag": "noindex, nofollow" } }
    );
  }

  // د6 — حد الطلبات الناجحة لكل رمز
  if (tokenHits.exceeds(tokenHash, now)) {
    return NextResponse.json(
      { error: "تجاوز الرابط حد الطلبات في الساعة — حاول بعد قليل." },
      { status: 429, headers: { "X-Robots-Tag": "noindex, nofollow" } }
    );
  }

  // د1 — الفهرس على الهاش حصرًا: تسريب القاعدة لا يكشف الرموز؛ والرقمي العام لا يفهرس غير الموجود
  const row = await sysDb.customerPortalToken.findUnique({
    where: { tokenHash },
    select: { id: true, customerId: true, companyId: true, expiresAt: true, revokedAt: true },
  });
  const verdict = validatePortalToken(row, new Date(now));
  if (!row || !verdict.ok) {
    // د4 — الرفض عام موحد بلا تمييز الأسباب + تسجيل فشل للIP (الحد أعلاه)
    ipFails.push(ip, now);
    return genericReject();
  }

  // د7 — آخر استخدام على صف الرمز (بلا جدول زيارات ولا عدادات — G9)
  await forCompany(row.companyId).customerPortalToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date(now), lastUsedIp: ip },
  });
  tokenHits.push(tokenHash, now);

  // د5 — نفس كشف ر2 حرفيًا: نفس البناء والفلاتر الافتراضية (كل العقود بلا حدود فترة)
  const data = await buildCustomerStatement(row.customerId, {}, forCompany(row.companyId));
  if (!data) return genericReject(); // Cascade حذف العميل يزيل رموزه — يبقى أمان الفشل

  const settings = await getSettingsRow(forCompany(row.companyId), row.companyId);
  const s = settings as unknown as Record<string, unknown>;
  const hexColor = (v: unknown) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : undefined;

  const html = buildCustomerStatementHtml(
    {
      customer: data.customer,
      contractsCount: data.contractsCount,
      contractNumber: data.contract
        ? (data.contracts.find((c) => c.id === data.contract)?.contractNumber ?? null)
        : null,
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

  const code = data.customer.customerCode || String(row.customerId);
  const asciiName = `statement_customer_${encodeURIComponent(code)}.pdf`;
  const utf8Name = encodeURIComponent(`كشف حساب ${code}.pdf`);
  try {
    const pdf = await renderHtmlToPdf(html);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (e) {
    console.error("[portal-pdf] فشل توليد كشف البوابة:", e);
    return NextResponse.json({ error: "تعذر توليد كشف الحساب — حاول لاحقًا." }, { status: 500 });
  }
}
