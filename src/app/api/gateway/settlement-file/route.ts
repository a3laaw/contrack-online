import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { GatewayError, parseSettlementText, uploadSettlementFile, type SettlementRowInput } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/**
 * POST رفع ملف تسوية البوابة:
 * {gatewayName, batch?, rows:[{opDate, phone, amount, ref?, customer?, gwPaid?}]} —
 * أو {text: "..."} نص خام (فاصل comma/tab/semicolon) يُحلل تلقائيًا.
 * لكل صف: تثبيت تراكمي (upsert بالمفتاح) ثم مطابقة تلقائية لغير المصنف —
 * سند قبض سارٍ غير مربوط بعملية أخرى · الهوية (هاتف/اسم/رابط محفوظ) ·
 * النافذة [opDate−5, opDate+3] · المبلغ ±tolerance ⇒ mine + receiptNo.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const gatewayName = String(body.gatewayName || body.gateway || "").trim();
    const batch = String(body.batch || "").trim();
    let rows: SettlementRowInput[] = [];
    let skipped = 0;
    const skipReasons: string[] = [];
    if (typeof body.text === "string" && body.text.trim()) {
      const parsed = parseSettlementText(body.text);
      rows = parsed.rows;
      skipped = parsed.skipped;
      skipReasons.push(...parsed.skipReasons);
    } else if (Array.isArray(body.rows)) {
      for (const r of body.rows as Record<string, unknown>[]) {
        const opDate = String(r.opDate || r.date || "").slice(0, 10);
        const amount = Number(r.amount || 0);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(opDate) || !Number.isFinite(amount) || amount === 0) {
          skipped += 1;
          skipReasons.push(`صف بتاريخ أو مبلغ غير صالح — تجاهل`);
          continue;
        }
        rows.push({
          opDate,
          phone: String(r.phone || "").trim(),
          amount,
          ref: String(r.ref || "").trim(),
          customer: String(r.customer || r.name || "").trim(),
          gwPaid: r.gwPaid === undefined || r.gwPaid === null || r.gwPaid === "" ? null : Number(r.gwPaid),
        });
      }
    }
    if (!rows.length) return jsonError("لا توجد صفوف صالحة في الملف — تحقق من الأعمدة والفواصل.");
    const result = await uploadSettlementFile(gatewayName, rows, batch, guard.user.username);
    return ok({ ...result, skipped, skipReasons }, 201);
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
