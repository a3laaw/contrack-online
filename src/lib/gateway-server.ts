import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { db, currentCompanyId } from "@/lib/db";
import { EPS, r3 } from "@/lib/contrack-core";
import { computeRunningStatement, netInByDay, sumByDay, type RunningOpRow } from "./other-running-core";
import { audit, normalizeArabic, todayStr } from "@/lib/api-utils";

/**
 * مكتبة البوابة المالية والشركة الأخرى (Task 13-a) — القواعد الحاكمة:
 * - المطابقة التلقائية بالهاتف/الاسم/الرابط المحفوظ (match_aliases) مقابل سندات القبض السارية فقط،
 *   بنافذة [opDate−5, opDate+3] (الهاتف/الرابط 5 · الاسم 3) ومبلغ ±tolerance — المصدر gateway_service.match_settlement.
 * - المطابق ⇒ mine + receiptNo + customer (غير مصنف يبقى unmarked للقرار اليدوي — auto_classify).
 * - التثبيت تراكمي (upsert بالمفتاح gateway+opDate+phone+amount+ref): الموزَّع/المسدد/اليدوي لا يُمسَّان.
 * - T+1 بأيام عمل (الجمعة والسبت عطلة) — KNET فوري في الكود (تعارض موثق مع PLAN §1؛ الكود هو المعتمد).
 * - التصفية اليومية الثلاثية sys×gw×bank: expect = إجمالي−عمولات · بنك D+N±1 يوم عمل ± tolerance ·
 *   gap = mine−sys · الحالة: diff/done/pending/late.
 * - تسديد الشركة الأخرى لا ينشئ أي سند (حرفيًا V4.5.13) — صافي = gross − fee بتوزيع جزئي transfer_op_allocs،
 *   والدفع فوق الصافي مسموح («فروقات عمولة») بلا حاجز.
 * - كل الأرصدة محسوبة لحظيًا من الحركات — لا تخزين أرصدة.
 */

export type DbClient = Prisma.TransactionClient | PrismaClient;

export class GatewayError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const GATEWAY_STATUSES = ["mine", "other", "unmarked"] as const;
export const GATEWAY_STATUS_LABELS: Record<string, string> = {
  mine: "✅ شركتنا",
  other: "🏢 شركة أخرى",
  unmarked: "⚪ غير مصنّف",
};
export const CLEARING_STATUS_LABELS: Record<string, string> = {
  done: "✅ مكتمل",
  pending: "⏳ منتظر",
  late: "🔴 متأخر",
  diff: "⚠️ فرق",
};

// ==================== أيام العمل والتواريخ ====================

/** يوم عمل = ليس جمعة ولا سبت (WEEKEND=(4,5) بمقاييس بايثون) */
export function isWorkday(iso: string): boolean {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return true;
  const wd = d.getUTCDay(); // 0 أحد … 5 جمعة … 6 سبت
  return wd !== 5 && wd !== 6;
}

/** D+N بأيام عمل (N موجب/سالب) — إضافة كاملة الأيام بعدها تخطي العطلات */
export function addBusinessDays(dateStr: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return "";
  const step = n >= 0 ? 1 : -1;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  let left = Math.abs(n);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (isWorkday(d.toISOString().slice(0, 10))) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

const dayDiff = (a: string, b: string): number => {
  const d1 = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime();
  const d2 = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime();
  if (isNaN(d1) || isNaN(d2)) return 99999;
  return Math.round((d2 - d1) / 86400000);
};

/**
 * تاريخ الاستحقاق الفعلي T+1 لأيام العمل — عمليات البوابة كلها «بوابة» ⇒ T+1 دائمًا.
 * (KNET/نقدي/شيك فوري في مسار سندات القبض — ليس هنا؛ تعارض موثق PLAN §1 ↔ الكود.)
 */
export function effectiveDate(opDate: string, method = "بوابة"): string {
  if (!opDate) return "";
  const m = (method || "").trim();
  if (m && !["بوابة", "تحويل بنكي", "gateway"].includes(m)) return opDate;
  return addBusinessDays(opDate, 1);
}

/** متوقع تحصيل البوابة «ثاني يوم» — الخميس/الجمعة/السبت ⇒ الأحد (عطلة بنوك مختلفة) V4.41 */
export function expectedCollectionDate(opDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opDate || "")) return "";
  const d = new Date(`${opDate.slice(0, 10)}T00:00:00Z`);
  const wd = d.getUTCDay();
  const delta = wd >= 3 && wd <= 5 ? 7 - wd : 1;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ==================== توحيد الهواتف والأسماء ====================

/** أرقام فقط بلا أصفار بادئة — للمقارنة المرنة */
export function normalizePhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.replace(/^0+/, "");
}

/** الصيغة الموحدة للروابط: تجريد رمز الكويت 965 */
export function canonPhone(raw: unknown): string {
  const d = normalizePhone(raw);
  if (d.length === 11 && d.startsWith("965")) return d.slice(3);
  if (d.length === 9 && d.startsWith("965") && "234".includes(d[3] || "")) return d.slice(3);
  return d;
}

/** تطابق إذا تساويا أو احتوى أحدهما الآخر (لاحقة ≥7 أرقام) */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 7 && nb.length >= 7) return na.endsWith(nb) || nb.endsWith(na);
  return false;
}

/** توحيد الاسم العربي/اللاتيني (تشكيل/ألف/تاء مربوطة/ألف مقصورة/مسافات) */
export function normalizeName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na.length >= 3 && na === nb;
}

/** تشابه جزئي: كلمات الأقصر كلها في الأطول */
export function namesSimilar(fileName: string, sysName: string): boolean {
  const a = normalizeName(fileName).split(" ").filter(Boolean);
  const b = normalizeName(sysName).split(" ").filter(Boolean);
  if (!a.length || !b.length) return false;
  const [short_, long] = a.length <= b.length ? [a, b] : [b, a];
  return short_.every((tok) => long.includes(tok));
}

const normContract = (text: unknown): string =>
  String(text ?? "").replace(/[\s\-_/]+/g, "").toLowerCase();

/** البيان/المرجع يذكر رقم العقد؟ (رابط مرجّح — لا يكفي وحده) */
export function contractHint(fileDescr: string, fileRef: string, contractNumber: string): boolean {
  const cn = normContract(contractNumber);
  if (cn.length < 3) return false;
  const hay = normContract(fileDescr) + "|" + normContract(fileRef);
  return hay.includes(cn);
}

// ==================== بروفايلات البوابات ====================

export interface GatewayProfileLike {
  id: number;
  name: string;
  bankAccount: string;
  methods: string;
  lagDays: number;
  feeFixed: number;
  tolerance: number;
  lateDays: number;
  isActive: boolean;
}

export async function listProfiles(activeOnly = true): Promise<GatewayProfileLike[]> {
  const rows = await db.gatewayProfile.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: { name: "asc" },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    bankAccount: p.bankAccount || "",
    methods: p.methods || "",
    lagDays: p.lagDays ?? 1,
    feeFixed: r3(Number(p.feeFixed || 0)),
    tolerance: r3(Number(p.tolerance || 0.005)),
    lateDays: p.lateDays ?? 3,
    isActive: p.isActive,
  }));
}

export async function profileByName(name: string): Promise<GatewayProfileLike | null> {
  const all = await listProfiles(false);
  return all.find((p) => p.name === name) || null;
}

/** عمولة كل بوابة {name: feeFixed} — تُخصم من مستحق الأخرى (صافي) */
export async function gatewayFeeMap(): Promise<Map<string, number>> {
  const all = await listProfiles(false);
  return new Map(all.map((p) => [p.name, p.feeFixed]));
}

export function methodKeywords(methods: string): string[] {
  return (methods || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** هل تشير طريقة السند إلى هذه البوابة (كلمات مفصولة بفاصلة — LIKE %kw%) */
export function methodRefersTo(method: string, keywords: string[]): boolean {
  if (!keywords.length) return true; // بلا كلمات: لا قيد
  const m = (method || "").trim();
  if (!m) return false;
  const low = m.toLowerCase();
  return keywords.some((k) => low.includes(k.toLowerCase()));
}

// ==================== سندات القبض للمطابقة ====================

export interface ReceiptRow {
  id: number;
  voucherNumber: string;
  vdate: string;
  amount: number;
  method: string;
  description: string;
  phone: string;
  customer: string;
  customerId: number;
  contractNumber: string;
}

/** سندات القبض السارية مع هاتف واسم العميل (للمطابقة) — كما في receipt_phones */
export async function receiptRowsForMatching(): Promise<ReceiptRow[]> {
  const rows = await db.voucher.findMany({
    where: { vtype: "receipt", cancelled: false },
    select: {
      id: true,
      voucherNumber: true,
      vdate: true,
      amount: true,
      method: true,
      description: true,
      partyType: true,
      partyId: true,
      contractId: true,
    },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
  });
  if (!rows.length) return [];
  const customerIds = new Set<number>();
  const contractIds = new Set<number>();
  for (const v of rows) {
    if (v.partyType === "customer" && v.partyId) customerIds.add(v.partyId);
    if (v.contractId) contractIds.add(v.contractId);
  }
  type CustRow = { id: number; name: string; phone: string };
  type ContractRow = { id: number; contractNumber: string; customerId: number };
  const customers: CustRow[] = customerIds.size
    ? await db.customer.findMany({
        where: { id: { in: [...customerIds] } },
        select: { id: true, name: true, phone: true },
      })
    : [];
  const contracts: ContractRow[] = contractIds.size
    ? await db.contract.findMany({
        where: { id: { in: [...contractIds] } },
        select: { id: true, contractNumber: true, customerId: true },
      })
    : [];
  const custById = new Map<number, CustRow>(customers.map((c) => [c.id, c]));
  const contractById = new Map<number, ContractRow>(contracts.map((c) => [c.id, c]));
  const extraCustomerIds = new Set<number>();
  for (const c of contracts) if (c.customerId) extraCustomerIds.add(c.customerId);
  const missingIds = [...extraCustomerIds].filter((id) => !custById.has(id));
  if (missingIds.length) {
    const extraCustomers = await db.customer.findMany({
      where: { id: { in: missingIds } },
      select: { id: true, name: true, phone: true },
    });
    for (const c of extraCustomers) custById.set(c.id, c);
  }

  const out: ReceiptRow[] = [];
  for (const v of rows) {
    const contract = v.contractId ? contractById.get(v.contractId) : undefined;
    const cid = v.partyType === "customer" && v.partyId ? v.partyId : contract?.customerId || 0;
    const cust = cid ? custById.get(cid) : undefined;
    out.push({
      id: v.id,
      voucherNumber: v.voucherNumber,
      vdate: v.vdate || "",
      amount: r3(Number(v.amount || 0)),
      method: v.method || "",
      description: v.description || "",
      phone: cust?.phone || "",
      customer: cust?.name || "",
      customerId: cid,
      contractNumber: contract?.contractNumber || "",
    });
  }
  return out;
}

// ==================== الروابط المحفوظة (match_aliases) ====================

export interface AliasHitInput {
  filePhone: string;
  fileName: string;
}

/** عميل الرابط المحفوظ: اسم دقيق + هاتف (دقيق أو لاحقة ≥7) */
export async function aliasHit(input: AliasHitInput): Promise<number> {
  const fn = normalizeName(input.fileName);
  if (!fn) return 0;
  const fp = canonPhone(input.filePhone);
  if (!fp) return 0;
  const rows = await db.matchAlias.findMany({ where: { fileName: fn } });
  for (const r of rows) {
    const sp = canonPhone(r.filePhone);
    if (!sp) continue;
    if (sp === fp || (sp.length >= 7 && fp.length >= 7 && (sp.endsWith(fp) || fp.endsWith(sp)))) {
      return r.customerId || 0;
    }
  }
  return 0;
}

export async function saveAlias(filePhone: string, fileName: string, customerId: number): Promise<void> {
  if (!customerId) throw new GatewayError("اختر سندًا بعميل صحيح.");
  const companyId = await currentCompanyId();
  if (companyId == null) throw new GatewayError("سياق الشركة مفقود");
  await db.matchAlias.upsert({
    where: { companyId_filePhone_fileName: { companyId, filePhone: canonPhone(filePhone), fileName: normalizeName(fileName) } },
    update: { customerId },
    create: { filePhone: canonPhone(filePhone), fileName: normalizeName(fileName), customerId },
  });
}

// ==================== المطابقة التلقائية ====================

export interface MatchCandidate extends ReceiptRow {
  rank: number; // 0 هاتف+اسم · 1 هاتف/رابط · 2 اسم · 3 اسم جزئي · 4 مبلغ فقط
  via: string;
  window: number;
  hint: boolean;
  dayGap: number;
}

const WINDOW_DAYS = 5; // نافذة الهاتف/الرابط
const NAME_WINDOW_DAYS = 3; // نافذة الاسم

/** مرشحو السند لعملية واحدة: هوية (هاتف/اسم/رابط) ثم مبلغ فقط (رصيد إجمالي يطابق) */
function buildCandidates(
  op: { phone: string; fileName: string; amount: number; opDate: string; ref: string },
  receipts: ReceiptRow[],
  aliasCid: number,
  keywords: string[]
): MatchCandidate[] {
  const hit = new Map<number, { c: ReceiptRow; phone: boolean; exact: boolean; partial: boolean; alias: boolean }>();
  for (const c of receipts) {
    // التأهيل: طريقة السند تشير للبوابة — أو سندات عميل الرابط المحفوظ حصريًا
    const qualifies = methodRefersTo(c.method, keywords) || (aliasCid > 0 && c.customerId === aliasCid);
    if (!qualifies) continue;
    const e = hit.get(c.id) || { c, phone: false, exact: false, partial: false, alias: false };
    if (op.phone && c.phone && phonesMatch(c.phone, op.phone)) e.phone = true;
    if (aliasCid > 0 && c.customerId === aliasCid) e.alias = true;
    if (op.fileName && c.customer) {
      if (namesMatch(c.customer, op.fileName)) e.exact = true;
      else if (namesSimilar(op.fileName, c.customer)) e.partial = true;
    }
    hit.set(c.id, e);
  }
  const cands: MatchCandidate[] = [];
  for (const { c, phone, exact, partial, alias } of hit.values()) {
    let rank: number;
    let via: string;
    if (exact && phone) {
      rank = 0;
      via = "الهاتف والاسم";
    } else if (phone) {
      rank = 1;
      via = "الهاتف";
    } else if (alias) {
      rank = 1;
      via = "رابط محفوظ";
    } else if (exact) {
      rank = 2;
      via = "الاسم";
    } else if (partial) {
      rank = 3;
      via = "اسم جزئي";
    } else {
      continue;
    }
    const hint = contractHint("", op.ref || "", c.contractNumber || "");
    if (hint) via = "عقد + " + via;
    const window = phone || alias ? WINDOW_DAYS : NAME_WINDOW_DAYS;
    cands.push({ ...c, rank, via, window, hint, dayGap: Math.abs(dayDiff(c.vdate, op.opDate)) });
  }
  // مبلغ فقط (رصيد إجمالي يطابق) — أضعف المرشحين وبعد فشل كل الهويات
  if (!cands.length) {
    for (const c of receipts) {
      if (!methodRefersTo(c.method, keywords)) continue;
      cands.push({
        ...c,
        rank: 4,
        via: "المبلغ",
        window: WINDOW_DAYS,
        hint: false,
        dayGap: Math.abs(dayDiff(c.vdate, op.opDate)),
      });
    }
  }
  cands.sort((x, y) => x.rank - y.rank || x.dayGap - y.dayGap || x.id - y.id);
  return cands;
}

/** مطابقة عملية واحدة: هوية + مبلغ ±tolerance + نافذة — يعيد {receiptNo, customer, via} أو null */
export async function matchOneOp(
  op: { phone: string; fileName: string; amount: number; opDate: string; ref: string },
  receipts: ReceiptRow[],
  usedReceipts: Set<string>,
  keywords: string[],
  tolerance: number
): Promise<{ receiptNo: string; customer: string; via: string } | null> {
  const tol = Math.max(EPS, tolerance);
  // الرابط المحفوظ: هوية الملف (هاتف+اسم) ← عميل النظام
  const aliasCid = op.phone || op.fileName ? await aliasHit({ filePhone: op.phone, fileName: op.fileName }) : 0;
  const cands = buildCandidates(op, receipts, aliasCid, keywords).filter(
    (c) => !usedReceipts.has(c.voucherNumber)
  );
  for (const c of cands) {
    if (Math.abs(c.amount - op.amount) > tol) continue;
    if (c.dayGap > c.window) continue;
    return { receiptNo: c.voucherNumber, customer: c.customer, via: c.via };
  }
  return null;
}

// ==================== التثبيت (upsert) + رفع ملف التسوية ====================

export interface SettlementRowInput {
  opDate: string;
  phone: string;
  amount: number;
  ref?: string;
  customer?: string;
  gwPaid?: number | null;
}

export interface ParsedSettlementFile {
  rows: SettlementRowInput[];
  skipped: number;
  skipReasons: string[];
}

/** تحليل نص خام (comma/tab/semicolon) مع كشف أعمدة بالكلمات المفتاحية */
export function parseSettlementText(text: string): ParsedSettlementFile {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: SettlementRowInput[] = [];
  const skipReasons: string[] = [];
  if (!lines.length) return { rows, skipped: 0, skipReasons };
  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const cell = (l: string): string[] => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
  const DATE_KEYS = ["تاريخ", "التاريخ", "date", "يوم", "opdate", "op_date", "القيد", "posting"];
  const PHONE_KEYS = ["هاتف", "جوال", "phone", "mobile", "tel", "رقم"];
  const AMOUNT_KEYS = ["مبلغ", "المبلغ", "amount", "value", "قيمة"];
  const REF_KEYS = ["مرجع", "ref", "reference", "id"];
  const NAME_KEYS = ["اسم", "الاسم", "customer", "name", "client"];
  const hasHeader = (l: string): boolean => {
    const low = cell(l).map((c) => c.toLowerCase());
    return low.some((c) => DATE_KEYS.includes(c)) && low.some((c) => AMOUNT_KEYS.includes(c));
  };
  let cols: Record<string, number> | null = null;
  let start = 0;
  if (hasHeader(lines[0])) {
    const head = cell(lines[0]).map((c) => c.toLowerCase());
    cols = {};
    const findCol = (keys: string[]): number => head.findIndex((h) => keys.some((k) => h.includes(k)));
    cols.opDate = findCol(DATE_KEYS);
    cols.phone = findCol(PHONE_KEYS);
    cols.amount = findCol(AMOUNT_KEYS);
    cols.ref = findCol(REF_KEYS);
    cols.customer = findCol(NAME_KEYS);
    start = 1;
  }
  for (let i = start; i < lines.length; i++) {
    const parts = cell(lines[i]);
    const pick = (c: number | undefined, fallbackIdx: number): string =>
      cols && cols.opDate >= 0 ? (c !== undefined && c >= 0 ? parts[c] || "" : "") : parts[fallbackIdx] || "";
    const opDateRaw = cols ? pick(cols.opDate, 0) : parts[0] || "";
    const phoneRaw = cols ? pick(cols.phone, 1) : parts[1] || "";
    const amountRaw = cols ? pick(cols.amount, 2) : parts[2] || "";
    const refRaw = cols ? pick(cols.ref, 3) : parts[3] || "";
    const nameRaw = cols ? pick(cols.customer, 4) : parts[4] || "";
    const opDate = (opDateRaw.match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
    const amount = r3(Number(String(amountRaw).replace(/[^\d.\-]/g, "")) || 0);
    if (!opDate || !amount) {
      skipReasons.push(`سطر ${i + 1}: تاريخ أو مبلغ غير صالح — تجاهل`);
      continue;
    }
    rows.push({
      opDate,
      phone: (phoneRaw || "").trim(),
      amount,
      ref: (refRaw || "").trim(),
      customer: (nameRaw || "").trim(),
    });
  }
  return { rows, skipped: rows.length ? 0 : lines.length - start, skipReasons };
}

export interface UploadResult {
  received: number;
  inserted: number;
  updated: number;
  ignoredLocked: number;
  matched: number;
  summary: {
    mine: { count: number; amount: number };
    other: { count: number; amount: number };
    unmarked: { count: number; amount: number };
    total: { count: number; amount: number };
  };
  checklist: string[];
}

/** رفع ملف تسوية: تثبيت تراكمي + مطابقة تلقائية لغير المصنف (البوابة الواحدة) */
export async function uploadSettlementFile(
  gatewayName: string,
  rows: SettlementRowInput[],
  batch: string,
  username: string
): Promise<UploadResult> {
  const gateway = (gatewayName || "").trim();
  if (!gateway) throw new GatewayError("اسم البوابة إلزامي.");
  if (!rows.length) throw new GatewayError("لا توجد صفوف صالحة في الملف.");
  const profile = await profileByName(gateway);
  const keywords = profile ? methodKeywords(profile.methods) : [];
  const tolerance = profile ? profile.tolerance : 0.005;
  const today = todayStr();

  // سندات مستبعدة من المطابقة: مربوطة بعملية أخرى (شركتنا)
  const linkedOps = await db.gatewayOp.findMany({
    where: { status: "mine", receiptNo: { not: "" } },
    select: { id: true, receiptNo: true },
  });
  const usedReceipts = new Set(linkedOps.map((o) => o.receiptNo));

  // 1) التثبيت التراكمي: upsert بالمفتاح — الموزَّع/المسدد/اليدوي لا يُمسَّان
  let inserted = 0;
  let updated = 0;
  let ignoredLocked = 0;
  for (const r of rows) {
    const amount = r3(Number(r.amount || 0));
    const opDate = (r.opDate || "").slice(0, 10);
    const phone = (r.phone || "").trim();
    const ref = (r.ref || "").trim();
    const ed = effectiveDate(opDate, "بوابة");
    const cid = await currentCompanyId();
    if (cid == null) throw new GatewayError("سياق الشركة مفقود");
    const existing = await db.gatewayOp.findUnique({
      where: {
        companyId_gateway_opDate_phone_amount_ref: { companyId: cid, gateway, opDate, phone, amount, ref },
      },
    });
    const gwPaid = r.gwPaid === null || r.gwPaid === undefined ? null : Number(r.gwPaid);
    if (existing) {
      const locked =
        existing.distributed ||
        (existing.paidTransferId ?? 0) > 0 ||
        existing.classifiedManual;
      if (locked) {
        ignoredLocked += 1;
        continue;
      }
      await db.gatewayOp.update({
        where: { id: existing.id },
        data: {
          status: "unmarked",
          receiptNo: "",
          customer: r.customer?.trim() || existing.customer || "",
          batch: batch || existing.batch || "",
          effectiveDate: ed,
          gwPaid,
        },
      });
      updated += 1;
    } else {
      await db.gatewayOp.create({
        data: {
          gateway,
          opDate,
          phone,
          amount,
          ref,
          status: "unmarked",
          receiptNo: "",
          customer: r.customer?.trim() || "",
          batch: batch || "",
          effectiveDate: ed,
          gwPaid,
          gwPaidDate: "",
        },
      });
      inserted += 1;
    }
  }

  // 2) المطابقة التلقائية لكل op غير مصنف من عمليات هذه البوابة
  const [receipts, unmarkedOps] = await Promise.all([
    receiptRowsForMatching(),
    db.gatewayOp.findMany({
      where: {
        gateway,
        status: "unmarked",
        distributed: false,
        classifiedManual: false,
        OR: [{ paidTransferId: null }, { paidTransferId: 0 }],
      },
      orderBy: [{ opDate: "asc" }, { id: "asc" }],
    }),
  ]);
  let matched = 0;
  for (const op of unmarkedOps) {
    const hit = await matchOneOp(
      {
        phone: op.phone || "",
        fileName: op.customer || "",
        amount: r3(Number(op.amount || 0)),
        opDate: op.opDate || "",
        ref: op.ref || "",
      },
      receipts,
      usedReceipts,
      keywords,
      tolerance
    );
    if (hit) {
      await db.gatewayOp.update({
        where: { id: op.id },
        data: { status: "mine", receiptNo: hit.receiptNo, customer: hit.customer, classifiedManual: false },
      });
      usedReceipts.add(hit.receiptNo);
      matched += 1;
    }
  }

  // 3) الملخص وقائمة الفحص
  const all = await db.gatewayOp.findMany({
    where: { gateway, batch: batch || undefined },
    select: { status: true, amount: true },
  });
  const sum = (st: string) => {
    const list = all.filter((x) => (x.status || "unmarked") === st);
    return {
      count: list.length,
      amount: r3(list.reduce((s, x) => s + Number(x.amount || 0), 0)),
    };
  };
  const summary = {
    mine: sum("mine"),
    other: sum("other"),
    unmarked: sum("unmarked"),
    total: { count: all.length, amount: r3(all.reduce((s, x) => s + Number(x.amount || 0), 0)) },
  };
  const checklist: string[] = [
    `تم استلام ${rows.length} صفًا للبوابة «${gateway}»`,
    `تثبيت تراكمي: جديد ${inserted} · محدَّث ${updated} · مقفول مُتجاهل ${ignoredLocked} (موزَّع/مسدد/يدوي)`,
    `المطابقة التلقائية: ${matched} عملية شركتنا (ضمن نافذة 5/3 أيام ± ${tolerance} د.ك)`,
    `${summary.unmarked.count} عملية بانتظار التصنيف اليدوي (شركتنا/الشركة الأخرى)`,
    `T+1 فعلي: التاريخ الاستحقاق بأيام عمل (الجمعة/السبت عطلة)`,
  ];
  if (!profile) checklist.push(`تنبيه: لا يوجد بروفايل للبوابة «${gateway}» — أضفه لضبط العمولة والتسامح وطرق الدفع`);
  await audit(db, {
    username,
    action: "gateway_upload",
    entityType: "gateway_ops",
    entityName: gateway,
    newStatus: `${summary.mine.count}/${summary.other.count}/${summary.unmarked.count}`,
    reason: batch || "",
  });
  return { received: rows.length, inserted, updated, ignoredLocked, matched, summary, checklist };
}

// ==================== قائمة العمليات ====================

export interface OpsFilter {
  gateway?: string;
  filter?: string;
  q?: string;
  from?: string;
  to?: string;
}

export async function listGatewayOps(f: OpsFilter): Promise<Record<string, unknown>[]> {
  const where: Prisma.GatewayOpWhereInput = {};
  if (f.gateway) where.gateway = f.gateway;
  if (f.from) where.opDate = { ...(where.opDate as object), gte: f.from };
  if (f.to) where.opDate = { ...(where.opDate as object), lte: f.to };
  const dist = f.filter === "distributed";
  const pending = f.filter === "pending";
  if (dist) where.distributed = true;
  else {
    where.distributed = false;
    if (f.filter === "mine" || f.filter === "other") where.status = f.filter;
    else if (f.filter === "unmarked") where.status = { in: ["", "unmarked"] };
    else if (pending) where.status = { in: ["mine", "other"] };
  }
  const q = normalizeArabic(f.q || "");
  let rows = await db.gatewayOp.findMany({
    where,
    orderBy: [{ opDate: "desc" }, { id: "desc" }],
    include: {
      allocs: { select: { amount: true } },
      feeLinks: { select: { fee: true } },
    },
  });
  if (q) {
    rows = rows.filter((o) =>
      [o.phone, o.customer, o.ref, o.receiptNo].some((s) => normalizeArabic(s || "").includes(q))
    );
  }
  const fees = await gatewayFeeMap();
  return rows.map((o) => {
    const gross = r3(Number(o.amount || 0));
    const fee = r3(fees.get(o.gateway) || 0);
    const paidAllocated = r3(o.allocs.reduce((s, a) => s + Number(a.amount || 0), 0));
    return {
      id: o.id,
      gateway: o.gateway,
      opDate: o.opDate,
      phone: o.phone,
      amount: gross,
      ref: o.ref,
      status: o.status || "unmarked",
      statusLabel: GATEWAY_STATUS_LABELS[o.status || "unmarked"] || "غير مصنّف",
      receiptNo: o.receiptNo,
      customer: o.customer,
      batch: o.batch,
      classifiedManual: o.classifiedManual,
      distributed: o.distributed,
      distributedAt: o.distributedAt || "",
      gwPaid: o.gwPaid,
      gwPaidDate: o.gwPaidDate || "",
      effectiveDate: o.effectiveDate || "",
      fee,
      net: r3(gross - fee),
      paidAllocated,
      remainingNet: r3(gross - fee - paidAllocated),
      paidTransferId: o.paidTransferId ?? 0,
      locked: o.distributed || (o.paidTransferId ?? 0) > 0 || paidAllocated > EPS,
    };
  });
}

// ==================== التصنيف اليدوي / التوزيع / الإرجاع ====================

/** استرجاع عميل سند قبض (طرف عميل أو عبر العقد) */
async function receiptCustomer(receiptNo: string): Promise<{ voucherId: number; customerId: number; customer: string } | null> {
  const v = await db.voucher.findFirst({
    where: {
      OR: [
        { voucherNumber: receiptNo, vtype: "receipt", cancelled: false },
        /^\d+$/.test(receiptNo) ? { id: Number(receiptNo), vtype: "receipt", cancelled: false } : { id: -1 },
      ],
    },
    select: { id: true, partyType: true, partyId: true, contractId: true },
  });
  if (!v) return null;
  let cid = v.partyType === "customer" ? v.partyId || 0 : 0;
  let name = "";
  if (!cid && v.contractId) {
    const c = await db.contract.findUnique({
      where: { id: v.contractId },
      select: { customerId: true },
    });
    cid = c?.customerId || 0;
  }
  if (cid) {
    const cust = await db.customer.findUnique({ where: { id: cid }, select: { name: true } });
    name = cust?.name || "";
  }
  if (!cid || !name) return null;
  return { voucherId: v.id, customerId: cid, customer: name };
}

export interface ClassifyInput {
  ids: number[];
  status: "mine" | "other" | "unmarked";
  receiptNo?: string;
  username: string;
}

/** تصنيف يدوي (مرحلة مؤقتة بلا أثر حسابي) — mine يتطلب سند قبض صحيح + حفظ رابط */
export async function classifyOps(input: ClassifyInput): Promise<{ updated: number; skipped: { id: number; reason: string }[] }> {
  if (!GATEWAY_STATUSES.includes(input.status)) throw new GatewayError("تصنيف غير صالح.");
  const ids = [...new Set(input.ids.map(Number).filter(Boolean))];
  if (!ids.length) throw new GatewayError("حدد عملية واحدة على الأقل.");
  let updated = 0;
  const skipped: { id: number; reason: string }[] = [];
  for (const id of ids) {
    const op = await db.gatewayOp.findUnique({ where: { id } });
    if (!op) {
      skipped.push({ id, reason: "غير موجودة" });
      continue;
    }
    const allocCount = await db.transferOpAlloc.count({ where: { opId: id } });
    if (allocCount > 0 || (op.paidTransferId ?? 0) > 0) {
      skipped.push({ id, reason: "العملية مسددة — لا يمكن إعادة تصنيفها" });
      continue;
    }
    if (op.distributed) {
      skipped.push({ id, reason: "العملية موزَّعة — مقفلة (ارجعها للتصنيف أولًا)" });
      continue;
    }
    if (input.status === "mine") {
      const receiptNo = (input.receiptNo || "").trim();
      if (!receiptNo) throw new GatewayError(`العملية #${id}: تصنيف «شركتنا» يتطلب رقم سند قبض صحيح.`);
      const rec = await receiptCustomer(receiptNo);
      if (!rec) throw new GatewayError(`السند «${receiptNo}» غير صالح أو بلا عميل.`);
      await db.gatewayOp.update({
        where: { id },
        data: { status: "mine", receiptNo, classifiedManual: true },
      });
      // حفظ الرابط: هوية الملف ← عميل النظام (يتعلمها للملفات القادمة)
      if (op.customer || op.phone) await saveAlias(op.phone || "", op.customer || "", rec.customerId);
    } else {
      await db.gatewayOp.update({
        where: { id },
        data: { status: input.status, classifiedManual: true, ...(input.status === "other" ? { receiptNo: "" } : {}) },
      });
    }
    updated += 1;
  }
  if (updated) {
    await audit(db, {
      username: input.username,
      action: "gateway_classify",
      entityType: "gateway_ops",
      entityId: ids[0],
      newStatus: input.status,
      reason: `عدد ${updated}`,
    });
  }
  return { updated, skipped };
}

export interface DistributeResult {
  mine: number;
  other: number;
  skipped: number;
  skippedReasons: { id: number; reason: string }[];
}

/** ◆ التوزيع الصريح: مصنَّف ← معتمد محاسبيًا (لا أثر سندات — التعليم فقط) */
export async function distributeOps(ids: number[], username: string): Promise<DistributeResult> {
  const idList = [...new Set(ids.map(Number).filter(Boolean))];
  if (!idList.length) throw new GatewayError("حدد عملية واحدة على الأقل.");
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const distributedAt = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  const result: DistributeResult = { mine: 0, other: 0, skipped: 0, skippedReasons: [] };
  for (const id of idList) {
    const op = await db.gatewayOp.findUnique({ where: { id } });
    if (!op) {
      result.skipped += 1;
      result.skippedReasons.push({ id, reason: "غير موجودة" });
      continue;
    }
    const allocCount = await db.transferOpAlloc.count({ where: { opId: id } });
    if (
      op.distributed ||
      (op.paidTransferId ?? 0) > 0 ||
      allocCount > 0 ||
      !["mine", "other"].includes(op.status || "") ||
      op.gwPaid === 0 ||
      op.gwPaid === 2
    ) {
      result.skipped += 1;
      result.skippedReasons.push({
        id,
        reason:
          op.distributed || (op.paidTransferId ?? 0) > 0 || allocCount > 0
            ? "موزَّعة/مسددة مسبقًا"
            : op.gwPaid === 0 || op.gwPaid === 2
              ? "غير محصَّلة (معلقة/ملغاة في البوابة)"
              : "غير مصنّفة",
      });
      continue;
    }
    await db.gatewayOp.update({
      where: { id },
      data: { distributed: true, classifiedManual: true, distributedAt },
    });
    if (op.status === "mine") result.mine += 1;
    else result.other += 1;
  }
  if (result.mine + result.other > 0) {
    await audit(db, {
      username,
      action: "gateway_distribute",
      entityType: "gateway_ops",
      entityId: idList[0],
      newStatus: `mine:${result.mine},other:${result.other}`,
      reason: `عدد ${result.mine + result.other}`,
    });
  }
  return result;
}

export interface UndistributeResult {
  ok: number;
  untied: number; // عُكس أثر تسديد: حُذفت تخصيصاتها من transfer_op_allocs (undo_other)
  skipped: number;
}

/** ↩ إرجاع الموزَّع للتصنيف — مع عكس أثر التسديد: حذف تخصيصات العملية وسحب المبلغ من التسديد */
export async function undistributeOps(ids: number[], username: string): Promise<UndistributeResult> {
  const idList = [...new Set(ids.map(Number).filter(Boolean))];
  if (!idList.length) throw new GatewayError("حدد عملية واحدة على الأقل.");
  const result: UndistributeResult = { ok: 0, untied: 0, skipped: 0 };
  for (const id of idList) {
    const op = await db.gatewayOp.findUnique({ where: { id } });
    if (!op || !op.distributed) {
      result.skipped += 1;
      continue;
    }
    const allocs = await db.transferOpAlloc.findMany({ where: { opId: id } });
    const touchedTransfers = new Set<number>(allocs.map((a) => a.transferId).filter(Boolean));
    const untied = allocs.length > 0 || (op.paidTransferId ?? 0) > 0;
    await db.transferOpAlloc.deleteMany({ where: { opId: id } });
    await db.gatewayOp.update({
      where: { id },
      data: {
        distributed: false,
        classifiedManual: false,
        distributedAt: "",
        paidTransferId: 0,
      },
    });
    // التسديدات الماسة: تُعاد تكلفتها إلى «على الحساب» (unallocated) — إن غطت عملية وحدها تبقى قائمة بالرصيد
    for (const tid of touchedTransfers) {
      const t = await db.otherCompanyTransfer.findUnique({ where: { id: tid }, select: { id: true } });
      if (t) {
        await audit(db, {
          username,
          action: "gateway_undistribute_other",
          entityType: "other_company_transfer",
          entityId: tid,
          oldStatus: "distributed",
          newStatus: "unallocated",
          reason: `سحب مبلغ من التسديد #${tid} بإرجاع العملية #${id}`,
        });
      }
    }
    result.ok += 1;
    if (untied) result.untied += 1;
  }
  if (result.ok) {
    await audit(db, {
      username,
      action: "gateway_undistribute",
      entityType: "gateway_ops",
      entityId: idList[0],
      newStatus: "undistributed",
      reason: `عدد ${result.ok}`,
    });
  }
  return result;
}

// ==================== التصفية اليومية الثلاثية ====================

export interface DailyClearingRow {
  gateway: string;
  day: string;
  sys: number;
  g_mine: number;
  g_other: number;
  n_mine: number;
  n_other: number;
  gap: number;
  expect: number;
  settle_date: string;
  bank_amount: number;
  bank_date: string;
  bank_descr: string;
  my_share: number;
  other_share: number;
  status: "done" | "pending" | "late" | "diff";
  statusLabel: string;
}

/** صف لكل (بوابة، يوم تشغيل): سيستم × بوابة × بنك + الحالة والتقسيم */
export async function dailyClearing(dateFrom: string, dateTo: string, gateway = ""): Promise<DailyClearingRow[]> {
  const profiles = await listProfiles(false);
  const names = gateway ? [gateway] : profiles.map((p) => p.name);
  const out: DailyClearingRow[] = [];
  const today = todayStr();
  for (const gname of names) {
    const prof = profiles.find((p) => p.name === gname);
    if (!prof) continue;
    const fee = prof.feeFixed;
    const tol = Math.max(EPS, prof.tolerance);
    const keywords = methodKeywords(prof.methods);
    // S: سندات السيستم بهذه البوابة (طرق الدفع كلمات مفصولة)
    const sysOr = keywords.map((k) => ({ method: { contains: k } }));
    const sysRows = await db.voucher.groupBy({
      by: ["vdate"],
      where: {
        vtype: "receipt",
        cancelled: false,
        ...(keywords.length ? { OR: sysOr } : {}),
        vdate: { gte: dateFrom, lte: dateTo },
      },
      _sum: { amount: true },
    });
    const sysMap = new Map(sysRows.map((r) => [r.vdate, r3(Number(r._sum.amount || 0))]));
    // G: عمليات البوابة المثبتة الموزَّعة (غير مصنّف خارج التصفية تمامًا)
    const gwRows = await db.gatewayOp.groupBy({
      by: ["opDate", "status"],
      where: {
        gateway: gname,
        distributed: true,
        OR: [{ gwPaid: null }, { gwPaid: 1 }],
        opDate: { gte: dateFrom, lte: dateTo },
      },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const gw = new Map<string, { mine: number; other: number; n: number; nMine: number; nOther: number }>();
    for (const r of gwRows) {
      const d = gw.get(r.opDate) || { mine: 0, other: 0, n: 0, nMine: 0, nOther: 0 };
      const amt = r3(Number(r._sum.amount || 0));
      const cnt = r._count._all;
      if (r.status === "mine") {
        d.mine = r3(d.mine + amt);
        d.nMine += cnt;
        d.n += cnt;
      } else if (r.status === "other") {
        d.other = r3(d.other + amt);
        d.nOther += cnt;
        d.n += cnt;
      }
      gw.set(r.opDate, d);
    }
    // حركات البنك للحساب المرتبط (نافذة موسعة ±7 أيام)
    const bank = await db.bankLine.findMany({
      where: {
        ...(prof.bankAccount ? { bankAccount: prof.bankAccount } : {}),
        cdate: { gte: addDays(dateFrom, -7), lte: addDays(dateTo, 7) },
      },
      orderBy: [{ cdate: "asc" }, { id: "asc" }],
    });
    const used = new Set<number>();
    const days = [...new Set([...sysMap.keys(), ...gw.keys()])].sort();
    for (const day of days) {
      const s = sysMap.get(day) || 0;
      const g = gw.get(day) || { mine: 0, other: 0, n: 0, nMine: 0, nOther: 0 };
      const gTotal = r3(g.mine + g.other);
      const expect = r3(gTotal - g.n * fee);
      const myShare = r3(g.mine - g.nMine * fee);
      const otherShare = r3(g.other - g.nOther * fee);
      const settle = addBusinessDays(day, prof.lagDays);
      // ربط حركة البنك: D+N ± يوم عمل + تسامح — الأقرب أولًا (فرق الأيام ثم المبلغ)
      let bankHit: { id: number; cdate: string; amount: number; descr: string } | null = null;
      if (settle && expect > 0) {
        const lo = addBusinessDays(settle, -1);
        const hi = addBusinessDays(settle, 1);
        let bestKey: [number, number] | null = null;
        for (const b of bank) {
          if (used.has(b.id)) continue;
          if (b.cdate < lo || b.cdate > hi) continue;
          if (Math.abs(Number(b.amount) - expect) > tol) continue;
          const key: [number, number] = [
            Math.abs(dayDiff(b.cdate, settle)),
            Math.abs(Number(b.amount) - expect),
          ];
          if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
            bestKey = key;
            bankHit = { id: b.id, cdate: b.cdate, amount: r3(Number(b.amount)), descr: b.descr };
          }
        }
        if (bankHit) used.add(bankHit.id);
      }
      const gap = r3(g.mine - s);
      let status: DailyClearingRow["status"];
      if (Math.abs(gap) > tol) status = "diff";
      else if (bankHit) status = "done";
      else if (settle && settle > today) status = "pending";
      else if (settle) {
        const lateLine = addBusinessDays(settle, prof.lateDays);
        status = today <= lateLine ? "pending" : "late";
      } else status = "pending";
      out.push({
        gateway: gname,
        day,
        sys: s,
        g_mine: r3(g.mine),
        g_other: r3(g.other),
        n_mine: g.nMine,
        n_other: g.nOther,
        gap,
        expect: expect > 0 ? expect : 0,
        settle_date: settle,
        bank_amount: bankHit ? bankHit.amount : 0,
        bank_date: bankHit ? bankHit.cdate : "",
        bank_descr: bankHit ? bankHit.descr : "",
        my_share: myShare,
        other_share: otherShare,
        status,
        statusLabel: CLEARING_STATUS_LABELS[status] || status,
      });
    }
  }
  out.sort((a, b) => (a.day === b.day ? a.gateway.localeCompare(b.gateway) : a.day < b.day ? -1 : 1));
  return out;
}

function addDays(dateStr: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return dateStr;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ==================== كشف البنك ====================

export interface BankLineInput {
  bankAccount?: string;
  cdate: string;
  amount: number;
  descr?: string;
}

/** استيراد كشف بنك: upsert بمنع التكرار (حساب+تاريخ+مبلغ+بيان) */
export async function saveBankLines(
  defaultAccount: string,
  lines: BankLineInput[],
  batch: string
): Promise<{ received: number; inserted: number }> {
  let inserted = 0;
  for (const x of lines) {
    const cdate = (x.cdate || "").slice(0, 10);
    const amount = r3(Number(x.amount || 0));
    if (!cdate || !Number.isFinite(amount)) continue;
    const bankAccount = (x.bankAccount || defaultAccount || "").trim();
    const descr = (x.descr || "").trim();
    const bCid = await currentCompanyId();
    if (bCid == null) throw new GatewayError("سياق الشركة مفقود");
    const existing = await db.bankLine.findUnique({
      where: { companyId_bankAccount_cdate_amount_descr: { companyId: bCid, bankAccount, cdate, amount, descr } },
    });
    if (existing) continue;
    await db.bankLine.create({ data: { bankAccount, cdate, amount, descr, batch: batch || "" } });
    inserted += 1;
  }
  return { received: lines.length, inserted };
}

/** حركات بنكية لم تربط بأي يوم تحصيل (تحويلات/إيداعات أخرى) */
export async function unmatchedBank(dateFrom: string, dateTo: string, gateway = ""): Promise<Record<string, unknown>[]> {
  const rows = await dailyClearing(dateFrom, dateTo, gateway);
  const linked = new Set(
    rows.filter((r) => r.bank_amount > 0).map((r) => `${r.bank_date}|${r.bank_amount.toFixed(3)}`)
  );
  const bank = await db.bankLine.findMany({
    where: { cdate: { gte: addDays(dateFrom, -7), lte: addDays(dateTo, 7) } },
    orderBy: { cdate: "asc" },
  });
  return bank
    .filter((b) => !linked.has(`${b.cdate}|${r3(Number(b.amount)).toFixed(3)}`))
    .map((b) => ({
      id: b.id,
      bankAccount: b.bankAccount,
      cdate: b.cdate,
      amount: r3(Number(b.amount)),
      descr: b.descr,
      batch: b.batch,
    }));
}

// ==================== ملخص البوابة ====================

/** ملخص: معلقة T+1 / محصلة اليوم / متأخرة (lateDays فات التسديد) */
export async function gatewaySummary(dateFrom = "", dateTo = ""): Promise<Record<string, unknown>> {
  const today = todayStr();
  const where: Prisma.GatewayOpWhereInput = { status: "mine" };
  if (dateFrom || dateTo) {
    where.opDate = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }
  const ops = await db.gatewayOp.findMany({
    where,
    select: {
      id: true,
      opDate: true,
      phone: true,
      amount: true,
      ref: true,
      customer: true,
      distributed: true,
      effectiveDate: true,
    },
    orderBy: { opDate: "asc" },
  });
  let total = 0;
  let collected = 0;
  let collectedCount = 0;
  let pending = 0;
  const pendingItems: Record<string, unknown>[] = [];
  let collectedToday = 0;
  let collectedTodayCount = 0;
  for (const o of ops) {
    const amt = r3(Number(o.amount || 0));
    total = r3(total + amt);
    const ed = (o.effectiveDate || "").trim();
    if (ed && ed > today && !o.distributed) {
      pending = r3(pending + amt);
      pendingItems.push({
        id: o.id,
        op_date: o.opDate,
        effective_date: ed,
        amount: amt,
        customer: o.customer || "",
        ref: o.ref || "",
        phone: o.phone || "",
      });
    } else {
      collected = r3(collected + amt);
      collectedCount += 1;
    }
    if (ed === today) {
      collectedToday = r3(collectedToday + amt);
      collectedTodayCount += 1;
    }
  }
  const late = (await dailyClearing(addDays(today, -60), today)).filter((r) => r.status === "late").slice(0, 25);
  return {
    total: { count: ops.length, amount: total },
    collected: { count: collectedCount, amount: collected },
    pendingT1: { count: pendingItems.length, amount: pending, items: pendingItems },
    collectedToday: { count: collectedTodayCount, amount: collectedToday },
    late,
    lateLabel: CLEARING_STATUS_LABELS.late,
  };
}

// ==================== الشركة الأخرى ====================

export interface OtherOpening {
  amount: number;
  note: string;
  updatedAt: Date | null;
}

export async function getOtherOpening(): Promise<OtherOpening> {
  const cid = await currentCompanyId();
  if (cid == null) throw new GatewayError("سياق الشركة مفقود");
  let row = await db.otherCompanyOpening.findFirst({ where: { companyId: cid } });
  if (!row) row = await db.otherCompanyOpening.create({ data: { amount: 0, note: "" } });
  return { amount: r3(Number(row.amount || 0)), note: row.note || "", updatedAt: row.updatedAt };
}

export async function setOtherOpening(amount: number, note: string, username: string): Promise<OtherOpening> {
  const amt = r3(Number(amount || 0));
  if (amt < 0) throw new GatewayError("الرصيد الافتتاحي لا يكون سالبًا.");
  const cid = await currentCompanyId();
  if (cid == null) throw new GatewayError("سياق الشركة مفقود");
  const existing = await db.otherCompanyOpening.findFirst({ where: { companyId: cid } });
  if (existing) {
    await db.otherCompanyOpening.update({ where: { id: existing.id }, data: { amount: amt, note: (note || "").trim() } });
  } else {
    await db.otherCompanyOpening.create({ data: { amount: amt, note: (note || "").trim() } });
  }
  await audit(db, {
    username,
    action: "other_opening",
    entityType: "other_company_opening",
    entityId: 1,
    newStatus: String(amt),
    reason: (note || "").trim(),
  });
  return getOtherOpening();
}

export const DUES_ELIGIBLE: Prisma.GatewayOpWhereInput = {
  status: "other",
  distributed: true,
  OR: [{ gwPaid: null }, { gwPaid: 1 }],
};

/** مستحق الأخرى = صفوف «شركة أخرى» الموزَّعة (صافي بعد الرسوم) — تراكمي */
export async function otherStatement(dateFrom: string, dateTo: string): Promise<{ day: string; gateway: string; otherShare: number; cumulative: number }[]> {
  const rows = await db.gatewayOp.groupBy({
    by: ["opDate", "gateway"],
    where: { ...DUES_ELIGIBLE, opDate: { gte: dateFrom, lte: dateTo } },
    _count: { _all: true },
    _sum: { amount: true },
    orderBy: [{ opDate: "asc" }, { gateway: "asc" }],
  });
  const fees = await gatewayFeeMap();
  let run = 0;
  const out: { day: string; gateway: string; otherShare: number; cumulative: number }[] = [];
  for (const r of rows) {
    const share = r3(Number(r._sum.amount || 0) - r._count._all * (fees.get(r.gateway) || 0));
    if (share <= 0) continue;
    run = r3(run + share);
    out.push({ day: r.opDate, gateway: r.gateway, otherShare: share, cumulative: run });
  }
  return out;
}

async function duesCumulative(dateTo: string): Promise<number> {
  const rows = await otherStatement("2000-01-01", dateTo);
  return rows.length ? rows[rows.length - 1].cumulative : 0;
}

/** رصيد الشركة الأخرى: افتتاحي + مستحق صافي − تسديدات (قد يصير سالبًا = فروقات عمولة) */
export async function otherBalance(): Promise<Record<string, unknown>> {
  const opening = await getOtherOpening();
  const stmt = await otherStatement("2000-01-01", todayStr());
  const duesTotal = stmt.length ? stmt[stmt.length - 1].cumulative : 0;
  const trAgg = await db.otherCompanyTransfer.aggregate({ _sum: { amount: true } });
  const paid = r3(Number(trAgg._sum.amount || 0));
  const grossAgg = await db.gatewayOp.aggregate({
    where: DUES_ELIGIBLE,
    _sum: { amount: true },
    _count: { _all: true },
  });
  const fees = await gatewayFeeMap();
  const nOps = grossAgg._count._all;
  let feesTotal = 0;
  const byGw = await db.gatewayOp.groupBy({
    by: ["gateway"],
    where: DUES_ELIGIBLE,
    _count: { _all: true },
  });
  for (const g of byGw) feesTotal = r3(feesTotal + g._count._all * (fees.get(g.gateway) || 0));
  const grossDue = r3(Number(grossAgg._sum.amount || 0));
  const dues = r3(opening.amount + duesTotal);
  return {
    opening,
    dues,
    paid,
    remaining: r3(dues - paid),
    side: {
      duesTotal,
      grossDue,
      feesTotal,
      netDue: r3(grossDue - feesTotal),
      nOps,
    },
  };
}

/** عمليات الشركة الأخرى غير المسددة بالكامل (صافي-الأساس V4.49) */
export async function dueItems(gateway = "", q = ""): Promise<Record<string, unknown>[]> {
  const ops = await db.gatewayOp.findMany({
    where: { ...DUES_ELIGIBLE, ...(gateway ? { gateway } : {}) },
    orderBy: [{ opDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      gateway: true,
      opDate: true,
      phone: true,
      customer: true,
      ref: true,
      amount: true,
      effectiveDate: true,
      gwPaid: true,
      gwPaidDate: true,
    },
  });
  const allocAgg = await db.transferOpAlloc.groupBy({
    by: ["opId"],
    _sum: { amount: true },
  });
  const paidByOp = new Map(allocAgg.map((a) => [a.opId, r3(Number(a._sum.amount || 0))]));
  const fees = await gatewayFeeMap();
  const nq = normalizeArabic(q || "");
  const out: Record<string, unknown>[] = [];
  for (const o of ops) {
    const gross = r3(Number(o.amount || 0));
    const fee = r3(fees.get(o.gateway) || 0);
    const net = r3(gross - fee);
    const paid = paidByOp.get(o.id) || 0;
    const remaining = r3(net - paid);
    if (remaining <= 0.0005) continue;
    if (
      nq &&
      ![o.phone, o.customer, o.ref].some((s) => normalizeArabic(s || "").includes(nq))
    )
      continue;
    out.push({
      opId: o.id,
      gateway: o.gateway,
      opDate: o.opDate,
      phone: o.phone,
      customer: o.customer || "",
      ref: o.ref || "",
      gross,
      fee,
      net,
      paidAllocated: paid,
      remaining,
      effectiveDate: o.effectiveDate || "",
      gwPaid: o.gwPaid,
      gwPaidDate: o.gwPaidDate || "",
    });
  }
  return out;
}

export interface TransferRow {
  id: number;
  tdate: string;
  amount: number;
  method: string;
  ref: string;
  notes: string;
  createdAt: Date;
  alloc: number;
  unalloc: number;
  nOps: number;
  dates: string[];
  status: "open" | "full" | "partial";
  allocs: { opId: number; amount: number; opDate: string; customer: string; phone: string; gateway: string }[];
}

/** قائمة تسديدات الشركة الأخرى مع تخصيصاتها (الأحدث آخرًا بالترتيب الزمني) */
export async function listTransfers(dateFrom = "", dateTo = ""): Promise<TransferRow[]> {
  const transfers = await db.otherCompanyTransfer.findMany({
    where: {
      ...(dateFrom ? { tdate: { gte: dateFrom } } : {}),
      ...(dateTo ? { tdate: { lte: dateTo } } : {}),
    },
    orderBy: [{ tdate: "asc" }, { id: "asc" }],
  });
  const allocs = await db.transferOpAlloc.findMany({
    where: transfers.length ? { transferId: { in: transfers.map((t) => t.id) } } : { transferId: -1 },
  });
  const opIds = [...new Set(allocs.map((a) => a.opId))];
  const ops = opIds.length
    ? await db.gatewayOp.findMany({
        where: { id: { in: opIds } },
        select: { id: true, opDate: true, customer: true, phone: true, gateway: true },
      })
    : [];
  const opById = new Map(ops.map((o) => [o.id, o]));
  const out: TransferRow[] = [];
  for (const t of transfers) {
    const mine = allocs.filter((a) => a.transferId === t.id);
    const alloc = r3(mine.reduce((s, a) => s + Number(a.amount || 0), 0));
    const unalloc = r3(Number(t.amount || 0) - alloc);
    const dates = [...new Set(mine.map((a) => opById.get(a.opId)?.opDate || "").filter(Boolean))].sort();
    const status: TransferRow["status"] =
      mine.length === 0 ? "open" : unalloc <= 0.0005 ? "full" : "partial";
    out.push({
      id: t.id,
      tdate: t.tdate,
      amount: r3(Number(t.amount || 0)),
      method: t.method || "",
      ref: t.ref || "",
      notes: t.notes || "",
      createdAt: t.createdAt,
      alloc,
      unalloc,
      nOps: mine.length,
      dates,
      status,
      allocs: mine.map((a) => {
        const op = opById.get(a.opId);
        return {
          opId: a.opId,
          amount: r3(Number(a.amount || 0)),
          opDate: op?.opDate || "",
          customer: op?.customer || "",
          phone: op?.phone || "",
          gateway: op?.gateway || "",
        };
      }),
    });
  }
  return out;
}

export interface AddTransferInput {
  tdate: string;
  amount: number;
  method?: string;
  ref?: string;
  notes?: string;
  opIds?: ({ opId: number; amount: number } | number)[];
  username: string;
}

/**
 * تسديد الشركة الأخرى — لا ينشئ أي سند نهائيًا (حرفيًا V4.5.13).
 * التخصيص جزئي على العمليات على الصافي (gross − fee)؛ الدفع فوق الصافي مسموح «فروقات عمولة».
 */
export async function addOtherTransfer(input: AddTransferInput): Promise<Record<string, unknown>> {
  const tdate = (input.tdate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tdate)) throw new GatewayError("تاريخ التحويل غير صالح.");
  const amount = r3(Number(input.amount || 0));
  if (amount <= 0) throw new GatewayError("مبلغ التحويل يجب أن يكون أكبر من صفر.");
  const fees = await gatewayFeeMap();

  // تطبيع opIds: [{opId, amount}] صريح أو [opId] تلقائي FIFO
  const raw = Array.isArray(input.opIds) ? input.opIds : [];
  const explicit = raw
    .map((x) =>
      typeof x === "object" && x !== null
        ? { opId: Number((x as { opId: number }).opId || 0), amount: r3(Number((x as { amount: number }).amount || 0)) }
        : { opId: Number(x || 0), amount: 0 }
    )
    .filter((x) => x.opId > 0);

  // التحقق من صلاحية كل عملية: موجودة · محصَّلة · موزَّعة · للشركة الأخرى · غير مسددة
  const remaining = new Map<number, number>();
  for (const item of explicit) {
    const op = await db.gatewayOp.findUnique({ where: { id: item.opId } });
    if (!op) throw new GatewayError("عملية غير موجودة ضمن المحدد.");
    if (op.gwPaid === 0 || op.gwPaid === 2)
      throw new GatewayError("عملية غير محصَّلة ضمن المحدد — لا يمكن تسديد ما لم يدفعه العميل.");
    if (!op.distributed) throw new GatewayError("عملية غير موزَّعة ضمن المحدد — وزّعها أولًا.");
    if ((op.status || "") !== "other") throw new GatewayError("العملية ليست من عمليات الشركة الأخرى.");
    const paid = await opPaidTotal(op.id);
    const full = r3(Number(op.amount || 0) - (fees.get(op.gateway) || 0));
    if (paid >= full - 0.0005) throw new GatewayError("عملية مسددة مسبقًا ضمن المحدد — أعد التحديد.");
    const rem = r3(full - paid);
    remaining.set(item.opId, rem);
  }
  const explicitSum = r3(explicit.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0));
  if (explicitSum > amount + 0.0005)
    throw new GatewayError("مجموع التخصيصات الصريحة يتجاوز مبلغ التسديد.");

  const transfer = await db.otherCompanyTransfer.create({
    data: {
      tdate,
      amount,
      ref: (input.ref || "").trim(),
      notes: (input.notes || "").trim(),
      method: (input.method || "").trim(),
      voucherId: 0,
      voucherNumber: "",
    },
  });
  const allocs: { opId: number; amount: number }[] = [];
  let left = amount;
  const autoTargets = explicit.filter((x) => x.amount <= 0).map((x) => x.opId);
  // صريح أولًا — المبلغ الصريح يُقص على متبقي الصافي (كالمصدر min) والفائض يبقى «فروقات عمولة» على الحساب
  for (const item of explicit) {
    if (item.amount <= 0) continue;
    const rem = remaining.get(item.opId) || 0;
    const take = Math.min(rem, r3(left), item.amount);
    if (take > 0.0005) {
      allocs.push({ opId: item.opId, amount: r3(take) });
      left = r3(left - take);
    }
  }
  // تلقائي FIFO على المتبقي (العمليات المحددة بلا مبلغ، وإلا كل المستحق)
  let fifo: { id: number; opDate: string; rem: number }[] = [];
  if (autoTargets.length) {
    const ops = await db.gatewayOp.findMany({
      where: { id: { in: autoTargets } },
      select: { id: true, opDate: true, amount: true, gateway: true },
    });
    for (const o of ops) {
      const paid = await opPaidTotal(o.id);
      const rem = r3(Number(o.amount || 0) - (fees.get(o.gateway) || 0) - paid);
      if (rem > 0.0005) fifo.push({ id: o.id, opDate: o.opDate, rem });
    }
  } else if (!explicit.length) {
    const ops = await db.gatewayOp.findMany({
      where: DUES_ELIGIBLE,
      orderBy: [{ opDate: "asc" }, { id: "asc" }],
      select: { id: true, opDate: true, amount: true, gateway: true },
    });
    for (const o of ops) {
      const paid = await opPaidTotal(o.id);
      const rem = r3(Number(o.amount || 0) - (fees.get(o.gateway) || 0) - paid);
      if (rem > 0.0005) fifo.push({ id: o.id, opDate: o.opDate, rem });
    }
  }
  fifo.sort((a, b) => (a.opDate === b.opDate ? a.id - b.id : a.opDate < b.opDate ? -1 : 1));
  for (const o of fifo) {
    if (left <= 0.0005) break;
    const take = Math.min(o.rem, r3(left));
    if (take > 0.0005) {
      allocs.push({ opId: o.id, amount: r3(take) });
      left = r3(left - take);
    }
  }
  const completed: number[] = [];
  for (const a of allocs) {
    await db.transferOpAlloc.create({
      data: { transferId: transfer.id, opId: a.opId, amount: a.amount },
    });
    const rem = remaining.get(a.opId);
    if (rem !== undefined && a.amount >= rem - 0.0005) {
      await db.gatewayOp.update({ where: { id: a.opId }, data: { paidTransferId: transfer.id } });
      completed.push(a.opId);
    }
  }
  await audit(db, {
    username: input.username,
    action: "other_transfer_create",
    entityType: "other_company_transfer",
    entityId: transfer.id,
    newStatus: String(amount),
    reason: (input.ref || "").trim() + (completed.length ? ` · غطى ${completed.length}` : ""),
  });
  const allocTotal = r3(allocs.reduce((s, a) => s + a.amount, 0));
  return {
    transfer: {
      id: transfer.id,
      tdate,
      amount,
      method: transfer.method,
      ref: transfer.ref,
      notes: transfer.notes,
    },
    allocs,
    allocTotal,
    unallocated: r3(amount - allocTotal),
    completedOps: completed,
  };
}

/** مجموع المسدد لعملية (Σ تخصيصاتها) */
export async function opPaidTotal(opId: number): Promise<number> {
  const agg = await db.transferOpAlloc.aggregate({ where: { opId }, _sum: { amount: true } });
  return r3(Number(agg._sum.amount || 0));
}

/** تفاصيل تسديد + ما غطاه */
export async function transferDetail(tid: number): Promise<Record<string, unknown> | null> {
  const t = await db.otherCompanyTransfer.findUnique({ where: { id: tid } });
  if (!t) return null;
  const allocs = await db.transferOpAlloc.findMany({ where: { transferId: tid } });
  const opIds = allocs.map((a) => a.opId);
  const ops = opIds.length
    ? await db.gatewayOp.findMany({ where: { id: { in: opIds } } })
    : [];
  const opById = new Map(ops.map((o) => [o.id, o]));
  const fees = await gatewayFeeMap();
  const opsOut = ops.map((o) => {
    const gross = r3(Number(o.amount || 0));
    const alloc = r3(allocs.filter((a) => a.opId === o.id).reduce((s, a) => s + Number(a.amount || 0), 0));
    return {
      id: o.id,
      opDate: o.opDate,
      gateway: o.gateway,
      customer: o.customer || "",
      phone: o.phone || "",
      gross,
      net: r3(gross - (fees.get(o.gateway) || 0)),
      alloc,
    };
  });
  const groups = new Map<string, { date: string; n: number; gross: number; net: number; paid: number }>();
  for (const o of opsOut) {
    const g = groups.get(o.opDate) || { date: o.opDate, n: 0, gross: 0, net: 0, paid: 0 };
    g.n += 1;
    g.gross = r3(g.gross + o.gross);
    g.net = r3(g.net + o.net);
    g.paid = r3(g.paid + o.alloc);
    groups.set(o.opDate, g);
  }
  const dates = [...groups.keys()].sort();
  const allocTotal = r3(opsOut.reduce((s, o) => s + o.alloc, 0));
  return {
    transfer: {
      id: t.id,
      tdate: t.tdate,
      amount: r3(Number(t.amount || 0)),
      method: t.method || "",
      ref: t.ref || "",
      notes: t.notes || "",
      createdAt: t.createdAt,
    },
    ops: opsOut,
    groups: dates.map((d) => groups.get(d)),
    totals: {
      amount: r3(Number(t.amount || 0)),
      alloc: allocTotal,
      unalloc: r3(Number(t.amount || 0) - allocTotal),
      nOps: opsOut.length,
      dates,
      datesShort: dates.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join("، "),
    },
  };
}

/** حذف تسديد (إلغاء): يحذف توزيعاته ويعيد حساب اكتمال عملياته */
export async function deleteOtherTransfer(tid: number, username: string): Promise<{ deleted: boolean; touched: number }> {
  const t = await db.otherCompanyTransfer.findUnique({ where: { id: tid } });
  if (!t) throw new GatewayError("التسديد غير موجود.", 404);
  if ((t.voucherId || 0) > 0) {
    const v = await db.voucher.findUnique({ where: { id: t.voucherId }, select: { cancelled: true } });
    if (v && !v.cancelled)
      throw new GatewayError("مرتبط بسند صرف — ألغِ السند أولًا من السندات.");
  }
  const allocs = await db.transferOpAlloc.findMany({ where: { transferId: tid } });
  const touched = new Set<number>([...allocs.map((a) => a.opId)]);
  const flagged = await db.gatewayOp.findMany({ where: { paidTransferId: tid }, select: { id: true } });
  for (const f of flagged) touched.add(f.id);
  await db.transferOpAlloc.deleteMany({ where: { transferId: tid } });
  const fees = await gatewayFeeMap();
  for (const opId of touched) {
    const op = await db.gatewayOp.findUnique({ where: { id: opId } });
    if (!op) continue;
    const paid = await opPaidTotal(opId);
    const net = r3(Number(op.amount || 0) - (fees.get(op.gateway) || 0));
    if (paid >= net - 0.0005) {
      const last = await db.transferOpAlloc.findFirst({
        where: { opId },
        orderBy: [{ transferId: "desc" }],
        select: { transferId: true },
      });
      await db.gatewayOp.update({ where: { id: opId }, data: { paidTransferId: last?.transferId || 0 } });
    } else {
      await db.gatewayOp.update({ where: { id: opId }, data: { paidTransferId: 0 } });
    }
  }
  await db.otherCompanyTransfer.delete({ where: { id: tid } });
  await audit(db, {
    username,
    action: "other_transfer_delete",
    entityType: "other_company_transfer",
    entityId: tid,
    oldStatus: String(r3(Number(t.amount || 0))),
    newStatus: "deleted",
    reason: `حذف تسديد و${touched.size} عملية ماسة`,
  });
  return { deleted: true, touched: touched.size };
}

/** دفتر حساب الشركة الأخرى: افتتاحي + مستحق/مسدد برصيد جارٍ */
export async function otherLedger(dateFrom = "", dateTo = ""): Promise<Record<string, unknown>> {
  const op = await getOtherOpening();
  const today = todayStr();
  const d1 = dateFrom || "2000-01-01";
  const d2 = dateTo || today;
  const dayBefore = addDays(d1, -1);
  const priorDues = dayBefore ? await duesCumulative(dayBefore) : 0;
  const priorPaidAgg = dayBefore
    ? await db.otherCompanyTransfer.aggregate({ where: { tdate: { lte: dayBefore } }, _sum: { amount: true } })
    : null;
  const prior = r3(op.amount + priorDues - Number(priorPaidAgg?._sum.amount || 0));

  type Line = { date: string; kind: "due" | "pay"; text: string; gateway: string; day: string; plus: number; minus: number; tid: number; balance?: number };
  const lines: Line[] = [];
  for (const r of await otherStatement(d1, d2)) {
    lines.push({
      date: r.day,
      kind: "due",
      text: `مستحق تسوية يوم ${r.day} · ${r.gateway}`,
      gateway: r.gateway,
      day: r.day,
      plus: r.otherShare,
      minus: 0,
      tid: 0,
    });
  }
  const transfers = await db.otherCompanyTransfer.findMany({
    where: { tdate: { gte: d1, lte: d2 } },
    orderBy: [{ tdate: "asc" }, { id: "asc" }],
  });
  for (const t of transfers) {
    const bits = ["تسديد"];
    if (t.ref) bits.push(t.ref);
    if (t.method) bits.push(t.method);
    const allocs = await db.transferOpAlloc.findMany({ where: { transferId: t.id } });
    if (allocs.length) {
      const ids = allocs.map((a) => a.opId);
      const ops = await db.gatewayOp.findMany({
        where: { id: { in: ids } },
        select: { customer: true, phone: true, ref: true },
      });
      const names = ops.map(
        (o, i) =>
          `${(o.customer || o.phone || o.ref || "—").trim()} (${r3(Number(allocs[i]?.amount || 0)).toFixed(3)})`
      );
      bits.push(names.slice(0, 3).join(" + ") + (names.length > 3 ? ` +${names.length - 3}` : ""));
    }
    lines.push({
      date: t.tdate,
      kind: "pay",
      text: bits.join(" · "),
      gateway: "",
      day: "",
      plus: 0,
      minus: r3(Number(t.amount || 0)),
      tid: t.id,
    });
  }
  lines.sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? a.tid - b.tid : a.kind === "due" ? -1 : 1) : a.date < b.date ? -1 : 1));
  let run = prior;
  for (const x of lines) {
    run = r3(run + x.plus - x.minus);
    x.balance = run;
  }
  return {
    opening: op,
    prior,
    lines,
    totalPlus: r3(lines.reduce((s, x) => s + x.plus, 0)),
    totalMinus: r3(lines.reduce((s, x) => s + x.minus, 0)),
    end: run,
  };
}

/** تسوية يومية للشركة الأخرى: لكل يوم مستحق/مسدد/متبقي + التحويلات */
export async function otherDailySettlement(dateFrom = "", dateTo = ""): Promise<Record<string, unknown>> {
  const d1 = dateFrom || "2000-01-01";
  const d2 = dateTo || todayStr();
  const ops = await db.gatewayOp.findMany({
    where: { ...DUES_ELIGIBLE, opDate: { gte: d1, lte: d2 } },
    orderBy: [{ opDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      gateway: true,
      opDate: true,
      customer: true,
      phone: true,
      ref: true,
      amount: true,
    },
  });
  const allocAgg = await db.transferOpAlloc.groupBy({ by: ["opId"], _sum: { amount: true } });
  const paidByOp = new Map(allocAgg.map((a) => [a.opId, r3(Number(a._sum.amount || 0))]));
  const fees = await gatewayFeeMap();
  const days: Record<string, unknown>[] = [];
  const byDay = new Map<string, Record<string, unknown>>();
  for (const o of ops) {
    const day = o.opDate || "";
    const gross = r3(Number(o.amount || 0));
    const fee = r3(fees.get(o.gateway) || 0);
    const net = r3(gross - fee);
    const paid = paidByOp.get(o.id) || 0;
    const remaining = r3(net - paid);
    const st = remaining <= 0.0005 ? "paid" : paid > 0.0005 ? "partial" : "unpaid";
    const d = byDay.get(day) as { ops: unknown[]; day: string } | undefined;
    const opRow = {
      id: o.id,
      customer: o.customer || "",
      phone: o.phone || "",
      ref: o.ref || "",
      gateway: o.gateway,
      gross,
      fee,
      net,
      paid,
      remaining,
      pay_status: st,
    };
    if (!d) {
      const nd = { day, ops: [opRow], n: 1, gross, fees: fee, net, paid, remaining, status: st };
      byDay.set(day, nd);
      days.push(nd);
    } else {
      (d.ops as unknown[]).push(opRow);
    }
  }
  let totals = { n: 0, gross: 0, fees: 0, net: 0, paid: 0, remaining: 0 };
  for (const d of days) {
    const opList = d.ops as Record<string, number | string>[];
    d.n = opList.length;
    d.gross = r3(opList.reduce((s, o) => s + Number(o.gross || 0), 0));
    d.fees = r3(opList.reduce((s, o) => s + Number(o.fee || 0), 0));
    d.net = r3(opList.reduce((s, o) => s + Number(o.net || 0), 0));
    d.paid = r3(opList.reduce((s, o) => s + Number(o.paid || 0), 0));
    d.remaining = r3(Number(d.net) - Number(d.paid));
    d.status = Number(d.remaining) <= 0.0005 ? "paid" : Number(d.paid) > 0.0005 ? "partial" : "unpaid";
    totals.n += Number(d.n);
    totals.gross = r3(totals.gross + Number(d.gross));
    totals.fees = r3(totals.fees + Number(d.fees));
    totals.net = r3(totals.net + Number(d.net));
    totals.paid = r3(totals.paid + Number(d.paid));
  }
  totals.remaining = r3(totals.net - totals.paid);
  const transfers = await db.otherCompanyTransfer.findMany({
    where: { tdate: { gte: d1, lte: d2 } },
    orderBy: [{ tdate: "asc" }, { id: "asc" }],
  });
  const transfersTotal = r3(transfers.reduce((s, t) => s + Number(t.amount || 0), 0));
  return {
    days,
    totals,
    transfers: transfers.map((t) => ({
      id: t.id,
      tdate: t.tdate,
      amount: r3(Number(t.amount || 0)),
      method: t.method || "",
      ref: t.ref || "",
      notes: t.notes || "",
    })),
    transfersTotal,
  };
}

// ==================== المسح الشامل ====================

/** مسح شامل: كل عمليات كل البوابات + التسديدات + تخصيصاتها + كشف البنك (المدير بتأكيد نصي) */
export async function wipeGatewayData(username: string): Promise<Record<string, number>> {
  const [ops, transfers, bankLines, allocs, feeLinks] = await Promise.all([
    db.gatewayOp.count(),
    db.otherCompanyTransfer.count(),
    db.bankLine.count(),
    db.transferOpAlloc.count(),
    db.gatewayFeeVoucher.count(),
  ]);
  await db.$transaction([
    db.gatewayFeeVoucher.deleteMany(),
    db.transferOpAlloc.deleteMany(),
    db.otherCompanyTransfer.deleteMany(),
    db.gatewayOp.deleteMany(),
    db.bankLine.deleteMany(),
  ]);
  await audit(db, {
    username,
    action: "gateway_wipe",
    entityType: "gateway_ops",
    newStatus: "wiped",
    reason: `عمليات ${ops} · تسديدات ${transfers} · بنك ${bankLines} · تخصيصات ${allocs}`,
  });
  return { ops, transfers, bankLines, allocs, feeLinks };
}

// ============================================================
// G1 — كشف الرصيد الجاري اليومي للشركة الأخرى (المكتبي other_running_statement)
// النواة النقية تعيش في other-running-core.ts (قابلة للاختبار المباشر) — هنا إعادة تصدير + طبقة القاعدة
// ============================================================

export type { RunningOpRow, RunningStatementCore, RunningStatementResult } from "./other-running-core";
export { computeRunningStatement, netInByDay, sumByDay };

/** داخل كل يوم من كل البوابات معًا — استعلام صفوف DUES_ELIGIBLE للفترة */
async function otherInRows(d1: string, d2: string): Promise<RunningOpRow[]> {
  const rows = await db.gatewayOp.findMany({
    where: { ...DUES_ELIGIBLE, opDate: { gte: d1, lte: d2 } },
    select: { opDate: true, gateway: true, amount: true },
  });
  return rows.map((r) => ({ opDate: r.opDate, gateway: r.gateway, amount: Number(r.amount || 0) }));
}

/**
 * كشف يومي بالرصيد الجاري للشركة الأخرى — لأي فترة، من كل البوابات معًا.
 * الافتتاحي يُعرض كما هو مخزّن (بلا تصحيح) — مطابق للمكتبي حرفيًا.
 * النهاية = الرصيد الجاري آخر الفترة (يساوي المتبقي عند date_to حقيقي).
 */
export async function otherRunningStatement(dateFrom = "", dateTo = ""): Promise<Record<string, unknown>> {
  const opening = await getOtherOpening();
  const d1 = dateFrom || "2000-01-01";
  const d2 = dateTo || todayStr();

  // داخل وخارج كل التاريخ حتى نهاية الفترة (قبل d1 يُجمَع في السابق داخل النواة)
  const inRows = await otherInRows("2000-01-01", d2);
  const fees = await gatewayFeeMap();
  const inByDay = netInByDay(inRows, fees);

  const transferRows = await db.otherCompanyTransfer.findMany({
    where: { tdate: { lte: d2 } },
    orderBy: [{ tdate: "asc" }, { id: "asc" }],
    select: { id: true, tdate: true, amount: true, ref: true, method: true },
  });
  const outByDay = sumByDay(transferRows.map((t) => ({ day: t.tdate, amount: Number(t.amount || 0) })));

  const core = computeRunningStatement({ openingAmount: opening.amount, d1, inByDay, outByDay });
  const transfers = transferRows.filter((t) => t.tdate >= d1);

  return {
    opening: opening.amount,
    prior: core.prior,
    days: core.days,
    totalIn: core.totalIn,
    totalOut: core.totalOut,
    end: core.end,
    transfers,
  };
}
