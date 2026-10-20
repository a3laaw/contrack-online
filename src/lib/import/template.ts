/**
 * باني قوالب الاستيراد — مرآة generate_template / generate_expenses_template
 * (import_service.py:224-370): ورقة «اقرأني أولاً» بنصوصها الحرفية + الأوراق
 * الثماني بترويساتها العربية وأعمدتها بعرضها وصف المثال بعلامته، وقوائم
 * منسدلة للحالة وطريقة الدفع والأنواع المعتمدة. بني بـExcelJS بنمط xlsx-core
 * (rightToLeft · ترويسة بتعبئة 1E3A5F وخط أبيض عريض · تجميد صف الرأس).
 * نقية (بلا db) — الأنواع المعتمدة تُمرَّر من المستدعي.
 */

import ExcelJS from "exceljs";

import {
  IMPORT_CONTRACT_STATUSES,
  IMPORT_EXAMPLE_MARKER,
  IMPORT_INSTRUCTIONS,
  IMPORT_PAY_METHODS,
  IMPORT_SHEETS,
  IMPORT_TEMPLATE_FILENAME,
  IMPORT_TYPE_COLUMN_NOTE,
  sheetSpec,
} from "./sheets";

const HEADER_FILL = "FF1E3A5F";
const THIN_COLOR = "FFD9E2EC";
const EXAMPLE_COLOR = "FF9AA7B5";
const NOTE_COLOR = "FFB45309";

/** قالب كامل (كل الأوراق + التعليمات) أو ورقة واحدة بالاسم الحرفي */
export async function buildImportTemplateBuffer(opts: {
  sheet?: string;
  knownTypes?: string[];
}): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Contrack Online";
  wb.created = new Date();

  const single = opts.sheet && sheetSpec(opts.sheet) ? sheetSpec(opts.sheet)! : null;
  const sheets = single ? [single] : IMPORT_SHEETS;

  if (!single) {
    // ورقة التعليمات أولاً — نصوص المكتبي الحرفية
    const ws = wb.addWorksheet("اقرأني أولاً", { views: [{ rightToLeft: true }] });
    ws.getColumn(1).width = 95;
    IMPORT_INSTRUCTIONS.forEach(([text, size, bold, color], i) => {
      const cell = ws.getCell(i + 1, 1);
      cell.value = text;
      cell.font = { bold, size, color: { argb: `FF${color || "243447"}` } };
      cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
      ws.getRow(i + 1).height = size <= 12 ? 24 : 32;
    });
  }

  const border: Partial<ExcelJS.Borders> = {
    left: { style: "thin", color: { argb: THIN_COLOR } },
    right: { style: "thin", color: { argb: THIN_COLOR } },
    top: { style: "thin", color: { argb: THIN_COLOR } },
    bottom: { style: "thin", color: { argb: THIN_COLOR } },
  };

  for (const spec of sheets) {
    const nCols = spec.columns.length;
    const ws = wb.addWorksheet(spec.name, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    spec.columns.forEach(([head, width], i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = head;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = border;
      ws.getColumn(i + 1).width = width;
    });
    ws.getRow(1).height = 26;
    // صف المثال + العلامة بعد آخر عمود
    spec.example.forEach((val, i) => {
      const cell = ws.getCell(2, i + 1);
      cell.value = val;
      cell.font = { italic: true, color: { argb: EXAMPLE_COLOR }, size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = border;
    });
    ws.getCell(2, nCols + 1).value = IMPORT_EXAMPLE_MARKER;
    ws.getCell(2, nCols + 1).font = { bold: true, color: { argb: NOTE_COLOR }, size: 10 };
    // حدود لمئة صف جاهزة للتعبئة
    for (let r = 3; r <= 102; r++) {
      for (let c = 1; c <= nCols; c++) {
        const cell = ws.getCell(r, c);
        cell.border = border;
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    }

    // قوائم منسدلة للحالة وطريقة الدفع وأنواع العقود (import_service.py:297-324)
    const addList = (col: number, fromRow: number, toRow: number, values: string[], allowBlank: boolean) => {
      const formula = `"${values.join(",")}"`;
      for (let r = fromRow; r <= toRow; r++) {
        ws.getCell(r, col).dataValidation = { type: "list", allowBlank, formulae: [formula] };
      }
    };
    if (spec.name === "العقود") {
      addList(7, 3, 200, IMPORT_CONTRACT_STATUSES, true);
      const types = [...(opts.knownTypes ?? [])].sort();
      const joined = types.join(",");
      if (types.length && joined.length <= 250) addList(8, 3, 200, types, false);
      ws.getCell(1, 9).value = IMPORT_TYPE_COLUMN_NOTE;
      ws.getCell(1, 9).font = { bold: true, color: { argb: NOTE_COLOR }, size: 10 };
    }
    if (spec.name === "الدفعات") addList(6, 3, 200, IMPORT_PAY_METHODS, true);
    if (spec.name === "سندات القبض") addList(7, 3, 200, IMPORT_PAY_METHODS, true);
    if (spec.name === "سندات الصرف") addList(10, 3, 300, IMPORT_PAY_METHODS, true);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const filename = single ? `قالب_${single.name}.xlsx` : IMPORT_TEMPLATE_FILENAME;
  return { buffer: Buffer.from(arrayBuffer as ArrayBuffer), filename };
}
