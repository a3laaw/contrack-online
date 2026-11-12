import "server-only";

/**
 * أدوات مشتركة للقوائم المرجعية (الجلسة 11) — نقية خادميًا بلا HTTP:
 * route.ts لا تجيز exports إضافية فتعيش هنا، وتستوردَها المسارات الثلاثة.
 */

/** تعيين بند القائمة (القيمة عشرية اختيارية) — شكل موحد يستلمه العميل */
export function mapRefItem(it: {
  id: number;
  listId: number;
  name: string;
  code: string;
  value: unknown;
  notes: string;
  active: boolean;
  sortOrder: number;
  stageLinks: { id: number; stageId: number; stage: { stageName: string; transactionType: string } }[];
}) {
  return {
    id: it.id,
    listId: it.listId,
    name: it.name,
    code: it.code,
    value: it.value === null || it.value === undefined ? null : Number(it.value),
    notes: it.notes,
    active: it.active,
    sortOrder: it.sortOrder,
    stageLinks: it.stageLinks.map((l) => ({
      id: l.id,
      stageId: l.stageId,
      stageName: l.stage.stageName,
      transactionType: l.stage.transactionType,
    })),
  };
}

/** قراءة قائمة معرّفات المراحل الواردة — أرقام صحيحة بلا تكرار */
export function parseStageIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const n = Number(x);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** بنود include بروابط المراحل — شكل واحد يعاد استخدامه في القراءة بعد الكتابة */
export const refItemInclude = {
  stageLinks: {
    orderBy: [{ id: "asc" as const }],
    include: { stage: { select: { stageName: true, transactionType: true } } },
  },
} as const;
