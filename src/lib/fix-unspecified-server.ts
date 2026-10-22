import "server-only";
import { db } from "@/lib/db";
import { audit, normalizeArabic, todayStr } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import type { Prisma } from "@prisma/client";

/**
 * G5 — إصلاح العقود ذات النوع «غير محدد» (المكتبي types_setup_service 843–1288):
 * التحليل قراءة فقط · التنفيذ عقدًا عقدًا بقرارات صريحة.
 * القواعد الملزمة: لا يُحذف عقد/عميل/سند · الافتراضي للنظيف «النوع + إعادة بناء المراحل»
 * ولذي التقدّم الفعلي «النوع فقط» · إعادة بناء ذي التقدّم تحتاج إذنًا صريحًا ثانيًا.
 * ربط السندات (قرار المالك): خطط الدفعات ذات stageId فارغ تُربط بمرحلة محفز القالب
 * بمطابقة كلمة الربط/العنوان — لا يُلمس أي سند قبض نفسه.
 */

export const UNSPECIFIED = "غير محدد";
export const ACT_SKIP = "skip";
export const ACT_TYPE_ONLY = "type_only";
export const ACT_TYPE_STAGES = "type_stages";

/** كلمات الربط لكل نوع: اسم النوع + عناوين قوالب الدفع + كلمات الربط (المكتبي _contract_link_words) */
async function contractLinkWords(): Promise<Map<string, string[]>> {
  const types = await db.contractType.findMany({
    where: { active: true, name: { notIn: ["", UNSPECIFIED] } },
    include: { paymentTemplates: { select: { title: true, linkKeyword: true } } },
  });
  const out = new Map<string, string[]>();
  for (const t of types) {
    const words = [t.name];
    for (const p of t.paymentTemplates) {
      if ((p.title || "").trim()) words.push(p.title);
      for (const w of String(p.linkKeyword || "").replace(/،/g, ",").split(",")) {
        const w2 = w.trim();
        if (w2 && normalizeArabic(w2) !== normalizeArabic(UNSPECIFIED)) words.push(w2);
      }
    }
    out.set(t.name, words);
  }
  return out;
}

/** أفضل نوع مطابق لنص — أطول كلمة تطابقًا تفوز، والكلمات الأقصر من 3 أحرف تُرفض */
function bestTypeMatch(text: string, linkMap: Map<string, string[]>): { type: string; word: string } {
  const ntext = normalizeArabic(text);
  if (!ntext) return { type: "", word: "" };
  let bestType = "";
  let bestWord = "";
  for (const [tname, words] of linkMap) {
    for (const w of words) {
      const nw = normalizeArabic(w);
      if (nw.length < 3) continue;
      if (ntext.includes(nw) && nw.length > normalizeArabic(bestWord).length) {
        bestType = tname;
        bestWord = w;
      }
    }
  }
  return { type: bestType, word: bestWord };
}

export interface UnspecifiedRow {
  contractId: number;
  contractNumber: string;
  customerName: string;
  contractName: string;
  amount: number;
  suggestedType: string;
  source: string; // اسم العقد | كلمة الربط | سندات القبض | يدوي
  evidence: string;
  stagesState: string;
  receiptsState: string;
  nReceipts: number;
  nPlan: number;
  nComments: number;
  nStages: number;
  hasProgress: boolean;
  risky: boolean;
  riskReasons: string;
  defaultAction: string;
}

/** التحليل — قراءة فقط لكل عقد نوعه فارغ أو «غير محدد» (المكتبي analyze_unspecified) */
export async function analyzeUnspecified(): Promise<UnspecifiedRow[]> {
  const linkMap = await contractLinkWords();
  const contracts = await db.contract.findMany({
    where: { contractType: { in: ["", UNSPECIFIED] } },
    include: { customer: { select: { name: true } } },
    orderBy: { id: "asc" },
  });
  if (contracts.length === 0) return [];
  const ids = contracts.map((c) => c.id);

  // تجميع كل الحالات دفعة واحدة (كالتحسين المكتبي — بلا استعلامات داخل الحلقة)
  const [receiptAgg, planAgg, commentAgg, stageRows, voucherTexts] = await Promise.all([
    db.voucher.groupBy({ by: ["contractId"], where: { vtype: "receipt", cancelled: false, contractId: { in: ids } }, _count: { _all: true }, _sum: { amount: true } }),
    db.paymentPlanItem.groupBy({ by: ["contractId"], where: { contractId: { in: ids } }, _count: { _all: true } }),
    db.comment.groupBy({ by: ["contractId"], where: { contractId: { in: ids }, isDeleted: false }, _count: { _all: true } }),
    db.contractStage.findMany({ where: { contractId: { in: ids } }, orderBy: [{ contractId: "asc" }, { sortOrder: "asc" }, { id: "asc" }] }),
    db.voucher.findMany({
      where: { vtype: "receipt", cancelled: false, contractId: { in: ids } },
      select: { contractId: true, description: true, notes: true },
    }),
  ]);

  const recMap = new Map<number, { n: number; total: number }>();
  for (const r of receiptAgg) {
    if (r.contractId != null) recMap.set(r.contractId, { n: r._count._all, total: Number(r._sum.amount || 0) });
  }
  const planMap = new Map<number, number>();
  for (const r of planAgg) if (r.contractId != null) planMap.set(r.contractId, r._count._all);
  const cmtMap = new Map<number, number>();
  for (const r of commentAgg) if (r.contractId != null) cmtMap.set(r.contractId, r._count._all);
  const stageMap = new Map<number, typeof stageRows>();
  for (const s of stageRows) {
    if (s.contractId == null) continue;
    const arr = stageMap.get(s.contractId) ?? [];
    arr.push(s);
    stageMap.set(s.contractId, arr);
  }
  const vtextMap = new Map<number, string[]>();
  for (const v of voucherTexts) {
    if (v.contractId == null) continue;
    const arr = vtextMap.get(v.contractId) ?? [];
    for (const val of [v.description, v.notes]) if ((val || "").trim()) arr.push(val);
    vtextMap.set(v.contractId, arr);
  }

  const out: UnspecifiedRow[] = [];
  for (const c of contracts) {
    const stages = stageMap.get(c.id) ?? [];
    const steps = stages.filter((s) => (s.level || 1) === 1);
    const started = steps.filter((s) => (s.startDate || "").trim());
    const finished = steps.filter((s) => (s.endDate || "").trim());
    const stagesState = !stages.length
      ? "بلا مراحل"
      : finished.length
        ? `تقدّم فعلي (${finished.length} منتهية من ${steps.length})`
        : started.length
          ? `بدأت (${started.length} جارية من ${steps.length})`
          : `${steps.length} مرحلة بلا بدء`;

    const rec = recMap.get(c.id) ?? { n: 0, total: 0 };
    const nPlan = planMap.get(c.id) ?? 0;
    const nComments = cmtMap.get(c.id) ?? 0;
    const receiptsState = rec.n ? `${rec.n} سند بمبلغ ${r3(rec.total).toLocaleString("en")}` : "بلا سندات";

    // الاقتراح: 1) اسم/وصف العقد 2) الملاحظات 3) نصوص سندات القبض
    let suggested = "";
    let source = "يدوي";
    let evidence = "";
    const nameText = (c.description || "").trim() || (c.notes || "").trim() || c.contractName || "";
    const m1 = bestTypeMatch(c.description || nameText, linkMap);
    if (m1.type) {
      suggested = m1.type;
      source = "اسم العقد";
      evidence = m1.word;
    }
    if (!suggested) {
      const m2 = bestTypeMatch(c.notes || "", linkMap);
      if (m2.type) {
        suggested = m2.type;
        source = "كلمة الربط";
        evidence = m2.word;
      }
    }
    if (!suggested) {
      for (const txt of vtextMap.get(c.id) ?? []) {
        const m3 = bestTypeMatch(txt, linkMap);
        if (m3.type) {
          suggested = m3.type;
          source = "سندات القبض";
          evidence = m3.word;
          break;
        }
      }
    }

    const hasProgress = Boolean(started.length || finished.length);
    const risky = Boolean(stages.length || hasProgress || rec.n || nPlan || nComments);
    const reasons: string[] = [];
    if (finished.length) reasons.push(`${finished.length} مرحلة منتهية`);
    else if (started.length) reasons.push(`${started.length} مرحلة جارية`);
    else if (stages.length) reasons.push(`${steps.length} مرحلة قائمة`);
    if (rec.n) reasons.push(`${rec.n} سند قبض`);
    if (nPlan) reasons.push(`${nPlan} دفعة في خطة السداد`);
    if (nComments) reasons.push(`${nComments} تعليق`);

    out.push({
      contractId: c.id,
      contractNumber: c.contractNumber,
      customerName: c.customer?.name || "",
      contractName: nameText || c.contractName || "(بلا اسم)",
      amount: Number(c.amount || 0),
      suggestedType: suggested,
      source: suggested ? source : "يدوي",
      evidence,
      stagesState,
      receiptsState,
      nReceipts: rec.n,
      nPlan,
      nComments,
      nStages: stages.length,
      hasProgress,
      risky,
      riskReasons: reasons.join(" · "),
      defaultAction: risky ? ACT_TYPE_ONLY : ACT_TYPE_STAGES,
    });
  }
  return out;
}

export interface FixDecision {
  contractId: number;
  typeName: string;
  action: string; // skip | type_only | type_stages
}

export interface FixStats {
  typeUpdated: number;
  stagesRebuilt: number;
  skipped: number;
  downgraded: number;
  linesLinked: number;
  problems: string[];
  log: string[];
}

/** إعادة بناء مراحل العقد من شجرة النوع (نسخة المراحل كما عند إنشاء العقد) */
async function rebuildContractStages(tx: Prisma.TransactionClient, contractId: number, typeName: string): Promise<number> {
  const wfRows = await tx.workflowStage.findMany({
    where: { OR: [{ contractType: typeName }, { contractType: "" }], transactionType: "contract" },
    orderBy: [{ stageOrder: "asc" }, { id: "asc" }],
  });
  await tx.contractStage.deleteMany({ where: { contractId } });
  let built = 0;
  for (let i = 0; i < wfRows.length; i++) {
    const s = wfRows[i];
    await tx.contractStage.create({
      data: {
        contractId,
        name: s.stageName,
        level: 1,
        parentName: "",
        expectedDays: 0,
        payPct: 0,
        payKind: "",
        sortOrder: i,
      },
    });
    built++;
  }
  return built;
}

/** ربط خطط الدفعات بمراحل القالب بمطابقة كلمات الربط/العناوين — للخطوط ذات stageId فارغ فقط */
async function linkPlanLinesToStages(tx: Prisma.TransactionClient, contractId: number, typeName: string): Promise<number> {
  const type = await tx.contractType.findFirst({
    where: { name: typeName },
    include: {
      paymentTemplates: {
        where: { triggerStageId: { not: null } },
        select: { title: true, linkKeyword: true, triggerStageId: true },
      },
    },
  });
  if (!type || type.paymentTemplates.length === 0) return 0;
  const lines = await tx.paymentPlanItem.findMany({
    where: { contractId, stageId: null },
    select: { id: true, title: true },
  });
  let linked = 0;
  for (const line of lines) {
    const nTitle = normalizeArabic(line.title || "");
    if (!nTitle) continue;
    for (const tpl of type.paymentTemplates) {
      const words = [tpl.title || "", ...String(tpl.linkKeyword || "").replace(/،/g, ",").split(",")].map((w) => normalizeArabic(w.trim())).filter((w) => w.length >= 3);
      if (words.some((w) => nTitle.includes(w))) {
        await tx.paymentPlanItem.update({ where: { id: line.id }, data: { stageId: tpl.triggerStageId! } });
        linked++;
        break;
      }
    }
  }
  return linked;
}

/** التنفيذ — قرارات صريحة عقدًا عقدًا، لا شيء ضمنيًا (المكتبي apply_fixes 1214–1288) */
export async function applyFixes(decisions: FixDecision[], allowDestructive: boolean, username: string): Promise<FixStats> {
  const stats: FixStats = { typeUpdated: 0, stagesRebuilt: 0, skipped: 0, downgraded: 0, linesLinked: 0, problems: [], log: [] };
  const types = await db.contractType.findMany({ select: { name: true } });
  const validTypes = new Map(types.map((t) => [normalizeArabic(t.name), t.name]));

  for (const d of decisions || []) {
    const cid = Number(d.contractId || 0);
    const action = (d.action || ACT_SKIP).trim();
    const tname = (d.typeName || "").trim();
    if (!cid || action === ACT_SKIP) {
      stats.skipped++;
      continue;
    }
    const realType = validTypes.get(normalizeArabic(tname));
    if (!realType) {
      stats.problems.push(`عقد #${cid}: النوع «${tname}» غير موجود — لم يُنفَّذ شيء.`);
      continue;
    }

    const contract = await db.contract.findUnique({ where: { id: cid }, select: { id: true, contractNumber: true, contractType: true } });
    if (!contract) {
      stats.problems.push(`عقد #${cid}: غير موجود.`);
      continue;
    }

    // حماية مزدوجة: تقدّم فعلي + إعادة بناء = إذن صريح ثانٍ، وإلا يُخفَّض تلقائيًا للنوع فقط
    let effAction = action;
    if (action === ACT_TYPE_STAGES) {
      const [hasStages, hasReceipts, hasPlan] = await Promise.all([
        db.contractStage.count({ where: { contractId: cid } }),
        db.voucher.count({ where: { contractId: cid, vtype: "receipt", cancelled: false } }),
        db.paymentPlanItem.count({ where: { contractId: cid } }),
      ]);
      const hasProgress = hasStages > 0 || hasReceipts > 0 || hasPlan > 0;
      if (hasProgress && !allowDestructive) {
        effAction = ACT_TYPE_ONLY;
        stats.downgraded++;
        stats.log.push(`عقد #${cid} (${contract.contractNumber}): عليه تقدّم فعلي — نُفِّذ «تحديث النوع فقط» ولم تُمس مراحله.`);
      }
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.contract.update({ where: { id: cid }, data: { contractType: realType } });
        if (effAction === ACT_TYPE_STAGES) {
          const built = await rebuildContractStages(tx, cid, realType);
          stats.stagesRebuilt++;
          stats.log.push(`عقد #${cid} (${contract.contractNumber}): أُعيد بناء المراحل (${built} مرحلة).`);
        }
        const linked = await linkPlanLinesToStages(tx, cid, realType);
        if (linked > 0) {
          stats.linesLinked += linked;
          stats.log.push(`عقد #${cid}: رُبطت ${linked} دفعة بمراحل القالب الجديد.`);
        }
        await tx.contractEvent.create({
          data: {
            contractId: cid,
            eventType: "إصلاح النوع",
            description: `تحديث النوع من «${contract.contractType || UNSPECIFIED}» إلى «${realType}»${effAction === ACT_TYPE_STAGES ? " مع إعادة بناء المراحل" : " (المراحل لم تُمس)"}`,
            username,
          },
        });
        await audit(tx, {
          username,
          action: "إصلاح نوع عقد",
          entityType: "contract",
          entityId: cid,
          entityName: contract.contractNumber,
          reason: `${contract.contractType || UNSPECIFIED} → ${realType} · ${effAction}`,
        });
      });
      stats.typeUpdated++;
    } catch (exc) {
      stats.problems.push(`عقد #${cid}: تعذّر التنفيذ — ${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }
  return stats;
}

/** تاريخ اليوم القياسي — للاستخدام الداخلي عند الحاجة */
export const fixToday = todayStr;
