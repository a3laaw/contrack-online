import "server-only";
import { db } from "@/lib/db";
import { normalizeArabic } from "@/lib/api-utils";
import type { Prisma } from "@prisma/client";
import type { QuotationItemRow, QuotationRow } from "@/lib/quotes-core";

/**
 * عروض الأسعار — طبقة الخادم (بند 12).
 * مرآة lifecycle_service.list_quotations/get_quotation: ربط اسم العميل والمشروع،
 * البنود بترتيبها، الإجمالي مخزَّن من البنود، بحث مطبَّع على
 * (رقم العرض · اسم العميل · اسم المشروع) + فلتر الحالة + ORDER BY id DESC.
 */

const QUOTATION_SELECT = {
  id: true,
  quotationNumber: true,
  customerId: true,
  projectId: true,
  description: true,
  totalAmount: true,
  status: true,
  validUntil: true,
  notes: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { name: true } },
  project: { select: { name: true } },
  createdByUser: { select: { fullName: true, username: true } },
  _count: { select: { items: true } },
} satisfies Prisma.QuotationSelect;

const ITEMS_SELECT = {
  id: true,
  description: true,
  unit: true,
  quantity: true,
  unitPrice: true,
  totalPrice: true,
  sortOrder: true,
} satisfies Prisma.QuotationItemSelect;

type QuotationWithJoins = Prisma.QuotationGetPayload<{ select: typeof QUOTATION_SELECT }>;
type ItemWithTotal = Prisma.QuotationItemGetPayload<{ select: typeof ITEMS_SELECT }>;

export function toQuotationItemRow(i: ItemWithTotal): QuotationItemRow {
  return {
    id: i.id,
    description: i.description || "",
    unit: i.unit || "",
    quantity: Number(i.quantity),
    unitPrice: Number(i.unitPrice),
    totalPrice: Number(i.totalPrice),
    sortOrder: i.sortOrder,
  };
}

export function toQuotationRow(
  q: QuotationWithJoins,
  items?: QuotationItemRow[]
): QuotationRow {
  return {
    id: q.id,
    quotationNumber: q.quotationNumber,
    customerId: q.customerId,
    customerName: q.customer?.name || "",
    projectId: q.projectId,
    projectName: q.project?.name || "",
    description: q.description || "",
    totalAmount: Number(q.totalAmount),
    status: q.status || QUOTATION_STATUS_DEFAULT_VALUE,
    validUntil: q.validUntil || "",
    notes: q.notes || "",
    createdBy: q.createdBy,
    createdByName: q.createdByUser?.fullName || q.createdByUser?.username || "",
    itemsCount: q._count.items,
    ...(items !== undefined ? { items } : {}),
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

const QUOTATION_STATUS_DEFAULT_VALUE = "جديد";

/** القائمة: فلاتر customerId/status/q — بحث مطبَّع (رقم العرض · العميل · المشروع) الأحدث أولًا */
export async function listQuotations(opts: {
  customerId?: number;
  status?: string;
  q?: string;
}): Promise<QuotationRow[]> {
  const where: Prisma.QuotationWhereInput = {};
  if (opts.customerId && opts.customerId > 0) where.customerId = opts.customerId;
  if (opts.status) where.status = opts.status;

  const q = (opts.q || "").trim();
  let rows = await db.quotation.findMany({
    where,
    select: QUOTATION_SELECT,
    orderBy: { id: "desc" },
    take: 2000,
  });

  const nq = normalizeArabic(q);
  if (nq.length >= 1) {
    rows = rows.filter((row) => {
      const hay = normalizeArabic(
        [row.quotationNumber, row.description, row.customer?.name, row.project?.name]
          .filter(Boolean)
          .join(" ")
      );
      return hay.includes(nq);
    });
  }
  return rows.map((row) => toQuotationRow(row));
}

/** عرض واحد ببنوده الكاملة (مرآة get_quotation) */
export async function getQuotationRow(id: number): Promise<QuotationRow | null> {
  const q = await db.quotation.findUnique({ where: { id }, select: QUOTATION_SELECT });
  if (!q) return null;
  const items = await db.quotationItem.findMany({
    where: { quotationId: id },
    select: ITEMS_SELECT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return toQuotationRow(q, items.map(toQuotationItemRow));
}
