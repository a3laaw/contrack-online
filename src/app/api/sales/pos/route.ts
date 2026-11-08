// GET/POST /api/sales/pos — كتالوج نقاط البيع + مبيعات اليوم + إتمام البيع (المعاملة الكبرى)
// docs/sales-design.md §5 — كل مسار محروس بصلاحية المبيعات وبوابة الموديول.
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { SalesError, executePosSale, loadPosCatalog, loadPosSalesOfDay } from "@/lib/sales-server";

/** GET: كتالوج النقطة (مستودعات/أصناف بكمية ومتوسط/العميل النقدي) — و?date= يضيف مبيعات اليوم للعرض حصرًا */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_sales");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "sales", "المبيعات");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const warehouseId = intOr(sp.get("warehouseId"), 0) || undefined;
  const catalog = await loadPosCatalog(warehouseId);
  const date = parseDay(sp.get("date")) || todayStr();
  const today = await loadPosSalesOfDay(date);
  return ok({ ...catalog, todayDate: date, todaySales: today });
}

/** POST: إتمام البيع — فاتورة + سند قبض آلي + إذن صرف مخزني آلي بمعاملة واحدة (§5) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_sales");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "sales", "المبيعات");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const warehouseId = intOr(body.warehouseId, 0);
  if (!warehouseId) return jsonError("مستودع البيع مطلوب");
  const invoiceDate = parseDay(body.invoiceDate) || parseDay(todayStr());
  if (!invoiceDate) return jsonError("تاريخ البيع مطلوب بصيغة YYYY-MM-DD");

  try {
    const result = await executePosSale({
      warehouseId,
      customerId: intOr(body.customerId, 0) || null,
      payNow: body.payNow !== false,
      payMethod: String(body.payMethod ?? ""),
      payAccount: String(body.payAccount ?? ""),
      invoiceDate,
      description: String(body.description ?? ""),
      notes: String(body.notes ?? ""),
      rawLines: body.lines,
      user: { id: guard.user.id, username: guard.user.username, role: guard.user.role },
    });
    return ok(result, 201);
  } catch (e) {
    if (e instanceof SalesError) return jsonError(e.message, e.status);
    console.error("فشل إتمام البيع:", e);
    return jsonError("تعذر إتمام البيع، حاول مجددًا", 500);
  }
}
