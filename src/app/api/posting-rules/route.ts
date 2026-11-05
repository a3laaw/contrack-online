import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { isSuperRole } from "@/lib/auth";
import {
  checkPostingRuleUpdate,
  POSTING_RULE_BY_KEY,
  type PostingRuleUpdateInput,
} from "@/lib/posting-rules-core";
import { ensurePostingRules, loadPostingRules } from "@/lib/posting-rules-server";

/**
 * قواعد ترحيل السندات — قوالب القيد الآلي القابلة للضبط (Task 106).
 * GET : القواعد الحالية (مسدودة من الكتالوج) + أسماء الحسابات المثبَّتة + دليل الأوراق للاختيار.
 * PUT : للمدير/المطور — تحديث أكواد الأطراف وحالة التفعيل (القاعدة المعطلة ترجع للمدمج).
 */

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  if (!isSuperRole(guard.user.role)) return jsonError("قواعد الترحيل للإدارة فقط", 403);

  await ensurePostingRules(db);
  const rules = await loadPostingRules(db);

  // أسماء الأكواد المثبَّتة دفعة واحدة + أوراق الدليل النشطة لقوائم الاختيار
  const codes = [...new Set(rules.flatMap((r) => [r.debitCode, r.creditCode]).filter(Boolean))];
  const [accounts, chart] = await Promise.all([
    db.account.findMany({ where: { code: { in: codes.length ? codes : ["—"] } }, select: { code: true, name: true } }),
    db.account.findMany({
      where: { isActive: true, allowPosting: true, isLeaf: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const codeNames = new Map(accounts.map((a) => [a.code, a.name]));

  return ok({
    rules: rules.map((r) => ({
      ruleKey: r.ruleKey,
      label: r.label,
      debitCode: r.debitCode,
      debitName: r.debitCode ? codeNames.get(r.debitCode) || null : null,
      creditCode: r.creditCode,
      creditName: r.creditCode ? codeNames.get(r.creditCode) || null : null,
      enabled: r.enabled,
      isSystem: r.isSystem,
      fromCatalog: r.fromCatalog,
    })),
    chart: chart.map((a) => ({ code: a.code, name: a.name })),
  });
}

export async function PUT(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  if (!isSuperRole(guard.user.role)) return jsonError("قواعد الترحيل للإدارة فقط", 403);

  const body = (await req.json().catch(() => ({}))) as { rules?: unknown };
  const list = Array.isArray(body.rules) ? (body.rules as PostingRuleUpdateInput[]) : [];
  if (list.length === 0) return jsonError("لا توجد قواعد لحفظها");

  // أكواد الدليل المتاحة للتثبيت — الأوراق النشطة حصرًا (النشر على الإجماليات ممنوع محركًا)
  const chart = await db.account.findMany({ where: { isActive: true }, select: { code: true, allowPosting: true, isLeaf: true } });
  const chartCodes = new Set(chart.filter((a) => a.allowPosting && a.isLeaf).map((a) => a.code));

  // تحقق كل الصفوف أولًا — فشل واحد يفشل الكل (بلا حفظ جزئي)
  const checked: { ruleKey: string; debitCode: string; creditCode: string; enabled: boolean }[] = [];
  for (const raw of list) {
    const res = checkPostingRuleUpdate(raw, POSTING_RULE_BY_KEY.get(String(raw.ruleKey || "")), chartCodes);
    if (!res.ok) return jsonError(res.error || "قاعدة غير صالحة");
    checked.push({ ruleKey: res.ruleKey!, debitCode: res.debitCode!, creditCode: res.creditCode!, enabled: res.enabled! });
  }

  const saved = await db.$transaction(async (tx) => {
    await ensurePostingRules(tx);
    let count = 0;
    for (const r of checked) {
      await tx.postingRule.updateMany({
        where: { ruleKey: r.ruleKey },
        data: { debitCode: r.debitCode, creditCode: r.creditCode, enabled: r.enabled },
      });
      count++;
    }
    return count;
  });

  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "posting_rules",
    entityId: 0,
    entityName: `قواعد الترحيل — ${saved} قاعدة`,
  });

  return ok({ saved });
}
