import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, authGuard, featureGuard, jsonError, ok, parseDay, audit, todayStr } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { VoucherError } from "@/lib/voucher-server";
import {
  cancelSettlementLines,
  createSettlementVoucherInTx,
  custodyBreakdown,
  loadSettlementGroup,
  validateSettlementLines,
  withNumberRetry,
} from "@/lib/custody-server";

type P = { params: Promise<{ ref: string }> };

function err(e: unknown) {
  if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET: كشف تصفية واحدة — البنود كاملة + المُسلَّم حتى تاريخ التصفية والمُنفَق والرصيد */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;
  const { ref } = await params;
  const group = await loadSettlementGroup(ref);
  if (!group) return jsonError("التصفية غير موجودة", 404);
  return ok(group);
}

/**
 * PATCH (مدير): تعديل بنود التصفية = إلغاء البنود السارية (سبب «تعديل تصفية»)
 * وإنشاء بدائل جديدة بنفس مرجع المجموعة — مع سقف غير المصفّى + بنود ملغاة.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  // المرحلة 3/ج: بوابة settle_edit — مطابقة المكتبي custody_center.py
  // (تعطيل الميزة يمنع تعديل بنود التصفية حتى للمدير بنفس رسالة الأصل)
  const seGuard = await featureGuard("settle_edit", "تعديل التصفية معطّل لهذا العميل.");
  if (seGuard) return seGuard;
  try {
    const { ref } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const existing = await db.voucher.findMany({ where: { expenseGroupRef: ref } });
    if (existing.length === 0) return jsonError("التصفية غير موجودة", 404);
    const withCustody = existing.find((v) => v.custodyAccountId);
    if (!withCustody?.custodyAccountId) return jsonError("التصفية بلا حساب عهدة صالح");
    const acc = await db.expenseAccount.findUnique({ where: { id: withCustody.custodyAccountId } });
    if (!acc || acc.accountKind !== "advance") return jsonError("حساب العهدة غير صالح", 404);

    const oldActive = existing.filter((v) => !v.cancelled);
    const oldActiveTotal = r3(oldActive.reduce((s, v) => s + Number(v.amount), 0));
    const { lines, total } = await validateSettlementLines(body.lines);
    let vdate = parseDay(body.vdate);
    if (body.vdate !== undefined && body.vdate !== "" && !vdate) {
      return jsonError("تاريخ التصفية غير صالح بصيغة YYYY-MM-DD");
    }
    if (!vdate) {
      const dates = oldActive.length ? oldActive.map((v) => v.vdate) : existing.map((v) => v.vdate);
      vdate = dates.length ? dates.reduce((m, d) => (d < m ? d : m)) : todayStr();
    }

    // السقف: غير المصفّى حاليًا + بنود التصفية المراد استبدالها (تُحرَّر بإلغائها)
    const unsettledBefore = await custodyBreakdown(db, acc.id);
    const cap = r3(unsettledBefore.balance + oldActiveTotal);
    if (total > cap + EPS) {
      return Response.json({ error: `مجموع التصفية يتجاوز غير المصفّى من العهدة (${cap} د.ك فقط)` }, { status: 400 });
    }

    const result = await withNumberRetry(async () =>
      db.$transaction(async (tx) => {
        const cancelled = await cancelSettlementLines(
          tx,
          oldActive.map((v) => v.id),
          "تعديل تصفية",
          guard.user.username
        );
        // البنود البديلة تحمل مرجع المجموعة الأصلي نفسه (كما في المهمة)
        const vouchers: { id: number; voucherNumber: string; amount: number }[] = [];
        for (let i = 0; i < lines.length; i++) {
          vouchers.push(
            await createSettlementVoucherInTx(tx, {
              vdate: lines[i].vdate || vdate,
              custodyAccount: { id: acc.id, name: acc.name },
              groupRef: ref,
              lineIndex: i,
              line: lines[i],
              groupDescription: String(body.description || "").trim(),
              username: guard.user.username,
            })
          );
        }
        await audit(tx, {
          username: guard.user.username,
          action: "تعديل تصفية",
          entityType: "custody_settlement",
          entityId: oldActive[0]?.id ?? 0,
          entityName: ref,
          oldStatus: `${oldActive.length} بند/${oldActiveTotal} د.ك`,
          newStatus: `${lines.length} بند/${total} د.ك`,
        });
        return { groupRef: ref, vouchers, total, cancelled: cancelled.cancelled };
      })
    );
    return ok({ settlement: { groupRef: result.groupRef, vouchers: result.vouchers, total: result.total, cancelled: result.cancelled } });
  } catch (e) {
    return err(e);
  }
}

/** DELETE (مدير): إلغاء التصفية كلها — إلغاء كل سندات المجموعة بسبب موحد + سطر تدقيق جماعي */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  try {
    const { ref } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = String(body.reason || req.nextUrl.searchParams.get("reason") || "").trim() || "إلغاء تصفية العهدة";
    const existing = await db.voucher.findMany({ where: { expenseGroupRef: ref } });
    if (existing.length === 0) return jsonError("التصفية غير موجودة", 404);
    const active = existing.filter((v) => !v.cancelled);
    if (active.length === 0) return jsonError("التصفية ملغاة مسبقًا");

    await db.$transaction(async (tx) => {
      await cancelSettlementLines(
        tx,
        active.map((v) => v.id),
        reason,
        guard.user.username
      );
      await audit(tx, {
        username: guard.user.username,
        action: "إلغاء تصفية",
        entityType: "custody_settlement",
        entityId: active[0].id,
        entityName: ref,
        oldStatus: `${active.length} بند/${r3(active.reduce((s, v) => s + Number(v.amount), 0))} د.ك`,
        newStatus: "ملغاة",
        reason,
      });
    });
    return ok({ cancelled: true, groupRef: ref, vouchersCancelled: active.length, reason });
  } catch (e) {
    return err(e);
  }
}
