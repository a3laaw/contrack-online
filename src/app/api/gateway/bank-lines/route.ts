import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { GatewayError, saveBankLines, type BankLineInput } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET ?from=&to=&bankAccount=&q= — سطور كشف البنك المستوردة */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_clearing");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  const bankAccount = (sp.get("bankAccount") || "").trim();
  const q = (sp.get("q") || "").trim().toLowerCase();
  const rows = await db_bankQuery(from, to, bankAccount, q);
  return ok({
    lines: rows,
    totals: { count: rows.length, amount: r3(rows.reduce((s, l) => s + Number(l.amount), 0)) },
  });
}

async function db_bankQuery(from: string, to: string, bankAccount: string, q: string) {
  const rows = await db.bankLine.findMany({
    where: {
      ...(from || to ? { cdate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(bankAccount ? { bankAccount } : {}),
    },
    orderBy: [{ cdate: "desc" }, { id: "desc" }],
    take: 2000,
  });
  return rows
    .filter((b) => !q || b.descr.toLowerCase().includes(q) || b.bankAccount.toLowerCase().includes(q))
    .map((b) => ({ ...b, amount: r3(Number(b.amount)) }));
}

/** POST استيراد كشف بنك: {bankAccount?, batch?, rows:[{bankAccount?, cdate, amount, descr?}]} — upsert بمنع التكرار */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_clearing");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const defaultAccount = String(body.bankAccount || "").trim();
    const batch = String(body.batch || "").trim();
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    if (!rawRows.length) return jsonError("لا توجد سطور في الكشف.");
    const lines: BankLineInput[] = [];
    let skipped = 0;
    for (const r of rawRows as Record<string, unknown>[]) {
      const cdate = String(r.cdate || r.date || "").slice(0, 10);
      const amount = Number(r.amount || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cdate) || !Number.isFinite(amount) || amount === 0) {
        skipped += 1;
        continue;
      }
      lines.push({
        bankAccount: String(r.bankAccount || defaultAccount),
        cdate,
        amount,
        descr: String(r.descr || r.description || "").trim(),
      });
    }
    if (!lines.length) return jsonError("كل السطور غير صالحة (تاريخ YYYY-MM-DD ومبلغ ≠ 0).");
    const result = await saveBankLines(defaultAccount, lines, batch);
    return ok({ ...result, skipped }, 201);
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
