import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { createTaxDeclaration, listTaxDeclarations } from "@/lib/tax-server";

export const runtime = "nodejs";

/**
 * إقرارات الزكاة/الضريبة — Task 111 — GET/POST /api/tax/declarations
 * GET ?year=YYYY — القائمة + أرقام الجاهزية الحالية من الأستاذ (صافي ربح السنة + العلم)
 * POST {year, kind, adjustments, notes} — إنشاء مسودة تُلقط أرقام الأستاذ لحظة الإنشاء
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_zakat_xbrl");
  if ("response" in guard) return guard.response;
  const yearRaw = req.nextUrl.searchParams.get("year");
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;
  const result = await listTaxDeclarations(year);
  return ok(result);
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_zakat_xbrl");
  if ("response" in guard) return guard.response;
  const body = (await req.json().catch(() => null)) as
    | { year?: number; kind?: string; adjustments?: unknown; notes?: string }
    | null;
  const year = Number(body?.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return jsonError("سنة الإقرار مطلوبة (2000–2100).");
  const kind = body?.kind === "foreign_tax" ? "foreign_tax" : body?.kind === "zakat" ? "zakat" : null;
  if (!kind) return jsonError("نوع الإقرار مطلوب: zakat أو foreign_tax.");
  try {
    const dto = await createTaxDeclaration(
      { year, kind, adjustments: body?.adjustments ?? [], notes: body?.notes || "" },
      guard.user.username
    );
    return ok({ declaration: dto });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر إنشاء المسودة.", 400);
  }
}
