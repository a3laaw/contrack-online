import { NextRequest, NextResponse } from "next/server";
import { authGuard, jsonError } from "@/lib/api-utils";
import { db } from "@/lib/db";
import { r3 } from "@/lib/contrack-core";
import { getSettingsRow, intOr } from "@/lib/contrack-server";
import { INVOICE_STATUS_LABELS } from "@/lib/invoice-server";
import { buildInvoiceHtml } from "@/lib/pdf/invoice-html";
import { renderHtmlToPdf } from "@/lib/pdf/render-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

type P = { params: Promise<{ id: string }> };

/**
 * طباعة الفاتورة PDF برأس الشركة — Task 107 (كانت ستَب 501 مؤجلة منذ المرحلة 8).
 * نفس نمط كشوف الحساب: إعدادات الشركة للترويسة واللون + بنّاء HTML نقّي + Chromium خادميًا.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_invoices");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = intOr(idStr, 0);

  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, customerCode: true, phone: true, address: true } },
      contract: { select: { contractNumber: true, contractName: true } },
      items: { orderBy: { sortOrder: "asc" } },
      paymentLinks: {
        where: { voucher: { cancelled: false } },
        include: { voucher: { select: { voucherNumber: true, vdate: true, method: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!inv) return jsonError("الفاتورة غير موجودة", 404);

  const settings = await getSettingsRow();
  const s = settings as unknown as Record<string, unknown>;
  const hexColor = (v: unknown) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : undefined;

  const html = buildInvoiceHtml(
    {
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      status: inv.status,
      statusLabel: INVOICE_STATUS_LABELS[inv.status] || inv.status,
      customer: {
        name: inv.customer.name,
        customerCode: inv.customer.customerCode,
        phone: inv.customer.phone,
        address: inv.customer.address,
      },
      contractNumber: inv.contract?.contractNumber ?? null,
      contractName: inv.contract?.contractName ?? null,
      description: inv.description,
      items: inv.items.map((it) => ({
        description: it.description,
        quantity: r3(Number(it.quantity)),
        unitPrice: r3(Number(it.unitPrice)),
        discountPct: Number(it.discountPct),
        lineTotal: r3(Number(it.lineTotal)),
      })),
      subtotal: r3(Number(inv.subtotal)),
      discountTotal: r3(Number(inv.discountTotal)),
      total: r3(Number(inv.total)),
      paidAmount: r3(Number(inv.paidAmount)),
      remaining: r3(inv.status === "void" ? 0 : Number(inv.total) - Number(inv.paidAmount)),
      payments: inv.paymentLinks.map((l) => ({
        voucherNumber: l.voucher.voucherNumber,
        vdate: l.voucher.vdate,
        method: l.voucher.method,
        amount: r3(Number(l.amount)),
      })),
      notes: inv.notes,
      voidReason: inv.voidReason,
      legacy: inv.legacy,
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

  const asciiName = `invoice_${encodeURIComponent(inv.invoiceNumber)}.pdf`;
  const utf8Name = encodeURIComponent(`فاتورة ${inv.invoiceNumber}.pdf`);
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
    console.error("[pdf] فشل توليد الفاتورة:", e);
    return jsonError(`تعذر إنشاء ملف PDF: ${e instanceof Error ? e.message : "خطأ غير معروف"}`, 500);
  }
}
