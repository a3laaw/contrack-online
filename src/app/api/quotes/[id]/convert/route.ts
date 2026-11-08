// POST /api/quotes/[id]/convert — تحويل عرض السعر إلى فاتورة بيع عامة (د2)
// أول مستدعٍ واجهة لمنطق التحويل — الفاتورة الناتجة بلا عقد تصب في شاشة الفواتير القائمة،
// والعرض يُوسم بملاحظة التحويل ويُدقق. التحويل إلى عقد يبقى دالته بلا واجهة (حدود §9).
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { SalesError, convertQuotationToInvoice } from "@/lib/sales-server";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_sales");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "sales", "المبيعات");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = intOr(idStr, 0);
  if (!id) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const invoiceDate = parseDay(body.invoiceDate) || undefined;

  try {
    const result = await convertQuotationToInvoice(
      id,
      { id: guard.user.id, username: guard.user.username, role: guard.user.role },
      invoiceDate
    );
    return ok(result, 201);
  } catch (e) {
    if (e instanceof SalesError) return jsonError(e.message, e.status);
    console.error("فشل تحويل العرض:", e);
    return jsonError("تعذر تحويل العرض، حاول مجددًا", 500);
  }
}
