import "server-only";
/**
 * مزامنة المرجعيات من ملف SQLite القديم إلى الشركة المستهدفة (شركة الجلسة) —
 * تُستدعى مرة واحدة قبل تنفيذ الاستيراد حتى يمر الفحص (أنواع العقود معتمدة،
 * حسابات المصروفات موجودة، المشاريع مربوطة). كلها idempotent: تُنشأ الناقصة
 * فقط عبر غلاف db المحصور بشركة الجلسة — لا upsert ولا كتابة لشركة أخرى.
 */

import { db } from "@/lib/db";
import { nameKey, typeKey } from "./normalize";

const UNSPECIFIED = "غير محدد";

export interface LegacySyncInput {
  types: { name: string; isSupervision: boolean }[];
  accounts: { name: string; fullPath: string; parentFullPath: string }[];
  projects: string[];
}

export interface LegacySyncReport {
  typesCreated: string[];
  accountsCreated: string[];
  projectsCreated: string[];
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

  // ===== شجرة حسابات المصروفات (الآباء أولًا حسب عمق المسار) =====
  const existingAccounts = await db.expenseAccount.findMany({
    select: { id: true, name: true, fullPath: true },
  });
  const accountKeys = new Set<string>();
  const accountIdsByPath = new Map<string, number>(); // nameKey(fullPath أو name) ← id
  for (const a of existingAccounts) {
    if ((a.name || "").trim()) accountKeys.add(nameKey(a.name));
    if ((a.fullPath || "").trim()) accountKeys.add(nameKey(a.fullPath));
    if (a.fullPath) accountIdsByPath.set(nameKey(a.fullPath), a.id);
    if (a.name) accountIdsByPath.set(nameKey(a.name), a.id);
  }
  const sorted = [...input.accounts].sort(
    (a, b) => (a.fullPath.split("/").length - b.fullPath.split("/").length) || a.fullPath.localeCompare(b.fullPath)
  );
  for (const a of sorted) {
    const name = (a.name || "").trim();
    const fullPath = (a.fullPath || "").trim() || name;
    if (!name) continue;
    if (accountKeys.has(nameKey(fullPath)) || accountKeys.has(nameKey(name))) continue;
    // الأب: مسار المصدر الصريح (parentFullPath) — أو المسار دون آخر مقطع احتياطًا
    const parentPath =
      a.parentFullPath.trim() ||
      (fullPath.split("/").length > 1
        ? fullPath.split("/").map((s) => s.trim()).slice(0, -1).join(" / ")
        : "");
    const parentId = parentPath ? (accountIdsByPath.get(nameKey(parentPath)) ?? null) : null;
    const created = await db.expenseAccount.create({
      data: { name, fullPath, parentId, isActive: true },
    });
    accountKeys.add(nameKey(name));
    accountKeys.add(nameKey(fullPath));
    accountIdsByPath.set(nameKey(fullPath), created.id);
    accountIdsByPath.set(nameKey(name), created.id);
    report.accountsCreated.push(fullPath);
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
