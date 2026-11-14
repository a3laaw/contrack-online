import "server-only";

import { db } from "@/lib/db";

/**
 * أدوات مشتركة للقوائم المرجعية (الجلسة 11) — نقية خادميًا بلا HTTP:
 * route.ts لا تجيز exports إضافية فتعيش هنا، وتستوردَها المسارات الثلاثة.
 * + الهيكل التنظيمي (docs/org-structure-design.md): parentId عابر للقوائم
 *   (قسم ← إدارة، وظيفة ← قسم) مع تحقق نوع الأب وحصر الشركة عبر الغلاف.
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
  parentId?: number | null;
  childrenCount?: number;
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
    parentId: it.parentId ?? null,
    childrenCount: it.childrenCount ?? 0,
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

/** بنود include بروابط المراحل وعدّاد الأبناء — شكل واحد يعاد استخدامه في القراءة بعد الكتابة */
export const refItemInclude = {
  stageLinks: {
    orderBy: [{ id: "asc" as const }],
    include: { stage: { select: { stageName: true, transactionType: true } } },
  },
  _count: { select: { children: true } },
} as const;

/** تحويل _count.children إلى childrenCount لخريطة mapRefItem */
export function withChildrenCount<T extends { _count?: { children: number } }>(item: T): Omit<T, "_count"> & { childrenCount: number } {
  const { _count, ...rest } = item;
  return { ...rest, childrenCount: _count?.children ?? 0 };
}

/**
 * قواعد أب الهيكل التنظيمي حسب مفتاح قائمة الابن (D1):
 *   الأقسامdepartments ← أبها من الإداراتadmins · الوظائفjobs ← أبها من الأقسامdepartments.
 * خارج هذين النوعين لا هرمية — فلا دوران بنيويًا أصلًا.
 */
const PARENT_LIST_KEY: Record<string, string> = {
  departments: "admins",
  jobs: "departments",
};

const PARENT_KIND_MSG: Record<string, string> = {
  departments: "أب القسم يجب أن يكون بندًا من قائمة الإدارات",
  jobs: "أب الوظيفة يجب أن يكون بندًا من قائمة الأقسام",
};

/**
 * تحقق parentId الوارد ل بند مرجعي (إضافة أو تعديل):
 * - raw null ⇒ فك الارتباط ({ parentId: null }).
 * - raw رقم ⇒ الأب موجود بنفس الشركة (حصر الغلاف آليًا) ومفعّل، ومن نوع القائمة الصحيح،
 *   وليس البند نفسه. يعيد { parentId } أو رسالة خطأ عربية.
 * - selfId: معرّف البند المعدَّل لمنع الأب عن نفسه (null عند الإضافة).
 */
export async function resolveRefParent(
  raw: unknown,
  childListKey: string,
  selfId: number | null
): Promise<{ parentId: number | null } | string> {
  if (raw === null) return { parentId: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return "معرّف الأب غير صحيح";
  if (selfId !== null && n === selfId) return "لا يمكن ربط البند بنفسه";

  const allowedKey = PARENT_LIST_KEY[childListKey];
  if (!allowedKey) return "هذه القائمة لا تدخل في الهيكل التنظيمي — الارتباط للأقسام والوظائف حصرًا";

  const parent = await db.refItem.findFirst({
    where: { id: n, active: true },
    select: { id: true, name: true, list: { select: { key: true, name: true } } },
  });
  if (!parent) return "البند الأب غير موجود أو غير مفعّل";
  if (parent.list.key !== allowedKey) return PARENT_KIND_MSG[childListKey];

  return { parentId: parent.id };
}

/**
 * تحقق معرّفات بنود القوائم المرجعية الواردة للربط بسطور الدفعات (RefItemPayment):
 * أرقام صحيحة فريدة موجودة فعلاً ومفعلة وبقوائم مفعلة — محصورة بشركة الجلسة عبر الغلاف.
 * يعيد المصفوفة النظيفة أو نص رسالة خطأ عند وجود معرف غير صالح.
 */
export async function resolveRefItemIds(raw: unknown): Promise<number[] | string> {
  const ids: number[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const n = Number(x);
      if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
    }
  }
  if (ids.length === 0) return [];
  const found = await db.refItem.findMany({
    where: { id: { in: ids }, active: true, list: { active: true } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    return "أحد بنود القوائم المرجعية غير موجود أو غير مفعّل";
  }
  return ids;
}
