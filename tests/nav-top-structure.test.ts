/**
 * الجلسة 15 — حارس التحول الطرازي العلوي «كله علوي» (طراز Odoo) — docs/navigation-map.md §4/§6:
 *   • كل بند شل يجب أن تُغطيه أقسام الشريط العلوي لوحدته مرة واحدة بالضبط — لا بند يتيم ولا مكرر.
 *   • سقف الأقسام الظاهرة 6 لكل وحدة (الإعدادات 7 للمطور حصرًا — قرار موثق: قسم «أدوات المطور»
 *     يجفّ عن غير المطور فيرجع الشريط 6).
 *   • القسم الذي جفّت كل بنوده بالفلترة يختفي كليًا، والوحدة بلا top = كل بنودها أقسامًا مباشرة.
 *   • أسماء البنود داخل القوائم تبقى حرفية (لا إعادة تسمية شاشات) — الأقسام وحدها تُختصر.
 * هذا الاختبار يمنع مستقبلاً «تكبير الشريط» بإضافة بنود أو أقسام بلا انضباط.
 */

import { describe, expect, test } from "bun:test";
import { PERMISSIONS } from "@/lib/permissions-catalog";
import {
  NAV_MODULES,
  findNavChild,
  topSectionIdForChild,
  topSectionItemGroups,
  topSectionsFor,
} from "@/components/contrack/nav-structure";
import { REPORTS } from "@/components/contrack/reports-list";

const ALL_VISIBLE = new Set(NAV_MODULES.flatMap((m) => m.children.map((c) => c.id)));

function moduleById(id: string) {
  const m = NAV_MODULES.find((x) => x.id === id);
  if (!m) throw new Error(`وحدة غير موجودة: ${id}`);
  return m;
}

describe("تغطية أقسام الشريط العلوي — لا بند يتيم ولا مكرر", () => {
  test("كل بند شل مغطى مرة واحدة بالضبط بأقسام وحدته (الصريح والافتراضي)", () => {
    const problems: string[] = [];
    for (const m of NAV_MODULES) {
      const covered = new Map<string, number>();
      const sections = m.top ?? m.children.map((c) => ({ id: `t-${c.id}`, children: [c.id] }));
      for (const s of sections) {
        for (const id of s.children) covered.set(id, (covered.get(id) ?? 0) + 1);
      }
      for (const c of m.children) {
        const n = covered.get(c.id) ?? 0;
        if (n !== 1) problems.push(`${m.id}/${c.id} مغطى ${n} مرة`);
      }
      if (covered.size !== m.children.length) {
        problems.push(`${m.id}: الأقسام تغطي ${covered.size} معرفًا والبنود ${m.children.length}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("معرفات الأقسام فريدة داخل الوحدة", () => {
    const problems: string[] = [];
    for (const m of NAV_MODULES) {
      const seen = new Set<string>();
      for (const s of m.top ?? []) {
        if (seen.has(s.id)) problems.push(`${m.id}: قسم مكرر ${s.id}`);
        seen.add(s.id);
      }
    }
    expect(problems).toEqual([]);
  });

  test("كل معرف داخل قسم يوافق بندًا حقيقيًا في وحدته", () => {
    const problems: string[] = [];
    for (const m of NAV_MODULES) {
      const ids = new Set(m.children.map((c) => c.id));
      for (const s of m.top ?? []) {
        for (const id of s.children) {
          if (!ids.has(id)) problems.push(`${m.id}/${s.id}: معرف غريب ${id}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("سقف الأقسام الظاهرة — الشريط لا يتضخم مهما كبر النظام", () => {
  test("أقصى وحدة (المحاسبة 16 بندًا) تظهر في 6 أقسام لا أكثر", () => {
    const accounting = moduleById("accounting");
    expect(accounting.children.length).toBe(16);
    const sections = topSectionsFor(accounting, ALL_VISIBLE);
    expect(sections.length).toBe(6);
  });

  test("كل الوحدات ضمن السقف 6 — والإعدادات 6 للمدير و7 للمطور (القسم المطور يجفّ عن غيره)", () => {
    for (const m of NAV_MODULES) {
      const n = topSectionsFor(m, ALL_VISIBLE).length;
      if (m.id === "settings") {
        expect(n).toBe(7); // قرار موثق في navigation-map §4
      } else {
        expect(n <= 6).toBe(true);
      }
    }
    // بلا بنود المطور: «الشركات» و«أدوات المطور» يجفّان فيختفي القسم كليًا — 6 أقسام
    const nonDev = new Set(
      moduleById("settings")
        .children.filter((c) => !c.developerOnly)
        .map((c) => c.id)
    );
    expect(topSectionsFor(moduleById("settings"), nonDev).length).toBe(6);
  });

  test("القسم الذي جفّت بنوده يختفي — والفلترة الفارغة تُفرّغ الشريط كليًا", () => {
    const accounting = moduleById("accounting");
    // منع screen_receipts فقط يجفّ «السندات»؟ لا — الصرف يبقى فالقسم يبقى ببند واحد
    const noReceipt = new Set([...ALL_VISIBLE].filter((id) => id !== "vouchers-receipt"));
    const vouchers = topSectionsFor(accounting, noReceipt).find((s) => s.section.id === "t-acc-vouchers");
    expect(vouchers?.children.map((c) => c.id)).toEqual(["vouchers-payment"]);
    // الفارغ كليًا: لا أقسام
    expect(topSectionsFor(accounting, new Set())).toEqual([]);
  });

  test("الوحدة بلا top = كل بنودها أقسامًا مباشرة (بند لكل قسم)", () => {
    const warehouses = moduleById("warehouses"); // لا top في الكتالوج
    const sections = topSectionsFor(warehouses, ALL_VISIBLE);
    expect(sections.length).toBe(warehouses.children.length);
    for (const s of sections) expect(s.children.length).toBe(1);
  });
});

describe("التمييز النشط — القسم الحاوي للبند النشط", () => {
  test("topSectionIdForChild يحل كل بند شل إلى قسم وحدته", () => {
    for (const m of NAV_MODULES) {
      for (const c of m.children) {
        expect(topSectionIdForChild(m, c.id)).toBeDefined();
      }
    }
  });

  test("معرف مجهول يعيد undefined", () => {
    expect(topSectionIdForChild(moduleById("accounting"), "غير-موجود")).toBeUndefined();
  });

  test("بند «المهام المستحقة» يحتويه قسم «المهام والزيارات» (الجلسة 15 — دمج العقود موثق)", () => {
    expect(topSectionIdForChild(moduleById("clients"), "due")).toBe("t-clients-tasks");
  });
});

describe("الأسماء — أسماء الأقسام تُختصر وأسماء البنود حرفية لا تُمسّ", () => {
  test("بنود السندات تحتفظ بأسمائها الحرفية داخل قائمة قسم «السندات»", () => {
    const accounting = moduleById("accounting");
    const s = topSectionsFor(accounting, ALL_VISIBLE).find((sec) => sec.section.id === "t-acc-vouchers")!;
    expect(s.section.label).toBe("السندات");
    expect(s.children.map((c) => c.label)).toEqual(["سندات القبض", "سندات الصرف"]);
  });

  test("بابا الصلاحيات للمشاهدة لا يتغير — انحراف القبض/الصرف المكتبی ثابت", () => {
    expect(findNavChild("vouchers-receipt")?.child.perm).toBe("screen_receipts");
    expect(findNavChild("vouchers-payment")?.child.perm).toBe("screen_payments");
  });

  test("قائمة التقارير تغطي الـ11 تقريرًا كلها بخاصية «نظرة عامة» مباشرة", () => {
    const reports = moduleById("reports");
    const sections = topSectionsFor(reports, ALL_VISIBLE);
    expect(sections.length).toBe(2);
    const all = sections.find((s) => s.section.id === "t-rep-all")!;
    expect(all.children.map((c) => c.id)).toEqual(REPORTS.map((r) => `report-${r.key}`));
  });

  test("فواصل التصنيفات: قائمة التقارير تنقسم مجموعات متتالية بلا ترويسات (الجلسة 15)", () => {
    const reports = moduleById("reports");
    const all = topSectionsFor(reports, ALL_VISIBLE).find((s) => s.section.id === "t-rep-all")!;
    const groups = topSectionItemGroups(all.children);
    // تصنيفات المركز: العملاء والتحصيل ← العقود ← الخزينة ← المحاسبة — وأي تقرير بلا تصنيف مجموعة صامتة
    expect(groups.length).toBeGreaterThanOrEqual(2);
    // كل بنود القسم موزعة على المجموعات بلا فقد ولا تكرار
    expect(groups.flatMap((g) => g.map((c) => c.id))).toEqual(all.children.map((c) => c.id));
    // وحدة بلا groupLabel = مجموعة واحدة (لا فواصل زائفة)
    const accounting = moduleById("accounting");
    const vouchers = topSectionsFor(accounting, ALL_VISIBLE).find((s) => s.section.id === "t-acc-vouchers")!;
    expect(topSectionItemGroups(vouchers.children).length).toBe(1);
  });
});

describe("التكامل مع فلتر الصلاحيات — الأقسام ترث أبواب بنودها", () => {
  const CATALOG = new Set(PERMISSIONS.map((p) => p.key));

  test("لا قسم يعرض بندًا بلا باب صلاحية أو adminOnly (مرآة حارس الشل)", () => {
    const noGate: string[] = [];
    for (const m of NAV_MODULES) {
      for (const c of m.children) {
        if (!c.perm && !c.adminOnly) noGate.push(`${m.id}/${c.id}`);
      }
    }
    expect(noGate).toEqual([]);
  });

  test("كل مفتاح صلاحية في البنود موجود في الكتالوج (تغطية مزدوجة لحارس المرحلة 9)", () => {
    const missing: string[] = [];
    for (const m of NAV_MODULES) {
      for (const c of m.children) {
        if (c.perm && !CATALOG.has(c.perm)) missing.push(`${c.id}→${c.perm}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
