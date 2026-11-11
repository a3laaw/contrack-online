/**
 * اختبارات محلل البرنامج الزمني النقي (docs/schedule-import-design.md §3) — حافظة نصية تركيبية
 * تحاكي أنماط الملف الحقيقي (البرنامج الزمني للمشروع.pdf — CPM Detailed Schedule-R01)
 * التي عُاير عليها: سطر النشطة الكامل · Milestones صفرية · اسم ملتصق بالكود ·
 * شرطة ناقصة قبل الرقم · كود بلا شرطات · أرقام داخلية (P-FA-D1) · سطر band واسمه المجرد ·
 * زخارف الصفحة (رؤوس/Gantt/تذييل) · الميتا (Project Start/Finish · Data Date · R01).
 */
import { describe, expect, test } from "bun:test";
import {
  classifyFamily,
  matchDivision,
  numberDivision,
  parseCpmDate,
  scanScheduleText,
} from "../src/lib/import/schedule-parse";

/** حافظة تحاكي صفحتين من الملف الحقيقي بترتيبه الحرفي (جدول ثم زخارف ثم تذييل). */
function fixture(): string {
  return [
    // ---- صفحة 1 ----
    "Activity ID     Activity Name   Original",
    "Duration",
    "Early Start Early Finish Late Start Late Finish",
    "SABAH AL SALEM SOUTH HEALTH CENTER      454 28-Feb-26 27-May-27 28-Feb-26 27-May-27",
    "GENERAL ",
    "GENERAL         454 28-Feb-26 27-May-27 28-Feb-26 27-May-27",
    "G-GE-GR-000 PROJECT COMMENCEMENT        0 28-Feb-26     28-Feb-26",
    "G-GE-GR-015 MOBILIZATION        30 28-Feb-26 29-Mar-26 28-Feb-26 29-Mar-26",
    "G-GE-GR-004 PROJECT HANDOVER    0       27-May-27       27-May-27",
    "SUBMITTALS      ",
    "SUBMITTALS      160 28-Feb-26 01-Sep-26 01-Mar-26 11-Oct-26",
    "CONCRETE WORK   ",
    "CONCRETE WORK   14 28-Feb-26 15-Mar-26 02-Apr-26 18-Apr-26",
    "E-SC-SS-00300 SUB. OF READY MIX CONCRETE (SUPPLIER/MIX DESIGN)  14 28-Feb-26 15-Mar-26 02-Apr-26 18-Apr-26",
    "METAL WORK      ",
    "METAL WORK      14 28-Jul-26    12-Aug-26 22-Aug-26 06-Sep-26",
    "E-SC-SS-00500 SUB. OF SUB-CONT. FOR METAL (DOORS/HANDRAILS)     14 28-Jul-26    12-Aug-26 22-Aug-26 06-Sep-26",
    // أسطر كالتيارات الملتوية الحقيقية
    "U-GE-KMU-01006MUNICIPALITY CLEARANCE CERTIFICATE   8 15-Apr-27 26-Apr-27 15-Apr-27 26-Apr-27",
    "E-SD-G-SS-00110SUB.OF GROUND FLOOR ARCH PLAN DIM & LEVELS  14 04-Mar-26 19-Mar-26 30-Apr-26 16-May-26",
    "P-GF-GR15004 EMBEDDED PLUMBING SERVICES FOR SLAB   3 22-Jul-26     25-Jul-26       23-Jul-26 26-Jul-26",
    "ELEC. (DATA VOICE SYS DATA & TELEPHONE) ",
    "ELEC. (DATA VOICE SYS DATA & TELEPHONE)    38 02-Jan-27 15-Feb-27 27-Mar-27 12-Apr-27",
    "PFFGG-16315 INST. OF DATA TELEPHONE TERMINAL BOXES & PANELS        8 06-Feb-27 15-Feb-27 04-Apr-27 12-Apr-27",
    "FINAL FINISHES ",
    "FINAL FINISHES     18 24-Mar-27 13-Apr-27 25-Mar-27 13-Apr-27",
    "PFFGR-09001 FINAL TOUCH-UP & CLEANING WORKS        1 13-Apr-27 13-Apr-27 13-Apr-27 13-Apr-27",
    "ALUMINUM WORKS ",
    "ALUMINUM WORKS     14 10-Jan-27 25-Jan-27 01-Feb-27 17-Feb-27",
    "P-FA-D1-08310 INST.OF ALUMINUIM WINDOWS    12 10-Jan-27 25-Jan-27 01-Feb-27 17-Feb-27",
    // ميكانيكي بثلاث أسر تحت band واحد
    "MECHANICAL WORK ",
    "MECHANICAL WORK         32 08-Mar-26 14-Apr-26 10-Mar-26 11-May-26",
    "P-FL-GR-15100 INST. OF DRAINAGE PIPES FOR FOUNDATION       14 08-Mar-26 24-Mar-26 10-Mar-26 25-Mar-26",
    "P-FL-GR-15200 INST. OF F.F PIPING FOR FOUNDATION   14 15-Mar-26 30-Mar-26 05-Apr-26 20-Apr-26",
    "P-FL-GR-15300 INST. OF HVAC DUCTS FOR FOUNDATION   14 29-Mar-26 14-Apr-26 26-Apr-26 11-May-26",
    // أزواج تواريخ أشرطة Gantt بلا أسماء + شهر/سنة
    "N D J F M A M J J A S O N D J F M A M J J",
    "2026    2027",
    "28-Feb-26       27-May-27",
    "27-Sep-26 10-Oct-26",
    "SABAH AL SALEM SOUTH HEALTH CENTER      CPM Detailed Schedule (1 of 24)",
    "Project Start:28-Feb-26",
    "Project Finish:27-May-27",
    "Data Date:28-Feb-26",
    "Remaining Level of Effort",
    "Remaining Work",
    "Critical Remaining W.. .",
    "Baseline Milestone",
    "CPM Detailed Activities.        HISTORY OF Submitals",
    "Date    Revision        Checked Approved",
    "28-Feb-26 Detailed Schedule-R01         PL      IN.PROG",
    "-- 1 of 24 --",
    // ---- صفحة 2 (بدون رأس مكرر) ----
    "EARTH WORK ",
    "EARTH WORK      28 26-Mar-26 27-Apr-26 26-Mar-26 27-Apr-26",
    "P-FL-GR-02100 MECHANICAL EXCAVATION        28 26-Mar-26 27-Apr-26 26-Mar-26 27-Apr-26",
    "P-FL-GR-02915 TERMIT CONTROL       1 05-May-26 05-May-26 05-May-26 05-May-26",
    "T-GE-GR-15100 TESTING & COMMISSIONING OF DRAIN.&WATER SUPPLY       23 05-May-27 27-May-27 05-May-27 27-May-27",
    "R-GE-GR-000 CLOSEOUT       0 27-May-27 27-May-27",
    "-- 2 of 24 --",
  ].join("\n");
}

describe("أدوات التواريخ والتصنيف", () => {
  test("parseCpmDate — DD-MMM-YY بجدول أشهر ثابت", () => {
    expect(parseCpmDate("28-Feb-26")).toBe("2026-02-28");
    expect(parseCpmDate("27-May-27")).toBe("2027-05-27");
    expect(parseCpmDate("1-Mar-26")).toBe("2026-03-01");
    expect(parseCpmDate("garbage")).toBeNull();
    expect(parseCpmDate("2026-02-28")).toBeNull(); // صيغة أخرى غير مدعومة عمداً
  });

  test("classifyFamily — عائلات العمل والأنواع الفرعية للأكواد الملتوية", () => {
    expect(classifyFamily("P-FL-GR-02000")).toEqual({ family: "P-FL", kind: "work" });
    expect(classifyFamily("PFFGG-16315")).toEqual({ family: "P-FF", kind: "work" });
    expect(classifyFamily("PFFF2-09000")).toEqual({ family: "P-FF", kind: "work" });
    expect(classifyFamily("P-FA-D1-08310")).toEqual({ family: "P-FA", kind: "work" });
    expect(classifyFamily("ESDGSS-00310")).toEqual({ family: "E-SD", kind: "shopdrawing" });
    expect(classifyFamily("E-SC-SS-00206")).toEqual({ family: "E-SC", kind: "submittal" });
    expect(classifyFamily("E-SC-AP-00300")).toEqual({ family: "E-SC", kind: "approval" });
    expect(classifyFamily("E-MA-PR-03400")).toEqual({ family: "E-MA", kind: "procurement" });
    expect(classifyFamily("U-GE-KMU-01006")).toEqual({ family: "U-GE", kind: "authority" });
    expect(classifyFamily("R-GE-GR-000")).toEqual({ family: "R-GE", kind: "closeout" });
    expect(classifyFamily("T-GE-GR-15100")).toEqual({ family: "T-GE", kind: "testing" });
    expect(classifyFamily("G-GE-GR-015")).toEqual({ family: "G-GE", kind: "general" });
  });

  test("numberDivision — ترميز MasterFormat في أرقام الأنشطة", () => {
    expect(numberDivision("15100")).toBe("22");
    expect(numberDivision("15200")).toBe("23");
    expect(numberDivision("15300")).toBe("21");
    expect(numberDivision("16160")).toBe("26");
    expect(numberDivision("14100")).toBe("14");
    expect(numberDivision("01221")).toBe("12");
    expect(numberDivision("01310")).toBe("13");
    expect(numberDivision("01400")).toBe("14");
    expect(numberDivision("00504")).toBe("5");
    expect(numberDivision("00722")).toBe("7");
    expect(numberDivision("03000")).toBe("3");
    expect(numberDivision("04100")).toBe("4");
    expect(numberDivision("02100")).toBe("2");
  });

  test("matchDivision — البند ثم الرقم ثم الاسم", () => {
    // البند يحسم فوراً
    expect(matchDivision("CONCRETE WORK", "P-FL-GR-03400", "INST. OF FORM")).toBe("3");
    expect(matchDivision("ELEC. (FIRE ALARM)", "P-FF-GR-16400", "INST. OF FA"), ).toBe("26");
    // البند ميكانيكي عام — الرقم يحسم الأسرة
    expect(matchDivision("MECH. (PLUMBING WORK)", "P-GF-GR-15110", "INST. OF W.S PIPES")).toBe("22");
    expect(matchDivision("MECH. (F.FIGHTING WORK)", "P-GF-GR-15220", "SPRINKLERS")).toBe("23");
    expect(matchDivision("MECH. (HVAC WORK)", "P-GF-GR-15310", "DUCTS")).toBe("21");
    // بند غير حاسم — الرقم
    expect(matchDivision("WET AREA", "P-FF-WA-04100", "INST. OF INTERNAL BLOCK WALLS")).toBe("4");
    // لا بند ولا رقم واضح — الاسم
    expect(matchDivision("", "X-GE-GR-00100", "LANDSCAPE WORKS")).toBe("31");
  });
});

describe("الماسح النصي — scanScheduleText", () => {
  const r = scanScheduleText(fixture());
  const ns = r.activities.filter((a) => !a.isSummary);
  const bands = r.activities.filter((a) => a.isSummary);

  test("الميتا من التذييل — التواريخ والمراجعة والصفحات", () => {
    expect(r.meta.projectStart).toBe("2026-02-28");
    expect(r.meta.projectFinish).toBe("2027-05-27");
    expect(r.meta.dataDate).toBe("2026-02-28");
    expect(r.meta.revision).toBe("R01");
    expect(r.meta.totalPages).toBe(24);
  });

  test("سطر النشطة الكامل — كود+اسم+مدة+أربعة تواريخ", () => {
    const mob = ns.find((a) => a.activityCode === "G-GE-GR-015");
    expect(mob).toBeDefined();
    expect(mob!.name).toBe("MOBILIZATION");
    expect(mob!.durationDays).toBe(30);
    expect(mob!.earlyStart).toBe("2026-02-28");
    expect(mob!.earlyFinish).toBe("2026-03-29");
    expect(mob!.lateStart).toBe("2026-02-28");
    expect(mob!.lateFinish).toBe("2026-03-29");
    expect(mob!.kind).toBe("general");
    expect(mob!.groupName).toBe("GENERAL");
  });

  test("Milestones صفرية المدة — تاريخان فقط تُستكمل Late منهما", () => {
    const start = ns.find((a) => a.activityCode === "G-GE-GR-000");
    expect(start!.durationDays).toBe(0);
    expect(start!.earlyStart).toBe("2026-02-28");
    expect(start!.earlyFinish).toBe("2026-02-28");
    expect(start!.lateStart).toBe("2026-02-28");
    expect(start!.lateFinish).toBe("2026-02-28");
  });

  test("الكود الملتصق بالاسم يُفصل — والاسم يظل كاملاً", () => {
    const kmu = ns.find((a) => a.activityCode === "U-GE-KMU-01006");
    expect(kmu).toBeDefined();
    expect(kmu!.name).toBe("MUNICIPALITY CLEARANCE CERTIFICATE");
    expect(kmu!.kind).toBe("authority");
    const sd = ns.find((a) => a.activityCode === "E-SD-G-SS-00110");
    expect(sd).toBeDefined();
    expect(sd!.name).toBe("SUB.OF GROUND FLOOR ARCH PLAN DIM & LEVELS");
    expect(sd!.kind).toBe("shopdrawing");
  });

  test("الأكواد بلا شرطات وذات الشرطة الناقصة", () => {
    expect(ns.find((a) => a.activityCode === "P-GF-GR-15004")).toBeDefined();
    expect(ns.find((a) => a.activityCode === "PFFGG-16315")).toBeDefined();
    expect(ns.find((a) => a.activityCode === "PFFGR-09001")).toBeDefined();
    const fa = ns.find((a) => a.activityCode === "P-FA-D1-08310");
    expect(fa).toBeDefined();
    expect(fa!.kind).toBe("work");
  });

  test("مطابقة الأقسام — الرقم يحسم داخل band ميكانيكي عام", () => {
    const p = ns.find((a) => a.activityCode === "P-FL-GR-15100");
    const ff = ns.find((a) => a.activityCode === "P-FL-GR-15200");
    const hv = ns.find((a) => a.activityCode === "P-FL-GR-15300");
    expect(p!.divisionCode).toBe("22");
    expect(ff!.divisionCode).toBe("23");
    expect(hv!.divisionCode).toBe("21");
    // الحفر — بند EARTH WORK يحسم أولاً (31 أصح من رقم 02 الخام)
    const ex = ns.find((a) => a.activityCode === "P-FL-GR-02100");
    expect(ex!.divisionCode).toBe("31");
    // بيانات/تلفون كهرباء — band ELEC يحسم
    expect(ns.find((a) => a.activityCode === "PFFGG-16315")!.divisionCode).toBe("26");
    // واجهات ألمنيوم — band ALUMINUM WORKS
    expect(ns.find((a) => a.activityCode === "P-FA-D1-08310")!.divisionCode).toBe("8");
    expect(ns.find((a) => a.activityCode === "PFFGR-09001")!.divisionCode).toBe("9");
  });

  test("سطر band — بلا كود، بالمدة والتواريخ، ويحدد المجموعة الحاوية", () => {
    const band = bands.find((b) => b.name === "CONCRETE WORK");
    expect(band).toBeDefined();
    expect(band!.isSummary).toBe(true);
    expect(band!.durationDays).toBe(14);
    expect(band!.earlyStart).toBe("2026-02-28");
    expect(band!.earlyFinish).toBe("2026-03-15");
    const e = ns.find((a) => a.activityCode === "E-SC-SS-00300");
    expect(e!.groupName).toBe("CONCRETE WORK");
  });

  test("سطر اسم الـband المجرد (خلية مدمجة) يُسقط — لا band وهمي", () => {
    // «CONCRETE WORK   » وحدها بلا تواريخ لا تنتج صفّاً
    expect(bands.filter((b) => b.name === "CONCRETE WORK").length).toBe(1);
  });

  test("الزخارف تُسقط كلها — أشرطة Gantt وشهورها ورؤوسها وتذييلها", () => {
    // لا صفوف بلا تواريخ
    expect(r.activities.every((a) => a.earlyStart && a.earlyFinish)).toBe(true);
    // لا صف عناوين المشروع (وفيه تواريخ كان سيُلتقط خطأً)
    expect(r.activities.some((a) => /SABAH/.test(a.name))).toBe(false);
    expect(r.activities.some((a) => /^N D J F/.test(a.name))).toBe(false);
    expect(r.activities.some((a) => /2026/.test(a.name) && a.isSummary)).toBe(false);
    // تاريخ المراجعة «28-Feb-26 Detailed Schedule-R01» لا يصير نشطة
    expect(ns.some((a) => /R01/.test(a.name))).toBe(false);
    // المشروع يعود ليملك تاريخ البداية الحقيقي
    expect(r.meta.projectStart).toBe("2026-02-28");
  });

  test("عدّادات الملخص", () => {
    // الحافظة: 18 نشطة + 9 bands
    expect(ns.length).toBe(18);
    expect(bands.length).toBe(9);
    expect(r.counts.work).toBe(9); // P-GF-GR15004 · PFFGG-16315 · PFFGR-09001 · P-FA-D1-08310 · P-FL-GR-15x ×3 · P-FL-GR-02x ×2
    expect(r.counts.withDates).toBe(ns.filter((a) => a.earlyStart && a.earlyFinish).length);
    expect(r.warnings.length).toBe(0);
  });

  test("ملف ليس برنامجاً زمنياً — تحذير صريح", () => {
    const bad = scanScheduleText("هذا نص عادي بلا أي أنشطة\nوأسطر عشوائية 12345");
    expect(bad.warnings.some((w) => /لا أنشطة/.test(w.message))).toBe(true);
    expect(bad.activities.length).toBe(0);
  });
});
