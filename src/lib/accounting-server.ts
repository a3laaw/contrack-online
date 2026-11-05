import "server-only";
import { db } from "@/lib/db";
import type { PrismaClient } from "@prisma/client";
import { ACCOUNT_SEED, type AccountSeedNode } from "@/lib/accounting-core";

/**
 * accounting-server.ts — بذر دليل الحسابات الكويتي القياسي لكل شركة — Task 102.
 * عديم الأثر التكراري: يبذر فقط الشركة الفارغة (نمط ensureSeedData) —
 * العميل المحمي يحقن companyId آليًا فالشجرة تُنشأ في نطاق الشركة الحالية حصرًا.
 * Task 107: يقبل عميلًا اختياريًا (الغلاف المحصور) ليُبذر بترتيب صحيح قبل
 * قواعد الترحيل في ensureSeedData — فتُحسم أكواد البذرة على دليل موجود.
 */

type DbClient = PrismaClient;

/** ترقيم الترتيب تعاقبي على مستوى الشجرة كاملة */
function nextSort(): { next: () => number } {
  let n = 0;
  return { next: () => n++ };
}

async function seedNode(
  client: DbClient,
  node: AccountSeedNode,
  parentId: number | null,
  sort: { next: () => number }
): Promise<void> {
  const leaf = node.children?.length ? false : node.leaf ?? true;
  const parent = await client.account.create({
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
    await seedNode(client, child, parent.id, sort);
  }
}

/**
 * ضمان وجود الدليل القياسي للشركة الحالية — يعيد عدد الحسابات بعد التأكد.
 * يُستدعى من GET /api/accounts (كما تُبذر شجرة المصروفات عند أول قراءة)
 * ومن زر «بذر الدليل القياسي» في الشاشة ومن ensureSeedData قبل قواعد الترحيل.
 */
export async function ensureChartOfAccounts(
  client?: DbClient
): Promise<{ seeded: boolean; count: number }> {
  const c = client || db;
  const existing = await c.account.count();
  if (existing > 0) return { seeded: false, count: existing };

  const sort = nextSort();
  for (const node of ACCOUNT_SEED) {
    await seedNode(c, node, null, sort);
  }
  const count = await c.account.count();
  return { seeded: true, count };
}
