import "server-only";
import { db } from "@/lib/db";
import { ACCOUNT_SEED, type AccountSeedNode } from "@/lib/accounting-core";

/**
 * accounting-server.ts — بذر دليل الحسابات الكويتي القياسي لكل شركة — Task 102.
 * عديم الأثر التكراري: يبذر فقط الشركة الفارغة (نمط ensureSeedData) —
 * العميل المحمي يحقن companyId آليًا فالشجرة تُنشأ في نطاق الشركة الحالية حصرًا.
 */

/** ترقيم الترتيب تعاقبي على مستوى الشجرة كاملة */
function nextSort(): { next: () => number } {
  let n = 0;
  return { next: () => n++ };
}

async function seedNode(node: AccountSeedNode, parentId: number | null, sort: { next: () => number }): Promise<void> {
  const leaf = node.children?.length ? false : node.leaf ?? true;
  const parent = await db.account.create({
    data: {
      code: node.code,
      name: node.name,
      type: node.type,
      nature: node.nature ?? (node.type === "asset" || node.type === "expense" ? "debit" : "credit"),
      parentId,
      isLeaf: leaf,
      allowPosting: node.allowPosting ?? leaf,
      isActive: true,
      isSystem: true,
      notes: node.notes ?? "",
      sortOrder: sort.next(),
      xbrlElement: node.xbrl ?? "",
    },
  });
  for (const child of node.children ?? []) {
    await seedNode(child, parent.id, sort);
  }
}

/**
 * ضمان وجود الدليل القياسي للشركة الحالية — يعيد عدد الحسابات بعد التأكد.
 * يُستدعى من GET /api/accounts (كما تُبذر شجرة المصروفات عند أول قراءة)
 * ومن زر «بذر الدليل القياسي» في الشاشة.
 */
export async function ensureChartOfAccounts(): Promise<{ seeded: boolean; count: number }> {
  const existing = await db.account.count();
  if (existing > 0) return { seeded: false, count: existing };

  const sort = nextSort();
  for (const node of ACCOUNT_SEED) {
    await seedNode(node, null, sort);
  }
  const count = await db.account.count();
  return { seeded: true, count };
}
