/**
 * اختبارات محلل BOQ النقي (docs/boq-import-design.md §2.2) — حافظة تركيبية
 * بExcelJS تحاكي أنماط ملف حقيقي (PAYMENT_-10-2026_معدل.xlsx) التي عُاير عليها:
 * رؤوس بمرادفات · ترقيم مدني/عشري/حرفي-عددي/حرفي مسعّر · Included · دمج وصف ·
 * خلايا مدمجة · صفحات TOTAL CARRIED وCOLLECTION · صفحة Recap · نسخة صفحة ·
 * مزايددون متعددون · تحقق مقابل الملخص العام.
 */
import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { parseBoqWorkbook } from "../src/lib/import/boq-parse";

/** بناء حافظة اختبار — كل قسم داخل describe مستقل ليُعاد بناؤه بنسخته. */
async function buildFixture(opts: { tamperSummary?: boolean; addRecap?: boolean; addDuplicatePage?: boolean } = {}) {
  const wb = new ExcelJS.Workbook();

  // ---- ورقة الفهرس: أسماء الأقسام ----
  const idx = wb.addWorksheet("Index");
  idx.getCell("B6").value = "DECLARATION";
  idx.getCell("B8").value = "DIVISION 3:  CONCRETE";
  idx.getCell("B9").value = "DIVISION 22   - PLUMBING";
  idx.getCell("B10").value = "DIVISION 26-28  - ELECTRICAL";

  // ---- ورقة الملخص العام ----
  const sum = wb.addWorksheet("Summary");
  sum.getCell("A1").value = "GENERAL SUMMARY";
  sum.getCell("A3").value = "Description";
  sum.getCell("D3").value = "Amount KD. Bills";
  // قسم 3: بنود 302.9 + 715 + 35297 = 36,314.9 (تُخزَّن مسبقاً كقيم محسوبة)
  sum.getCell("A8").value = "DIVISION 3:  CONCRETE";
  sum.getCell("D8").value = 36314.9;
  sum.getCell("A9").value = "DIVISION 22   - PLUMBING";
  sum.getCell("D9").value = 4000;
  sum.getCell("A27").value = "GROSS TOTAL PRICE";
  sum.getCell("D27").value = opts.tamperSummary ? 99999 : 43114.9;

  // ---- قسم مدني Div3: نمط POMI كامل ----
  const d3 = wb.addWorksheet("Div3");
  d3.getCell("A3").value = "Item No.";
  d3.getCell("B3").value = "Description";
  d3.getCell("C3").value = "Qty.";
  d3.getCell("D3").value = "Unit";
  d3.getCell("E3").value = "Unit Price (K.D.)";
  d3.getCell("F3").value = "Total Price (K.D.)";
  d3.getCell("G3").value = "PERVIOUS";
  d3.getCell("H3").value = "CURRENT";
  // شروح ديباجة (تُدمج في أول بند)
  d3.getCell("B5").value = "Section 031000, 032000: Concrete Forming and Reinforcement";
  d3.getCell("B7").value = "Plain Concrete:";
  d3.getCell("B8").value = "Plain concrete K150 using S.R cement (Type V)";
  // بندان بترقيم مدني — الثاني بصيغة مخبأة
  d3.getCell("A10").value = "03.30.01";
  d3.getCell("B10").value = "10 cm plain concrete under footing";
  d3.getCell("C10").value = 100;
  d3.getCell("D10").value = "M²";
  d3.getCell("E10").value = 3.029;
  d3.getCell("F10").value = { formula: "C10*E10", result: 302.9 };
  d3.getCell("A12").value = "03.30.02";
  d3.getCell("B12").value = "40 cm plain concrete filling";
  d3.getCell("C12").value = 50;
  d3.getCell("D12").value = "M²";
  d3.getCell("E12").value = 14.3;
  d3.getCell("F12").value = 715;
  // إجمالي الصفحة 1
  d3.getCell("B14").value = "TOTAL CARRIED TO COLLECTION";
  d3.getCell("F14").value = 1017.9;
  // رأس صفحة ثانية (متكرر) + بند بكمية نصية وبسعر INCLUDED
  d3.getCell("A16").value = "Item No.";
  d3.getCell("B16").value = "Description";
  d3.getCell("C16").value = "Qty.";
  d3.getCell("D16").value = "Unit";
  d3.getCell("E16").value = "Unit Price (K.D.)";
  d3.getCell("F16").value = "Total Price (K.D.)";
  d3.getCell("A18").value = "03.20.01";
  d3.getCell("B18").value = "footing (350 Kg/cm2)";
  d3.getCell("C18").value = 470;
  d3.getCell("D18").value = "M3";
  d3.getCell("E18").value = 75.1;
  d3.getCell("F18").value = { formula: "C18*E18", result: 35297 };
  // ذيل وصف بعد بند (استمرار يُلحق به)
  d3.getCell("B20").value = "including formwork and vibration as specified";
  d3.getCell("B22").value = "TOTAL CARRIED TO COLLECTION";
  d3.getCell("F22").value = 35297;
  // صفحة COLLECTION — تُتخطى بالكامل
  d3.getCell("A24").value = "No.";
  d3.getCell("B24").value = "Description";
  d3.getCell("F24").value = "Amount KD";
  d3.getCell("B26").value = "Div-3-1 SUMMARY";
  d3.getCell("D26").value = "Div-3-1";
  d3.getCell("F26").value = 1017.9;

  // ---- قسم ميكانيكي Mech Div. 22: أحرف أقسام + Included + حرفي مسعّر + عشري ----
  const m22 = wb.addWorksheet("Mech Div. 22");
  m22.getCell("A1").value = "Item No.";
  m22.getCell("B1").value = "Description";
  m22.getCell("C1").value = "Qty";
  m22.getCell("D1").value = "unit";
  m22.getCell("E1").value = "Unit price";
  m22.getCell("F1").value = "Total price";
  m22.getCell("A3").value = "A";
  m22.getCell("B3").value = "GENERAL NOTES";
  m22.getCell("A5").value = 1;
  m22.getCell("B5").value = "Contractor shall verify the quantities";
  m22.getCell("C5").value = "Items";
  m22.getCell("D5").value = "L.S.";
  m22.getCell("E5").value = "INCLUDED";
  m22.getCell("F5").value = "INCLUDED";
  // بند حرفي مسعّر (F1) — يفتح سياق القسم لما يليه
  m22.getCell("A7").value = "F1";
  m22.getCell("B7").value = "Supply and installation of all required fire fighting";
  m22.getCell("C7").value = "Items";
  m22.getCell("D7").value = "L.S.";
  m22.getCell("E7").value = 500;
  m22.getCell("F7").value = 500;
  // عدد صحيح داخل قسم F1 → «F1-1»
  m22.getCell("A9").value = 1;
  m22.getCell("B9").value = "2 inch pipe";
  m22.getCell("C9").value = "L.S.";
  m22.getCell("D9").value = "m.L.";
  m22.getCell("E9").value = 1500;
  m22.getCell("F9").value = 1500;
  m22.getCell("B11").value = "TOTAL CARRIED TO COLLECTION";
  m22.getCell("F11").value = 2000;
  // صفحة ثانية: بند عشري 6.1 (نمط المصعد)
  m22.getCell("A13").value = "ITEM";
  m22.getCell("B13").value = "DESCRIPTION";
  m22.getCell("C13").value = "QTY";
  m22.getCell("D13").value = "Unit";
  m22.getCell("E13").value = "Unit  Rate";
  m22.getCell("F13").value = "Amount";
  // دمج عمودي: A15:F17 مدمج والوصف B لكل صف — نمط المصعد الحرفي
  m22.mergeCells("A15:A17");
  m22.mergeCells("C15:C17");
  m22.mergeCells("D15:D17");
  m22.mergeCells("E15:E17");
  m22.mergeCells("F15:F17");
  m22.getCell("A15").value = "B1";
  m22.getCell("B15").value = "Electrical Traction Passenger Elevator (Section -14215)";
  m22.getCell("B16").value = "Capacity: 1000 Kg; 13 Passenger";
  m22.getCell("B17").value = "Speed: 1.00 m/s";
  m22.getCell("C15").value = 2;
  m22.getCell("D15").value = "Nos.";
  m22.getCell("E15").value = 1000;
  m22.getCell("F15").value = { formula: "E15*C15", result: 2000 };
  m22.getCell("B19").value = "TOTAL CARRIED TO COLLECTION";
  m22.getCell("F19").value = 0; // 2000 (أول ورقة القسم) محسوبة في الملخص

  // ---- ورقة كهربائية ELEC-Div.26-28: مزايددون متعددون + بنود بلا رقم ----
  const e26 = wb.addWorksheet("ELEC-Div.26-28");
  e26.getCell("A1").value = "ITEM";
  e26.getCell("B1").value = "DESCRIPTION";
  e26.getCell("C1").value = "QTY";
  e26.getCell("D1").value = "UNIT";
  e26.getCell("E1").value = "UNIT RATE";
  e26.getCell("F1").value = "AMOUNT";
  e26.getCell("G1").value = "Unit Price (K.D.)"; // مزايدد ثانٍ — يُتجاهل
  e26.getCell("H1").value = "Total Price (K.D.)";
  e26.getCell("B3").value = "DIVISION 26 - ELECTRICAL";
  e26.getCell("B5").value = "SWITCH BOARD supply and install";
  // بند بلا رقم (سطر مسعّر) — زوج المزايد الأول حصراً
  e26.getCell("B7").value = "300A CUTOUT + METER complete with base";
  e26.getCell("C7").value = 2;
  e26.getCell("D7").value = "NO";
  e26.getCell("E7").value = 500;
  e26.getCell("F7").value = 1000;
  e26.getCell("G7").value = 999; // مزايدد ثانٍ — يجب أن يُهمل
  e26.getCell("H7").value = 1998;
  // بندان متطابقان مشروعان (كابلان لتغذية لوحتين) — لا يسقط أي منهما
  e26.getCell("A9").value = 5;
  e26.getCell("B9").value = "4C X 240 mm2 CU cable run on cable tray";
  e26.getCell("C9").value = 30;
  e26.getCell("D9").value = "m";
  e26.getCell("E9").value = 30;
  e26.getCell("F9").value = 900;
  e26.getCell("A11").value = 7;
  e26.getCell("B11").value = "4C X 240 mm2 CU cable run on cable tray";
  e26.getCell("C11").value = 30;
  e26.getCell("D11").value = "m";
  e26.getCell("E11").value = 30;
  e26.getCell("F11").value = 900;
  e26.getCell("B13").value = "TOTAL CARRIED TO COLLECTION";
  e26.getCell("F13").value = 2800;

  if (opts.addRecap) {
    // صفحة Recap: مجموعها = كل ما سبقها في الورقة (2800) → تسقط عمداً
    e26.getCell("A15").value = "ITEM";
    e26.getCell("B15").value = "DESCRIPTION";
    e26.getCell("E15").value = "UNIT RATE";
    e26.getCell("F15").value = "AMOUNT";
    e26.getCell("B17").value = "ELEC Work - 01";
    e26.getCell("F17").value = 1000;
    e26.getCell("B19").value = "ELEC Work - 02";
    e26.getCell("F19").value = 1800;
    e26.getCell("B21").value = "TOTAL CARRIED TO COLLECTION";
    e26.getCell("F21").value = 2800;
  }

  if (opts.addDuplicatePage) {
    // صفحة ثانية فريدة (ترفع المجموع الملتزم فوق مجموع الصفحة الأولى)
    e26.getCell("A15").value = "ITEM";
    e26.getCell("B15").value = "DESCRIPTION";
    e26.getCell("C15").value = "QTY";
    e26.getCell("D15").value = "UNIT";
    e26.getCell("E15").value = "UNIT RATE";
    e26.getCell("F15").value = "AMOUNT";
    e26.getCell("A17").value = 9;
    e26.getCell("B17").value = "Earthing rod with test well";
    e26.getCell("C17").value = 10;
    e26.getCell("D17").value = "NO";
    e26.getCell("E17").value = 20;
    e26.getCell("F17").value = 200;
    e26.getCell("B19").value = "TOTAL CARRIED TO COLLECTION";
    e26.getCell("F19").value = 200;
    // نسخة مطابقة لصفحة الافتتاح — يسقطها التوقيع (لا Recap لأن المجموع الملتزم 3000 ≠ 2800)
    e26.getCell("A21").value = "ITEM";
    e26.getCell("B21").value = "DESCRIPTION";
    e26.getCell("C21").value = "QTY";
    e26.getCell("D21").value = "UNIT";
    e26.getCell("E21").value = "UNIT RATE";
    e26.getCell("F21").value = "AMOUNT";
    e26.getCell("B22").value = "SWITCH BOARD supply and install"; // نفس ديباجة الصفحة الأولى لتطابق التوقيع
    e26.getCell("B23").value = "300A CUTOUT + METER complete with base";
    e26.getCell("C23").value = 2;
    e26.getCell("D23").value = "NO";
    e26.getCell("E23").value = 500;
    e26.getCell("F23").value = 1000;
    e26.getCell("A25").value = 5;
    e26.getCell("B25").value = "4C X 240 mm2 CU cable run on cable tray";
    e26.getCell("C25").value = 30;
    e26.getCell("D25").value = "m";
    e26.getCell("E25").value = 30;
    e26.getCell("F25").value = 900;
    e26.getCell("A27").value = 7;
    e26.getCell("B27").value = "4C X 240 mm2 CU cable run on cable tray";
    e26.getCell("C27").value = 30;
    e26.getCell("D27").value = "m";
    e26.getCell("E27").value = 30;
    e26.getCell("F27").value = 900;
    e26.getCell("B29").value = "TOTAL CARRIED TO COLLECTION";
    e26.getCell("F29").value = 2800;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("محلل BOQ — الحافظة التركيبية (مرآة الملف الحقيقي)", () => {
  test("الأقسام وأسماؤها من الفهرس والإجمالي العام من الملخص", async () => {
    const r = await parseBoqWorkbook(await buildFixture());
    expect(r.divisions.length).toBe(3);
    const d3 = r.divisions.find((d) => d.code === "3")!;
    const d22 = r.divisions.find((d) => d.code === "22")!;
    const d26 = r.divisions.find((d) => d.code === "26")!;
    expect(d3.name).toBe("CONCRETE");
    expect(d22.name).toBe("PLUMBING");
    expect(d26.name).toBe("ELECTRICAL");
    // 302.9 + 715 + 35297 = 36314.9 · 500 + 1500 + 2000 (مصعد) = 4000… لا: 22 = Included(0) + F1(500) + F1-1(1500) + مصعد(2000) = 4000
    expect(d3.total).toBe(36314.9);
    expect(d22.total).toBe(4000);
    expect(d26.total).toBe(2800);
    expect(r.grandTotal).toBe(43114.9);
  });

  test("الترقيم: مدني كما ورد · حرفي-عددي مركّب · حرفي مسعّر يفتح سياقاً · عشري · AUTO", async () => {
    const r = await parseBoqWorkbook(await buildFixture());
    const d3 = r.divisions.find((d) => d.code === "3")!;
    const d22 = r.divisions.find((d) => d.code === "22")!;
    const d26 = r.divisions.find((d) => d.code === "26")!;
    expect(d3.items.map((i) => i.itemNo)).toEqual(["03.30.01", "03.30.02", "03.20.01"]);
    const f1 = d22.items.find((i) => i.itemNo === "F1")!;
    const f11 = d22.items.find((i) => i.itemNo === "F1-1")!;
    expect(f1.amount).toBe(500);
    expect(f11.amount).toBe(1500);
    // المصعد: بند حرفي مسعّر B1 — الوصف المدمج يبدأ بسطر العنوان وينتهي بالسرعة
    const elev = d22.items.find((i) => i.itemNo === "B1")!;
    expect(elev.qty).toBe(2);
    expect(elev.unitPrice).toBe(1000);
    expect(elev.amount).toBe(2000);
    expect(elev.description).toContain("Electrical Traction Passenger Elevator (Section -14215)");
    expect(elev.description).toContain("Capacity: 1000 Kg; 13 Passenger");
    expect(elev.description).toContain("Speed: 1.00 m/s");
    // الكهرباء: بند بلا رقم يرقم تلقائياً + أعداد صحيحة بلا قسم حرفي تبقى كما هي
    expect(d26.items.some((i) => i.itemNo.startsWith("AUTO-"))).toBe(true);
    expect(d26.items.filter((i) => i.itemNo === "5" || i.itemNo === "7").length).toBe(2);
  });

  test("دمج الوصف: ديباجة تصدر أول بند وذيل يلحق بآخر بند", async () => {
    const r = await parseBoqWorkbook(await buildFixture());
    const d3 = r.divisions.find((d) => d.code === "3")!;
    const first = d3.items[0];
    expect(first.description).toContain("Plain Concrete: — Plain concrete K150");
    expect(first.description.startsWith("Plain Concrete:")).toBe(true);
    const last = d3.items[2];
    expect(last.description).toContain("footing (350 Kg/cm2)");
    expect(last.description).toContain("including formwork and vibration as specified");
  });

  test("INCLUDED ⇒ سعر 0 ومبلغ 0 · المبلغ من عمود الإجمالي الرقمي حصراً", async () => {
    const r = await parseBoqWorkbook(await buildFixture());
    const d22 = r.divisions.find((d) => d.code === "22")!;
    const note = d22.items.find((i) => i.description.includes("Contractor shall verify"))!;
    expect(note.unitPrice).toBe(0);
    expect(note.amount).toBe(0);
    expect(note.qty).toBe(1); // نص «Items» ⇒ 1
    // زوج المزايد الأول حصراً: 1000 لا 1998
    const d26 = r.divisions.find((d) => d.code === "26")!;
    const auto = d26.items.find((i) => i.itemNo.startsWith("AUTO-"))!;
    expect(auto.amount).toBe(1000);
  });

  test("صفحات COLLECTION وصفوف التجميع وTotal Carried لا تولّد بنوداً", async () => {
    const r = await parseBoqWorkbook(await buildFixture());
    const d3 = r.divisions.find((d) => d.code === "3")!;
    // بندان + خرسانة مسلحة = 3 بنود فقط (صف المجموع Div-3-1 وملخص القسم لا يدخلان)
    expect(d3.items.length).toBe(3);
    expect(r.meta.collectionPages).toBe(1);
    expect(r.meta.totalPages).toBeGreaterThanOrEqual(4);
    expect(d3.items.every((i) => !i.description.includes("Div-3-1"))).toBe(true);
  });

  test("التحقق مقابل الملخص: مطابقة صامتة، وتحذير عند العبث", async () => {
    const clean = await parseBoqWorkbook(await buildFixture());
    expect(clean.warnings.filter((w) => w.message.includes("يختلف")).length).toBe(0);
    const tampered = await parseBoqWorkbook(await buildFixture({ tamperSummary: true }));
    const mismatches = tampered.warnings.filter((w) => w.message.includes("يختلف"));
    expect(mismatches.length).toBeGreaterThan(0);
  });

  test("صفحة Recap (مجموعها = كل ما سبقها) تسقط عمداً بتحذير", async () => {
    const r = await parseBoqWorkbook(await buildFixture({ addRecap: true }));
    expect(r.meta.recapPages).toBe(1);
    const d26 = r.divisions.find((d) => d.code === "26")!;
    expect(d26.total).toBe(2800); // لم يتضاعف
    expect(d26.items.every((i) => !i.description.includes("ELEC Work"))).toBe(true);
    expect(r.warnings.some((w) => w.message.includes("Recap"))).toBe(true);
  });

  test("صفحة منسوخة حرفياً تسقط بالتوقيع، والسطران المتطابقان المشروعان يبقيان", async () => {
    const r = await parseBoqWorkbook(await buildFixture({ addDuplicatePage: true }));
    expect(r.meta.duplicatePages).toBe(1);
    const d26 = r.divisions.find((d) => d.code === "26")!;
    // 2800 (الصفحة الأولى) + 200 (صفحة التأريض) — النسخة سقطت
    expect(d26.total).toBe(3000);
    // الكابلان المتطابقان (لتغذية لوحتين) كلاهما موجود — لم يسقط منهما شيء
    const cables = d26.items.filter((i) => i.description.includes("4C X 240"));
    expect(cables.length).toBe(2);
    expect(cables.reduce((s, c) => s + c.amount, 0)).toBe(1800);
    expect(r.warnings.some((w) => w.message.includes("منسوخة"))).toBe(true);
  });

  test("ملف ليس BOQ — أقسام فارغة بلا بنود", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Notes");
    ws.getCell("A1").value = "عنوان";
    ws.getCell("B2").value = "نص حر بلا أعمدة تسعير";
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseBoqWorkbook(buf);
    expect(r.divisions.length).toBe(0);
    expect(r.grandTotal).toBe(0);
  });
});
