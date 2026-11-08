/**
 * warehouses-constants.ts — ثوابت موديول المخازن (docs/warehouses-design.md §4) — نقي 100% بلا DB ولا React:
 * • الأنواع المعرفية للحركة الأربعة ومصادر الإدخال الثلاثة (درس G7 — قيم بجداول ثابتة لا نصوص حرة)
 * • بادئات الترقيم التسلسلي لكل شركة (د5 — نمط RV/PV/TV/CV/SD)
 * • تسميات العرض العربية + منسق الكميات (حتى 3 خانات عشرية)
 */

/** تقريب مالي موحد — د.ك ثلاثي العشرة (نفس r3 في hr-constants/contrack-core) */
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ===== أنواع الأذون الأربعة (د3) =====
export const DOC_KINDS = ["entry", "issue", "transfer", "count"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  entry: "إدخال",
  issue: "صرف",
  transfer: "تحويل",
  count: "جرد",
};

// ===== مصادر الإدخال الثلاثة (د11) =====
export const ENTRY_SOURCES = ["cash", "credit", "return"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const ENTRY_SOURCE_LABELS: Record<EntrySource, string> = {
  cash: "شراء نقدي",
  credit: "شراء آجل (مورد)",
  return: "مرتجع من موقع",
};

// ===== بادئات الترقيم لكل شركة عبر nextNumber (د5) =====
export const DOC_PREFIXES: Record<DocKind, string> = {
  entry: "WI",
  issue: "WO",
  transfer: "WT",
  count: "WC",
};

// ===== حالات الإذن (د6 — لا مسودات) =====
export const DOC_STATUSES = ["posted", "cancelled"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  posted: "مرحّل",
  cancelled: "ملغى",
};

// ===== حسابات البذر المؤجل (د9 — نمط ensureOne في hr-server) =====
export const WAREHOUSE_ACCOUNTS = {
  stock: { code: "1160", name: "مخزون المواد", type: "asset", xbrl: "kw:MaterialsInventory" },
  countDiff: { code: "5115", name: "فروق الجرد والهدر", type: "expense", xbrl: "kw:InventoryCountAdjustments" },
} as const;

/** أنواع القيود على الأستاذ — تظهر في شاشة القيود وتُفرز تقاريريًا (§5) */
export const STOCK_ENTRY_SOURCE_TYPES = ["inventory_entry", "inventory_issue", "inventory_count"] as const;
export type StockJournalSourceType = (typeof STOCK_ENTRY_SOURCE_TYPES)[number];

// ===== منسق الكميات — حتى 3 خانات وإزالة الأصفار الزائدة (0.500 ⇒ «0.5») =====
export function fmtQty(n: number): string {
  const v = r3(n);
  if (Object.is(v, -0)) return "0";
  return String(v);
}

/** فحص تاريخ ISO بسيط (YYYY-MM-DD) — الأنماط القائمة كلها تاريخ نصي */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
