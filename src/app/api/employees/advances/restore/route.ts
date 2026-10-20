import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { restoreVoucherTx, VoucherError } from "@/lib/voucher-server";

function err(e: unknown) {
  if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/**
 * POST استعادة سلفة موظف ملغاة (V8.4 — مطابق للمكتبي): { voucherId, reason? }
 * يعيد ترحيل القيود الأصلية بنوع voucher_restore (فيعوّض عكس الإلغاء في الشبكة المحاسبية)
 * ثم يرفع الإلغاء — أرصدة السلف تُحسب من صفوف cancelled=false فتعود تلقائيًا.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const voucherId = intOr(body.voucherId, 0);
    if (!voucherId) return jsonError("رقم السند مطلوب");
    const reason = String(body.reason || "").trim();

    const restored = await db.$transaction((tx) =>
      restoreVoucherTx(tx, voucherId, guard.user.username, reason)
    );
    return ok({ restored: true, ...restored });
  } catch (e) {
    return err(e);
  }
}
