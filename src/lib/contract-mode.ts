/**
 * G6 — نمط التسعير لكل عقد (المكتبي contract_service.contract_mode 299–336):
 * «مصدر القرار الوحيد» — بيانات العقد نفسه تسبق إعدادات النوع حتى لا يتغيّر
 * سلوك أي عقد قائم عند تعديل نوعه في الإعدادات. الترتيب مقصود:
 *   1) نوع شامل (bundle)          ⟵ bundle
 *   2) عقد له بنود مسجّلة          ⟵ items
 *   3) عقد له تاريخ تعهد إشراف     ⟵ unit (وحدته شهر)
 *   4) عقد له سعر وحدة محفوظ > 0   ⟵ unit
 *   5) نمط نوعه من الإعدادات
 *   6) الافتراضي                   ⟵ lump
 * ملف بلا server-only لقابلية الاختبار المباشر.
 */

export type PricingMode = "bundle" | "items" | "unit" | "lump";

export interface PricingModeInput {
  /** هل نوع العقد شامل (is_bundle في إعدادات النوع)؟ */
  contractTypeIsBundle: boolean;
  /** عدد بنود العقد المسجلة (boq_items غير المحذوفة) */
  itemsCount: number;
  /** تاريخ تعهد الإشراف على العقد — وجوده يجعل النمط unit */
  supStartDate: string;
  /** سعر الوحدة المحفوظ على العقد */
  unitPrice: number;
  /** نمط النوع من الإعدادات (lump|unit|items|bundle) */
  typeMode: string;
}

export function resolvePricingMode(i: PricingModeInput): PricingMode {
  if (i.contractTypeIsBundle) return "bundle";
  if (i.itemsCount > 0) return "items";
  if ((i.supStartDate || "").trim()) return "unit";
  if (Number(i.unitPrice || 0) > 0) return "unit";
  const tm = (i.typeMode || "").trim();
  if (tm === "bundle" || tm === "items" || tm === "unit" || tm === "lump") return tm;
  return "lump";
}

export const PRICING_MODE_LABEL: Record<PricingMode, string> = {
  bundle: "شامل (مكونات)",
  items: "بنود",
  unit: "وحدة × سعر",
  lump: "مقطوعية",
};
