/**
 * مراجع وأنواع إدارة أنواع العقود + إجراءات مركز العقود (المرحلة 7-ج).
 * مرآة حرفية للمكتبي V9.15.18:
 *   - contract_type_service.py: MODES + _validate + _validate_unit + حارس الشامل (V3.30)
 *   - lifecycle_service.py:11 CONTRACT_STATUSES و:230 change_contract_status (مبلغ الإغلاق)
 *   - contract_hub.py:591+ نافذة التعديل (اسم العقد يتبع النوع — «غير محدد» يُبقي الاسم)
 * دوال نقية بلا قاعدة بيانات — تُستخدم من الواجهة ومسارات الـAPI معًا.
 */

// ==================== رسائل الحرس الحرفية (المكتبي) ====================

export const TYPE_ERR_NAME = "اسم نوع العقد مطلوب.";
export const TYPE_ERR_AMOUNT = "المبلغ لا يمكن أن يكون سالبًا.";
export const TYPE_ERR_UNIT_PRICE = "سعر الوحدة لا يمكن أن يكون سالبًا.";
export const TYPE_ERR_BUNDLE_SUP = "النوع الشامل لا يكون إشرافيًا — أضف الإشراف مكوّنًا بداخله.";

// ==================== أنماط التسعير (contract_type_service.MODES) ====================

export type PricingMode = "lump" | "unit" | "items" | "bundle";

export const PRICING_MODES: { value: PricingMode; label: string }[] = [
  { value: "lump", label: "مبلغ مقطوع" },
  { value: "unit", label: "وحدة × سعر" },
  { value: "items", label: "بنود مقابل أسعار" },
  { value: "bundle", label: "عقد شامل (مكوّنات)" },
];

export function pricingModeLabel(mode: string | null | undefined): string {
  const m = (mode || "").trim();
  return PRICING_MODES.find((x) => x.value === m)?.label ?? PRICING_MODES[0].label;
}

// ==================== حارس مدخلات النوع (add_type/update_type) ====================

export interface ContractTypeInput {
  name?: string;
  defaultAmount?: number;
  unitPrice?: number;
  pricingMode?: string;
  isSupervision?: boolean;
}

/**
 * حرس موحّد بترتيب المكتبي: الاسم ← المبلغ ← سعر الوحدة ← الشامل/الإشرافي.
 * يعيد رسالة الخطأ الحرفية أو فراغًا عند السليم.
 * الحقول الغائبة لا تُرفض (تصلح لدمج PATCH مع القيم القائمة قبل التمرير).
 */
export function validateTypeInput(input: ContractTypeInput): string {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return TYPE_ERR_NAME;
  if (input.defaultAmount !== undefined && Number(input.defaultAmount) < 0) return TYPE_ERR_AMOUNT;
  if (input.unitPrice !== undefined && Number(input.unitPrice) < 0) return TYPE_ERR_UNIT_PRICE;
  if ((input.pricingMode || "").trim() === "bundle" && Boolean(input.isSupervision)) return TYPE_ERR_BUNDLE_SUP;
  return "";
}

// ==================== تصنيف الأنواع (Task 95) ====================

/**
 * تطبيع قيمة التصنيف القادمة من الإدخال/API: قصّ الحواف وحصر الطول بـ 60 حرفًا.
 * الفراغ ⇒ "" (بلا تصنيف).
 */
export function normalizeTypeCategory(value: unknown): string {
  const s = String(value ?? "").trim().slice(0, 60);
  return s;
}

/** نوع بصيغة مصغّرة لاشتقاق التصنيفات */
export interface CategorizedType {
  category?: string | null;
  active?: boolean;
}

/**
 * اشتقاق قائمة التصنيفات تلقائيًا من الأنواع نفسها (أبناؤها) — بلا جدول تصنيفات مستقل
 * وبلا كتابة حرة: التصنيف موجود لأن له أنواعًا. الفراغ/المحذوف مستبعد.
 */
export function deriveTypeCategories(types: CategorizedType[]): string[] {
  const set = new Set<string>();
  for (const t of types) {
    const c = normalizeTypeCategory(t.category);
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ar"));
}

/** تجميع الأنواع تحت تصنيفاتها للعرض الشجري في القوائم (المجموعات مرتبة والفراغ آخرًا) */
export function groupTypesByCategory<T extends CategorizedType & { name: string }>(
  types: T[]
): { category: string; types: T[] }[] {
  const withCat = types.filter((t) => normalizeTypeCategory(t.category));
  const withoutCat = types.filter((t) => !normalizeTypeCategory(t.category));
  const groups = deriveTypeCategories(withCat).map((category) => ({
    category,
    types: withCat.filter((t) => normalizeTypeCategory(t.category) === category),
  }));
  if (withoutCat.length > 0) groups.push({ category: "", types: withoutCat });
  return groups;
}

// ==================== حالات العقد (lifecycle_service.CONTRACT_STATUSES) ====================

/** القائمة الكاملة الثمانية بترتيب المكتبي — نافذة «تغيير حالة العقد» */
export const statusOptionsList = [
  "مسودة",
  "تحت المراجعة",
  "معتمد",
  "نشط",
  "متوقف",
  "منتهي",
  "مغلق",
  "ملغى",
] as const;

// ==================== اسم العقد من النوع (contract_hub.py:636) ====================

/**
 * اسم العقد المعروض يتبع نوع العقد المختار ولا يُعدّل يدويًا.
 * «غير محدد»/الفراغ يُبقي الاسم الحالي للعقد (سلوك الويب المعتمد).
 */
export function derivesNameFromType(typeName: string | "" | null | undefined, fallback: string): string {
  const t = (typeName ?? "").trim();
  if (!t || t === "غير محدد") return fallback;
  return t;
}

// ==================== سطر مبلغ الإغلاق في وصف الحدث (lifecycle:270) ====================

/**
 * « · مبلغ الإغلاق: X د.ك» عندما المبلغ > 0 — بتنسيق المكتبي (3 منازل بفواصل).
 * الصفر/السالب ⇒ فراغ (لا سطر بلا مبلغ).
 */
export function closeAmountSuffix(amount: number | null | undefined): string {
  const v = Number(amount ?? 0);
  if (!(v > 0)) return "";
  const formatted = v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return ` · مبلغ الإغلاق: ${formatted} د.ك`;
}
