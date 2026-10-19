/**
 * اختبار المرحلة 8 — باني xlsx حقيقي (exceljs)
 * المرجع المكتبي: reports/tabular_pdf.py:651+ (rightToLeft · ترويسة بلون أساسي وخط أبيض
 * · number_format «#,##0.000» لأعمدة الأرقام · صف إجماليات مميز) وcustody_excel.py (تجميد الرأس).
 * التحقق: بناء المصنف ثم قراءته بـexceljs والتأكد من RTL والعناوين العربية والأرقام كأرقام.
 */

import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { buildXlsxBuffer, reportTableToSheet } from "@/lib/xlsx-core";

describe("buildXlsxBuffer — مصنف حقيقي RTL", () => {
  test("بناء ثم قراءة: RTL + تجميد الرأس + نصوص عربية + أرقام كأرقام", async () => {
    const buf = await buildXlsxBuffer({
      sheets: [
        {
          name: "تقرير الاختبار",
          columns: [{ header: "التاريخ" }, { header: "المبلغ", width: 18 }],
          rows: [
            ["2026-01-01", 7500],
            ["2026-01-02", 2000.5],
          ],
          numberCols: [1],
          totalsRow: ["الإجمالي", 9500.5],
        },
      ],
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
    // توقيع xlsx (ZIP)
    expect(buf.subarray(0, 2).toString("ascii")).toBe("PK");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws).toBeDefined();
    expect(ws.name).toBe("تقرير الاختبار");

    // RTL + تجميد صف الرأس
    const view = ws.views[0] as ExcelJS.WorksheetView;
    expect((view as ExcelJS.WorksheetViewBasic).rightToLeft).toBe(true);
    expect((view as ExcelJS.WorksheetViewFrozen).state).toBe("frozen");
    expect((view as ExcelJS.WorksheetViewFrozen).ySplit).toBe(1);

    // نصوص الترويسة العربية حرفيًا
    expect(ws.getCell("A1").value).toBe("التاريخ");
    expect(ws.getCell("B1").value).toBe("المبلغ");

    // ترويسة بخط أبيض عريض على تعبئة أساسية
    const h = ws.getCell("B1");
    expect(h.font?.bold).toBe(true);
    expect(h.font?.color?.argb).toContain("FFFFFF");
    expect((h.fill as ExcelJS.FillPattern).fgColor?.argb).toContain("1F3A5F");

    // الأرقام أرقام لا نصوص — وبتنسيق المكتبي #,##0.000 لعمود الأرقام
    const n = ws.getCell("B2");
    expect(typeof n.value).toBe("number");
    expect(n.value).toBe(7500);
    expect(n.numFmt).toBe("#,##0.000");
    expect(ws.getCell("B3").value).toBe(2000.5);
    // عمود غير رقمي بلا تنسيق مالي
    expect(ws.getCell("A2").numFmt ?? "").not.toBe("#,##0.000");

    // صف الإجماليات حاضر وقيمه رقمية
    expect(ws.getCell("A4").value).toBe("الإجمالي");
    expect(ws.getCell("B4").value).toBe(9500.5);
    expect(ws.getCell("B4").numFmt).toBe("#,##0.000");

    // عرض أدنى 10 حتى للعمود الضيق
    expect(ws.getColumn(1).width ?? 0).toBeGreaterThanOrEqual(10);
    // العرض الممرر يُحترم ويُوسَّع لمحتوى الترويسة
    expect(ws.getColumn(2).width ?? 0).toBeGreaterThanOrEqual(18);
  });

  test("أوراق متعددة بترتيبها وأسمائها", async () => {
    const buf = await buildXlsxBuffer({
      sheets: [
        { name: "الأول", columns: [{ header: "أ" }], rows: [[1]] },
        { name: "الثاني", columns: [{ header: "ب" }], rows: [["x"]] },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["الأول", "الثاني"]);
    expect(wb.getWorksheet("الثاني").getCell("A1").value).toBe("ب");
  });

  test("reportTableToSheet — تحويل نموذج الجدول الموحد (أعمدة/صفوف/أرقام/إجماليات)", () => {
    const sheet = reportTableToSheet({
      title: "أرصدة العملاء",
      heads: ["العميل", "المتبقي"],
      rows: [["عميل أ", 17500], ["عميل ب", 3000]],
      numberCols: [1],
      accentRows: [],
      totals: { "العميل": "الإجمالي", "المتبقي": 20500 },
    });
    expect(sheet.name).toBe("أرصدة العملاء");
    expect(sheet.columns.map((c) => c.header)).toEqual(["العميل", "المتبقي"]);
    expect(sheet.rows.length).toBe(2);
    expect(sheet.numberCols).toEqual([1]);
    expect(sheet.totalsRow).toEqual(["الإجمالي", 20500]);
  });

  test("reportTableToSheet — إجماليات مصفوفة تمر كما هي وتجاهل الفارغة", () => {
    const arr = reportTableToSheet({
      title: "تدفق",
      heads: ["النمط", "الوارد", "المنصرف"],
      rows: [],
      numberCols: [1, 2],
      accentRows: [],
      totals: ["الإجمالي", 7500, 2000],
    });
    expect(arr.totalsRow).toEqual(["الإجمالي", 7500, 2000]);
    const none = reportTableToSheet({
      title: "فارغ",
      heads: ["أ"],
      rows: [],
      numberCols: [],
      accentRows: [],
      totals: {},
    });
    expect(none.totalsRow ?? null).toBeNull();
  });
});
