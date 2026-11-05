import "server-only";
/**
 * مزامنة المرجعيات من ملف SQLite القديم إلى الشركة المستهدفة (شركة الجلسة) —
 * تُستدعى مرة واحدة قبل تنفيذ الاستيراد حتى يمر الفحص (أنواع العقود معتمدة،
 * حسابات المصروفات موجودة، المشاريع مربوطة). كلها idempotent: تُنشأ الناقصة
 * فقط عبر غلاف db المحصور بشركة الجلسة — لا upsert ولا كتابة لشركة أخرى.
 *
 * Task 105 — الشجرة الموحدة: حسابات المصروفات على دليل Account حصرًا —
 * الناقص يُنشأ ابنًا مباشرًا تحت 5300 «مصروفات أخرى» بكود تسلسلي (530001+)
 * بaccountRole='standard'، والدليل ثابت البنية (لا شجرة متعددة المستويات).
 */

import { db } from "@/lib/db";
import { nameKey, typeKey } from "./normalize";

const UNSPECIFIED = "غير محدد";
const EXPENSE_PARENT_CODE = "5300";
const XBRL_OTHER_EXPENSES = "kw:OtherExpenses";

export interface LegacySyncInput {
  types: { name: string; isSupervision: boolean }[];
  /** من الملف المكتبي — fullPath/parentFullPath تاريخيان: البنية الجديدة مسطحة تحت 5300 */
  accounts: { name: string; fullPath: string; parentFullPath: string }[];
  projects: string[];
}

export interface LegacySyncReport {
  typesCreated: string[];
  accountsCreated: string[];
  projectsCreated: string[];
}

/** حساب 5300 مضمون الوجود كفرع (لا يقبل قيدًا) — الأبناء أوراق المصروف */
async function ensureExpenseBranch() {
  const parent = await db.account.findFirst({ where: { code: EXPENSE_PARENT_CODE } });
  if (!parent) throw new Error("حساب المصروفات 5300 غير موجود في دليل الشركة — بذّر الدليل أولاً");
  if (parent.isLeaf || parent.allowPosting) {
    return db.account.update({
      where: { id: parent.id },
      data: { isLeaf: false, allowPosting: false },
    });
  }
  return parent;
}

/** أول كود متاح تحت 5300: 530001 صعودًا (فحص أكواد أبناء 5300 الموجودة) */
async function nextExpenseCode(parentId: number): Promise<string> {
  const children = await db.account.findMany({ where: { parentId }, select: { code: true } });
  const taken = new Set(children.map((c) => c.code));
  let seq = 1;
  while (taken.has(`${EXPENSE_PARENT_CODE}${String(seq).padStart(3, "0")}`)) seq += 1;
  return `${EXPENSE_PARENT_CODE}${String(seq).padStart(3, "0")}`;
}

export async function syncLegacyReferenceData(input: LegacySyncInput): Promise<LegacySyncReport> {
  const report: LegacySyncReport = { typesCreated: [], accountsCreated: [], projectsCreated: [] };

  // ===== أنواع العقود =====
  const existingTypes = await db.contractType.findMany({ select: { id: true, name: true } });
  const typeKeys = new Set(existingTypes.map((t) => typeKey(t.name)));
  for (const t of input.types) {
    const name = (t.name || "").trim();
    if (!name || name === UNSPECIFIED) continue;
    const k = typeKey(name);
    if (typeKeys.has(k)) continue;
    const created = await db.contractType.create({
      data: { name, isSupervision: Boolean(t.isSupervision) },
    });
    typeKeys.add(typeKey(created.name));
    report.typesCreated.push(created.name);
  }

  // ===== حسابات المصروفات (الدليل الموحد: الأوراق type='expense' النشطة) =====
  const existingAccounts = await db.account.findMany({
    where: { type: "expense", isActive: true },
    select: { id: true, name: true },
  });
  const accountKeys = new Set<string>();
  for (const a of existingAccounts) {
    if ((a.name || "").trim()) accountKeys.add(nameKey(a.name));
  }
  // إنشاء الناقص: كل حساب ابن مباشر تحت 5300 (المطابقة بالاسم — لا fullPath في الدليل الموحد)
  let branch: { id: number } | null = null;
  for (const a of input.accounts) {
    const name = (a.name || "").trim();
    if (!name || accountKeys.has(nameKey(name))) continue;
    if (!branch) branch = await ensureExpenseBranch();
    const created = await db.account.create({
      data: {
        code: await nextExpenseCode(branch.id),
        name,
        type: "expense",
        nature: "debit",
        parentId: branch.id,
        isLeaf: true,
        allowPosting: true,
        isActive: true,
        isSystem: false,
        accountRole: "standard",
        xbrlElement: XBRL_OTHER_EXPENSES,
        notes: "مستورد من ملف المكتبة القديم (شجرة المصروفات السابقة)",
      },
    });
    accountKeys.add(nameKey(created.name));
    report.accountsCreated.push(a.fullPath || name);
  }

  // ===== المشاريع (لربط سندات الصرف) =====
  const existingProjects = await db.project.findMany({ select: { id: true, name: true } });
  const projectKeys = new Set(existingProjects.map((p) => nameKey(p.name)));
  for (const name of input.projects) {
    const nm = (name || "").trim();
    if (!nm || projectKeys.has(nameKey(nm))) continue;
    const created = await db.project.create({ data: { name: nm } });
    projectKeys.add(nameKey(created.name));
    report.projectsCreated.push(created.name);
  }

  return report;
}
