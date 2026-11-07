import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { parseStatementText } from "@/lib/bank-recon-core";
import { saveBankLines } from "@/lib/gateway-server";

/**
 * Task 113 — استيراد كشف بنك من نص ملصوق/CSV داخل شاشة التسوية
 * POST /api/reports/bank-reconciliation/import { bankKey, text }
 * التحليل نقي في النواة (صارم — السطور غير المفهومة تُتخطى)، والحفظ عبر upsert
 * نفس جدول bank_lines (dedupe: حساب+تاريخ+مبلغ+بيان) فلا تكرار مع استيراد البوابة.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as { bankKey?: string; text?: string };
  const bankKey = String(body.bankKey || "").trim();
  const text = String(body.text || "");
  if (!bankKey) return jsonError("مفتاح كشف البنك (رقم الحساب البنكي) مطلوب.", 400);
  if (!text.trim()) return jsonError("الصق نص الكشف أولًا (سطر لكل بند: تاريخ,مبلغ,بيان).", 400);

  const parsed = parseStatementText(text);
  if (!parsed.lines.length) {
    return jsonError(
      `لم يُفهم أي سطر — تأكد من عمودي تاريخ ومبلغ. تخُطى ${parsed.skipped} سطرًا. عينة: ${parsed.skippedSamples[0] || "—"}`,
      400
    );
  }

  try {
    const res = await saveBankLines(
      bankKey,
      parsed.lines.map((l) => ({ cdate: l.cdate, amount: l.amount, descr: l.descr, bankAccount: bankKey })),
      `recon-${new Date().toISOString().slice(0, 10)}`
    );
    return ok({
      received: res.received,
      inserted: res.inserted,
      duplicates: res.received - res.inserted,
      skipped: parsed.skipped,
      message: `استُورد ${res.inserted} بندًا جديدًا${res.received - res.inserted ? ` (وتُجاهل ${res.received - res.inserted} مكررًا)` : ""}${parsed.skipped ? ` — وتُخطى ${parsed.skipped} سطرًا غير مفهوم` : ""}.`,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "فشل حفظ الكشف.", 400);
  }
}
