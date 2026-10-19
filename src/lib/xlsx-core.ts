/**
 * باني xlsx حقيقي (exceljs) — المرحلة 8.
 * المرجع المكتبي: reports/tabular_pdf.py:651+ وservices/excel_service.py:
 *   sheet_view.rightToLeft = true · ترويسة بتعبئة أساسية وخط أبيض عريض ·
 *   number_format «#,##0.000» لأعمدة الأرقام · صف إجماليات مميز · تجميد صف الرأس.
 * نقية (بلا server-only) لتُستخدم في المسارات والاختبارات.
 */
import ExcelJS from "exceljs";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const HEADER_ARGB = "FF1F3A5F"; // الأساسي الافتراضي (موحّد مع PDF)
const TOTALS_FILL_ARGB = "FFD8E4EF"; // شريط المكتبي
const MONEY_FMT = "#,##0.000";

export interface XlsxColumn {
  header: string;
  width?: number;
}

export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: (string | number | null)[][];
  /** فهارس أعمدة الأرقام (0-based) — تنسيق #,##0.000 كالمكتبي */
  numberCols?: number[];
  totalsRow?: (string | number | null)[] | null;
}

export interface XlsxWorkbookDef {
  sheets: XlsxSheet[];
}

/** عرض تقريبي بالأحرف — الحد الأدنى 10 والسقف 60 (كالمكتبي max(14,…)) */
function colWidth(col: XlsxColumn, rows: (string | number | null)[][]): number {
  let w = col.header.length + 4;
  for (const r of rows) {
    const v = r[0];
    const len = v === null || v === undefined ? 0 : String(v).length;
    if (len + 2 > w) w = len + 2;
  }
  return Math.max(10, Math.min(60, col.width ?? w));
}

export async function buildXlsxBuffer(def: XlsxWorkbookDef): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Contrack Online";
  wb.created = new Date();

  for (const def0 of def.sheets) {
    const ws = wb.addWorksheet(def0.name.slice(0, 28) || "تقرير", {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    ws.columns = def0.columns.map((c) => ({
      header: c.header,
      width: colWidth(c, def0.rows),
    }));

    // الترويسة: أبيض عريض على الأساسي
    const headerRow = ws.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    const numberCols = new Set(def0.numberCols ?? []);
    for (const r of def0.rows) {
      const row = ws.addRow(r);
      for (const ci of numberCols) {
        const cell = row.getCell(ci + 1);
        if (typeof cell.value === "number") cell.numFmt = MONEY_FMT;
      }
    }

    if (def0.totalsRow && def0.totalsRow.length > 0) {
      const tot = ws.addRow(def0.totalsRow);
      tot.eachCell((cell, colNumber) => {
        cell.font = { bold: true, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTALS_FILL_ARGB } };
        if (numberCols.has(colNumber - 1) && typeof cell.value === "number") {
          cell.numFmt = MONEY_FMT;
        }
      });
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

// ===== تحويل نموذج التقرير الموحد (ReportTable) إلى ورقة — بنيوي بلا اقتران بخادم =====

export interface TableLike {
  title: string;
  heads: string[];
  rows: (string | number)[][];
  numberCols?: number[];
  totals?: Record<string, number | string> | (string | number)[];
}

/** ورقة واحدة من نموذج التقرير: الأعمدة = الرؤوس، وإجماليات الكائن تُصف بمطابقة الرؤوس */
export function reportTableToSheet(table: TableLike): XlsxSheet {
  let totalsRow: (string | number | null)[] | null = null;
  if (Array.isArray(table.totals)) {
    totalsRow = table.totals.length > 0 ? [...table.totals] : null;
  } else if (table.totals && Object.keys(table.totals).length > 0) {
    const rec = table.totals as Record<string, number | string>;
    const aligned = table.heads.map((h) => (h in rec ? rec[h] : ""));
    if (aligned.filter((v) => v !== "").length > 1) totalsRow = aligned;
  }
  return {
    name: table.title || "تقرير",
    columns: table.heads.map((h) => ({ header: h })),
    rows: table.rows,
    numberCols: table.numberCols ?? [],
    totalsRow,
  };
}
