import "server-only";
import { db } from "@/lib/db";
import { normalizeArabic } from "@/lib/api-utils";

/**
 * شجرة حسابات المصروفات — مقابلة حرفيًا لـ expense_account_service.py
 * (المكتبي المرجعي). الشجرة مستويان فقط: أب ثم ابن، والحذف ناعم
 * (إيقاف) لأن الحساب قد يُشار إليه من السندات.
 */

/** الشجرة الافتراضية — حرفيًا من DEFAULT_TREE */
export const DEFAULT_EXPENSE_TREE: Record<string, string[]> = {
  "مصروفات تشغيلية": ["بنزين / وقود", "صيانة سيارات", "كهرباء وماء", "اتصالات وإنترنت"],
  "مصروفات إدارية": ["رواتب", "سلف موظفين / قرض راتب", "إيجارات", "قرطاسية"],
  "مصروفات مشاريع": ["عمالة موقع", "مواد بناء", "رسوم بلدية", "مخططات واعتمادات"],
  "مصروفات تسويق ومبيعات": ["إعلانات", "عمولات", "ضيافة عملاء"],
  "مصروفات حكومية ورسوم": ["رسوم حكومية", "طوابع ومعاملات"],
  "مصروفات بنكية": ["عمولات بنكية"],
};

export const CUSTODY_PARENT = "العُهد";
export const CUSTODY_DEFAULT = "عهدة عامة";
export const IMPORTS_PARENT = "حسابات مستوردة / غير مصنفة";

/** أنواع الحساب المسموحة (من حوار الإعدادات المكتبي) */
export const EXPENSE_ACCOUNT_KINDS = ["expense", "advance", "asset"] as const;

export interface ExpenseAccountRow {
  id: number;
  parentId: number | null;
  name: string;
  fullPath: string;
  isActive: boolean;
  allowPosting: boolean;
  includeInProfitability: boolean;
  accountKind: string;
  sortOrder: number;
}

/** «عهد» في الاسم (طبيعَة) — لتمييز حسابات العهدة المكتوبة قديمًا كنص حر */
export function isCustodyLikeName(text: string): boolean {
  return normalizeArabic(text || "").includes("عهد");
}

/**
 * إنشاء الشجرة الافتراضية عند قاعدة فارغة فقط — كـ ensure_defaults في المكتبي.
 * (ترحيل الأسماء القديمة النصية لا ينطبق هنا: سندات الويب تستخدم معرفات FK).
 */
export async function ensureExpenseAccountDefaults(): Promise<void> {
  const count = await db.expenseAccount.count();
  if (count > 0) return;

  let order = 0;
  for (const [parentName, children] of Object.entries(DEFAULT_EXPENSE_TREE)) {
    order += 1;
    const parent = await db.expenseAccount.create({
      data: {
        name: parentName,
        parentId: null,
        isActive: true,
        allowPosting: false,
        includeInProfitability: true,
        accountKind: "expense",
        sortOrder: order,
        fullPath: parentName,
      },
    });
    for (const child of children) {
      order += 1;
      await db.expenseAccount.create({
        data: {
          name: child,
          parentId: parent.id,
          isActive: true,
          allowPosting: true,
          includeInProfitability: true,
          accountKind: "expense",
          sortOrder: order,
          fullPath: `${parentName} / ${child}`,
        },
      });
    }
  }

  const custodyParent = await db.expenseAccount.create({
    data: {
      name: CUSTODY_PARENT,
      parentId: null,
      isActive: true,
      allowPosting: false,
      includeInProfitability: false,
      accountKind: "advance",
      sortOrder: 8000,
      fullPath: CUSTODY_PARENT,
    },
  });
  await db.expenseAccount.create({
    data: {
      name: CUSTODY_DEFAULT,
      parentId: custodyParent.id,
      isActive: true,
      allowPosting: true,
      includeInProfitability: false,
      accountKind: "advance",
      sortOrder: 8001,
      fullPath: `${CUSTODY_PARENT} / ${CUSTODY_DEFAULT}`,
    },
  });

  await db.expenseAccount.create({
    data: {
      name: IMPORTS_PARENT,
      parentId: null,
      isActive: true,
      allowPosting: false,
      includeInProfitability: true,
      accountKind: "expense",
      sortOrder: 9000,
      fullPath: IMPORTS_PARENT,
    },
  });
}

/**
 * تحديث المسار الكامل لكل حساب — يكتب الصفوف المتغيّرة فقط (كالمكتبي).
 * تُستدعى بعد كل كتابة (إضافة/تعديل) لضمان صحة fullPath بمن فيها أبناء الأب المعاد تسميته.
 */
export async function refreshExpenseAccountPaths(): Promise<number> {
  const rows = await db.expenseAccount.findMany({
    select: { id: true, parentId: true, name: true, fullPath: true },
  });
  const info = new Map<number, { parentId: number | null; name: string }>();
  for (const r of rows) info.set(r.id, { parentId: r.parentId, name: r.name });

  const cache = new Map<number, string>();
  const pathOf = (aid: number): string => {
    const hit = cache.get(aid);
    if (hit !== undefined) return hit;
    const parts: string[] = [];
    const seen = new Set<number>();
    let cur: number | null = aid;
    while (cur !== null && info.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const node = info.get(cur)!;
      parts.push(node.name);
      cur = node.parentId;
    }
    const val = parts.reverse().join(" / ");
    cache.set(aid, val);
    return val;
  };

  const changed = rows.filter((r) => pathOf(r.id) !== (r.fullPath || ""));
  for (const r of changed) {
    await db.expenseAccount.update({ where: { id: r.id }, data: { fullPath: pathOf(r.id) } });
  }
  return changed.length;
}

/**
 * الترتيب المكتبي: ORDER BY COALESCE(parent_id,id), sort_order, name
 * — الأب يظهر أولًا ثم أبناؤه مباشرة.
 */
export function orderExpenseAccounts<T extends { id: number; parentId: number | null; sortOrder: number; name: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const ka = a.parentId ?? a.id;
    const kb = b.parentId ?? b.id;
    if (ka !== kb) return ka - kb;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, "ar");
  });
}

export function serializeExpenseAccount(r: {
  id: number;
  parentId: number | null;
  name: string;
  fullPath: string;
  isActive: boolean;
  allowPosting: boolean;
  includeInProfitability: boolean;
  accountKind: string;
  sortOrder: number;
}) {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    fullPath: r.fullPath,
    isActive: r.isActive,
    allowPosting: r.allowPosting,
    includeInProfitability: r.includeInProfitability,
    accountKind: r.accountKind,
    sortOrder: r.sortOrder,
  };
}
