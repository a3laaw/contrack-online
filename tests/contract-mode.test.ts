/**
 * G6 — نمط التسعير لكل عقد (المكتبي contract_service.contract_mode 299–336)
 * الترتيب مقصود: شامل ← بنود ← تاريخ إشراف ← سعر وحدة ← نمط النوع ← مقطوعية
 */

import { describe, expect, test } from "bun:test";
import { resolvePricingMode } from "../src/lib/contract-mode";

const base = {
  contractTypeIsBundle: false,
  itemsCount: 0,
  supStartDate: "",
  unitPrice: 0,
  typeMode: "lump",
};

describe("resolvePricingMode — ترتيب الحسم الخمسي (contract_mode المكتبي)", () => {
  test("النوع الشامل يتقدم على كل شيء (قد يحمل بنودًا وإشرافًا دون أن ينقلب)", () => {
    expect(resolvePricingMode({ ...base, contractTypeIsBundle: true, itemsCount: 5, supStartDate: "2026-01-01", unitPrice: 10, typeMode: "lump" })).toBe("bundle");
  });

  test("عقد له بنود مسجلة ⟵ items حتى لو نوعه unit", () => {
    expect(resolvePricingMode({ ...base, itemsCount: 1, supStartDate: "2026-01-01", typeMode: "unit" })).toBe("items");
  });

  test("تاريخ تعهد الإشراف ⟵ unit قبل فحص سعر الوحدة", () => {
    expect(resolvePricingMode({ ...base, supStartDate: "2026-03-01", unitPrice: 0, typeMode: "lump" })).toBe("unit");
  });

  test("سعر وحدة محفوظ > 0 ⟵ unit", () => {
    expect(resolvePricingMode({ ...base, unitPrice: 12.5, typeMode: "lump" })).toBe("unit");
  });

  test("سعر وحدة صفر لا يحسم unit", () => {
    expect(resolvePricingMode({ ...base, unitPrice: 0, typeMode: "lump" })).toBe("lump");
  });

  test("بلا شيء على العقد ⟵ نمط النوع (unit)", () => {
    expect(resolvePricingMode({ ...base, typeMode: "unit" })).toBe("unit");
  });

  test("بلا شيء على العقد ⟵ نمط النوع (items)", () => {
    expect(resolvePricingMode({ ...base, typeMode: "items" })).toBe("items");
  });

  test("الافتراضي النهائي ⟵ lump", () => {
    expect(resolvePricingMode({ ...base, typeMode: "" })).toBe("lump");
  });

  test("نمط نوع غير معروف يسقط على lump بأمان", () => {
    expect(resolvePricingMode({ ...base, typeMode: "weird" })).toBe("lump");
  });

  test("بيانات العقد تسبق النوع: عقد ببنود على نوع مقطوعي ⟵ items (لا يتأثر بتعديل النوع لاحقًا)", () => {
    expect(resolvePricingMode({ ...base, itemsCount: 3, typeMode: "lump" })).toBe("items");
  });

  test("إشراف بلا سعر يكفي لوحده ⟵ unit", () => {
    expect(resolvePricingMode({ ...base, supStartDate: " 2026-01-05 " })).toBe("unit");
  });
});
