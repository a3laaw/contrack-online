import "server-only";
/**
 * سياق القاعدة للتحقق — يجمع خرائط المكتبي من PostgreSQL (import_service.py):
 *   _existing_customer_name_map (:118-124) · _existing_contract_map (:127-143)
 *   · _known_contract_types (:194-205) · أسماء المقاولين (:569-574) · أرقام
 *   السندات (:663-669 / :802-807) · المشاريع (:808-812) · حسابات المصروفات
 *   (:792-801). + تحميل مصنف ExcelJS من بايتات الملف المرفوع.
 */

import ExcelJS from "exceljs";
import { db } from "@/lib/db";

import type { ImportDbContext, RawSheet } from "./parse-core";
import { nameKey, typeKey } from "./normalize";
import { IMPORT_SHEETS } from "./sheets";

const UNSPECIFIED = "غير محدد";

export async function buildImportDbContext(): Promise<ImportDbContext> {
  const [customers, contracts, types, accounts, voucherNumbers, paymentNumbers, projects, subs] =
    await Promise.all([
      db.customer.findMany({ select: { name: true } }),
      db.contract.findMany({
        where: { status: { not: "ملغى" } },
        select: {
          amount: true,
          contractName: true,
          description: true,
          contractNumber: true,
          customer: { select: { name: true } },
        },
      }),
      db.contractType.findMany({ select: { name: true } }),
      db.expenseAccount.findMany({
        select: { id: true, name: true, fullPath: true },
      }),
      db.voucher.findMany({ select: { voucherNumber: true } }),
      db.voucher.findMany({ where: { vtype: "payment" }, select: { voucherNumber: true } }),
      db.project.findMany({ select: { id: true, name: true } }),
      db.subcontractor.findMany({ select: { name: true } }),
    ]);

  const existingCustomerAliases: Record<string, string> = {};
  for (const c of customers) {
    if ((c.name || "").trim()) existingCustomerAliases[nameKey(c.name)] = c.name;
  }

  const existingContracts: ImportDbContext["existingContracts"] = [];
  for (const r of contracts) {
    const cname = r.customer?.name ?? "";
    for (const label of [r.contractName, r.description, r.contractNumber]) {
      if ((cname || "").trim() && (label || "").trim()) {
        existingContracts.push({ customerName: cname, label, amount: Number(r.amount) || 0 });
      }
    }
  }

  const knownContractTypes: Record<string, string> = {};
  for (const t of types) {
    const name = (t.name || "").trim();
    if (name && name !== UNSPECIFIED) knownContractTypes[typeKey(name)] = name;
  }

  const expenseAccounts: Record<string, number> = {};
  for (const a of accounts) {
    for (const alias of [a.fullPath, a.name]) {
      if (alias) expenseAccounts[nameKey(alias)] = a.id;
    }
  }

  return {
    existingCustomerAliases,
    existingContracts,
    knownContractTypes,
    expenseAccounts,
    existingReceiptNumbers: voucherNumbers.map((v) => v.voucherNumber || ""),
    existingPaymentNumbers: paymentNumbers.map((v) => v.voucherNumber || ""),
    projects: Object.fromEntries(projects.map((p) => [nameKey(p.name), p.id])),
    existingSubNames: subs.map((s) => s.name || ""),
  };
}

/** تحويل مصنف ExcelJS إلى أوراق خام (القيم فقط) — نتائج الصيغ تُستخدم كالمكتبي data_only */
export async function loadRawSheets(buffer: Buffer): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: RawSheet[] = [];
  for (const ws of wb.worksheets) {
    const rows: unknown[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: unknown[] = [];
      for (let c = 1; c <= Math.max(ws.columnCount, 1); c++) {
        const v = row.getCell(c).value;
        cells.push(flattenCell(v));
      }
      rows.push(cells);
    }
    sheets.push({ name: ws.name, rows });
  }
  return sheets;
}

/** إسقاط التغليف: نتيجة الصيغة/النص الغني/الرابط → القيمة الخام */
function flattenCell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    const obj = v as Record<string, unknown>;
    if ("result" in obj) return flattenCell(obj.result);
    if ("text" in obj && typeof obj.text === "string") return obj.text;
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    }
    if ("hyperlink" in obj && typeof obj.text === "string") return obj.text;
    if ("error" in obj) return null;
  }
  return v;
}

/** هل الملف يحوي أي ورقة من الأوراق الثماني؟ (لرسالة «بنية القالب») */
export function hasAnyImportSheet(sheets: RawSheet[]): boolean {
  const names = new Set(sheets.map((s) => s.name));
  return IMPORT_SHEETS.some((s) => names.has(s.name));
}
