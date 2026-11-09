/**
 * اختبارات نواة «التنفيذ الميداني — مقايسة التنفيذ» — بند NOVA 5.
 * docs/field-execution-design.md — نواة نقية حصرًا (بلا DB): اشتقاق صف المقايسة (درس G9)،
 * تحقق إدخال سجل التنفيذ، مطابِقات GPS، ومجاميع المقايسة على مستوى العقد.
 */
import { describe, expect, test } from "bun:test";

import {
  deriveTakeoffRow,
  GPS_RE,
  summarizeTakeoff,
  validateExecutionInput,
  type TakeoffInputRow,
  type TakeoffRow,
} from "../src/lib/field-execution-core";

/** مدخل صف أساسي — بند أصلي 100 وحدة × 5 بدون أي حركة */
const row = (over: Partial<TakeoffInputRow>): TakeoffInputRow => ({
  boqItemId: 1,
  qty: 100,
  unitPrice: 5,
  plannedQty: 0,
  changeQty: 0,
  executedQty: 0,
  documentedQty: 0,
  ...over,
});

describe("deriveTakeoffRow — اشتقاق صف المقايسة (G9)", () => {
  test("بند أصلي بلا أوامر تغييرية ⇒ التعاقدي = الفعلي", () => {
    const r = deriveTakeoffRow(row({}));
    expect(r.effectiveQty).toBe(100);
    expect(r.contractQty).toBe(100);
    expect(r.changeQty).toBe(0);
  });

  test("بند منقسم (100 فعلي منها 30 تغييري) ⇒ تعاقدي 70 وتغييري 30", () => {
    const r = deriveTakeoffRow(row({ qty: 100, changeQty: 30 }));
    expect(r.contractQty).toBe(70);
    expect(r.changeQty).toBe(30);
    expect(r.effectiveQty).toBe(100);
  });

  test("تغييري يتجاوز الكمية ⇒ التعاقدي أرضية صفر بلا سالب", () => {
    const r = deriveTakeoffRow(row({ qty: 50, changeQty: 80 }));
    expect(r.contractQty).toBe(0);
    expect(r.changeQty).toBe(80);
  });

  test("بند منشأ بملحق: كميته كلها تغييرية ⇒ تعاقديه صفر والفعلي باقٍ", () => {
    const r = deriveTakeoffRow(row({ qty: 10, changeQty: 10 }));
    expect(r.contractQty).toBe(0);
    expect(r.effectiveQty).toBe(10);
  });

  test("قيمة المنفذ = المنفذ × سعر الوحدة بتقريب ثلاثي", () => {
    expect(deriveTakeoffRow(row({ executedQty: 12.345, unitPrice: 3 })).executedAmount).toBe(37.035);
    expect(deriveTakeoffRow(row({ executedQty: 60, unitPrice: 5 })).executedAmount).toBe(300);
  });

  test("نسبة التقدم: صفر ثم جزئي 33.3% ثم كامل 100%", () => {
    expect(deriveTakeoffRow(row({})).progressPct).toBe(0);
    expect(deriveTakeoffRow(row({ executedQty: 33.3 })).progressPct).toBe(33.3);
    expect(deriveTakeoffRow(row({ executedQty: 100 })).progressPct).toBe(100);
  });

  test("التنفيذ الزائد يظهر كما هو فوق 100% (قرار موثق — الاشتقاق لا يخفي)", () => {
    expect(deriveTakeoffRow(row({ executedQty: 130 })).progressPct).toBe(130);
  });

  test("كمية فعلية صفر ⇒ نسبة صفر بلا قسمة على صفر", () => {
    const r = deriveTakeoffRow(row({ qty: 0, executedQty: 5 }));
    expect(r.progressPct).toBe(0);
    expect(r.contractQty).toBe(0);
  });
});

describe("validateExecutionInput — تحقق إدخال سجل التنفيذ", () => {
  test("إدخال كامل صحيح ⇒ ok مع القيم المطبعة والملاحظة المقصوصة", () => {
    const c = validateExecutionInput({
      executionDate: "2026-11-14",
      qty: "40.0004",
      gpsLat: "29.3759",
      gpsLng: "47.9774",
      note: " دفعة أولى ",
    });
    expect(c.ok).toBe(true);
    expect(c.value).toEqual({ executionDate: "2026-11-14", qty: 40, gpsLat: "29.3759", gpsLng: "47.9774", note: "دفعة أولى" });
  });

  test("تاريخ مفقود أو غير صالح ⇒ رسالة الصيغة", () => {
    expect(validateExecutionInput({ qty: 5 }).error).toBe("تاريخ التنفيذ مطلوب بصيغة YYYY-MM-DD");
    expect(validateExecutionInput({ executionDate: "14/11/2026", qty: 5 }).error).toBe("تاريخ التنفيذ مطلوب بصيغة YYYY-MM-DD");
  });

  test("كمية صفر أو سالبة أو غير رقمية ⇒ رسالة الكمية", () => {
    expect(validateExecutionInput({ executionDate: "2026-11-14", qty: 0 }).error).toBe("كمية التنفيذ يجب أن تكون أكبر من صفر");
    expect(validateExecutionInput({ executionDate: "2026-11-14", qty: -2 }).error).toBe("كمية التنفيذ يجب أن تكون أكبر من صفر");
    expect(validateExecutionInput({ executionDate: "2026-11-14", qty: "abc" }).error).toBe("كمية التنفيذ يجب أن تكون أكبر من صفر");
  });

  test("نص رقمي للكمية يُقبل بالتحويل", () => {
    const c = validateExecutionInput({ executionDate: "2026-11-14", qty: "12.5" });
    expect(c.ok).toBe(true);
    expect(c.value?.qty).toBe(12.5);
  });

  test("GPS: صالح يُقبل · فارغ يُطبَّع لنص فارغ · غير صالح يُرفض", () => {
    const c = validateExecutionInput({ executionDate: "2026-11-14", qty: 1, gpsLat: "-29.3759", gpsLng: "" });
    expect(c.ok).toBe(true);
    expect(c.value?.gpsLat).toBe("-29.3759");
    expect(c.value?.gpsLng).toBe("");
    expect(validateExecutionInput({ executionDate: "2026-11-14", qty: 1, gpsLat: "29,3759" }).error).toBe("إحداثيات GPS غير صالحة");
    expect(validateExecutionInput({ executionDate: "2026-11-14", qty: 1, gpsLng: "47.97" }).error).toBe("إحداثيات GPS غير صالحة");
  });

  test("ملاحظة مفقودة ⇒ نص فارغ افتراضيًا", () => {
    const c = validateExecutionInput({ executionDate: "2026-11-14", qty: 3 });
    expect(c.ok).toBe(true);
    expect(c.value?.note).toBe("");
  });
});

describe("GPS_RE — مطابِقات الإحداثيات", () => {
  test("يقبل 4–8 منازل عشرية ودرجة سالبة", () => {
    expect(GPS_RE.test("29.3759")).toBe(true);
    expect(GPS_RE.test("-47.97741")).toBe(true);
    expect(GPS_RE.test("0.12345678")).toBe(true);
  });

  test("يرفض بلا منازل أو منزل واحد أو نصًا آخر", () => {
    expect(GPS_RE.test("29")).toBe(false);
    expect(GPS_RE.test("29.1")).toBe(false);
    expect(GPS_RE.test("29,3759")).toBe(false);
    expect(GPS_RE.test("")).toBe(false);
  });
});

describe("summarizeTakeoff — مجاميع المقايسة على مستوى العقد", () => {
  // بند 1: أصلي 100×5 (مخطط 80) منه منفذ 60 موثق 20 · بند 2: منشأ بملحق 10×6 كلها تغييرية منه منفذ 4
  const rows: TakeoffRow[] = [
    deriveTakeoffRow(row({ boqItemId: 1, qty: 100, unitPrice: 5, plannedQty: 80, executedQty: 60, documentedQty: 20 })),
    deriveTakeoffRow(row({ boqItemId: 2, qty: 10, unitPrice: 6, changeQty: 10, executedQty: 4 })),
  ];

  test("المجاميع تُبنى من الصفوف: التعاقدي/التغييري/المخطط/المنفذ/الموثق والمفوتر يمر كما هو", () => {
    const t = summarizeTakeoff(rows, 1000, 400);
    expect(t.contractAmount).toBe(500); // 100×5 + 0×6
    expect(t.changeAmount).toBe(60); // 0×5 + 10×6
    expect(t.plannedAmount).toBe(400); // 80×5 — المخطط لا يُقص وقد يتجاوز
    expect(t.executedAmount).toBe(324); // 60×5 + 4×6
    expect(t.documentedAmount).toBe(100); // 20×5
    expect(t.invoicedAmount).toBe(1000);
    expect(t.collectedAmount).toBe(400);
  });

  test("نسبة التقدم على مستوى المقايسة = المنفذ / (التعاقدي + التغييري) بمنزلة واحدة", () => {
    expect(summarizeTakeoff(rows, 0, 0).progressPct).toBe(57.9); // 324 / 560
  });

  test("مقايسة فارغة ⇒ أصفار بلا قسمة على صفر", () => {
    const t = summarizeTakeoff([], 0, 0);
    expect(t.progressPct).toBe(0);
    expect(t.contractAmount).toBe(0);
    expect(t.executedAmount).toBe(0);
  });
});
