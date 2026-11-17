import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard } from "@/lib/api-utils";
import { buildPurchaseOrderHtml } from "@/lib/pdf/purchase-order-html";
import { renderHtmlToPdf } from "@/lib/pdf/render-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

type P = { params: Promise<{ id: string }> };

/**
 * ر4 — طباعة أمر الشراء PDF خادميًا (docs/purchase-design.md د8):
 * بنود الأمر بلقطاتها المجمّدة + المستلم والمتبقي + خانات التوقيعات —
 * نمط مسارات PDF القائمة حرفيًا (renderHtmlToPdf + ترويسة التنزيل الثنائية).
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const order = await db.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true, poNumber: true, orderDate: true, expectedDate: true, status: true,
      totalAmount: true, receivedAmount: true, notes: true,
      supplier: { select: { name: true, phone: true, crNumber: true } },
      contract: { select: { contractNumber: true } },
      items: {
        select: { id: true, qty: true, receivedQty: true, unitPrice: true, amount: true, item: { select: { name: true, unit: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!order) return jsonError("أمر الشراء غير موجود", 404);

  // بيانات الشركة من الإعدادات (نمط مسارات PDF القائمة)
  const setting = await db.setting.findFirst({ select: { companyName: true, companyAddress: true, companyPhone: true, companyEmail: true } });

  const html = buildPurchaseOrderHtml({
    company: {
      name: setting?.companyName || "",
      address: setting?.companyAddress || "",
      phone: setting?.companyPhone || "",
      email: setting?.companyEmail || "",
    },
    poNumber: order.poNumber,
    supplierName: order.supplier.name,
    supplierPhone: order.supplier.phone || "",
    supplierCr: order.supplier.crNumber || "",
    orderDate: order.orderDate,
    expectedDate: order.expectedDate || "",
    status: order.status,
    contractNumber: order.contract?.contractNumber || "",
    notes: order.notes || "",
    currency: "د.ك",
    items: order.items.map((it) => ({
      itemName: it.item?.name || `الصنف #${it.id}`,
      unit: it.item?.unit || "",
      qty: Number(it.qty),
      receivedQty: Number(it.receivedQty),
      unitPrice: Number(it.unitPrice),
      amount: Number(it.amount),
    })),
    totalAmount: Number(order.totalAmount),
    receivedAmount: Number(order.receivedAmount),
  });

  const asciiName = `purchase_order_${encodeURIComponent(order.poNumber)}.pdf`;
  const utf8Name = encodeURIComponent(`أمر شراء ${order.poNumber}.pdf`);
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
    console.error("[pdf] فشل توليد أمر الشراء:", e);
    return jsonError(`تعذر إنشاء ملف PDF: ${e instanceof Error ? e.message : "خطأ غير معروف"}`, 500);
  }
}
