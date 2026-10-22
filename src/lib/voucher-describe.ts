import type { Prisma, PrismaClient } from "@prisma/client";
import { isSupervision, type ComputedPlanLine, type ReceiptLike } from "@/lib/contrack-core";
import type { ContractCore } from "@/lib/contrack-server";

/**
 * محرّك «البيان التلقائي» — ترحيل أمين للنسخة المكتبية (V9.15.18 + بنود V9.15.19):
 * - extras_service.smart_receipt_description (صيغ ق1–ق12 + ق9–ق11 بلا خطة)
 * - supervision_service.supervision_receipt_description (عقود الإشراف — القرار 5/ب)
 * - extras_service.smart_receipt_stage_note (ملاحظة «مرحلة العمل: …»)
 * - voucher_payment_link_service.describe_items/_alloc_core/_PART_ORD (صياغة الدفعات)
 * - voucher_payment_link_service._ordinal_i (V9.15.19: «الدفعة الأولى…العاشرة» ثم «الدفعة رقم 11»)
 * - voucher_payment_link_service.partial_tail (V9.15.19: « ومتبقي منها X د.ك» للدفع الجزئي)
 * - extras_service.allocated_description (القبض المخصّص لأمر تغييري/عقد إضافي)
 * - extras_service.apply_description_prefix (بادئات الإعدادات + إزالة تكرار «سداد»)
 * القاعدة: البيان المكتوب يدويًا لا يُستبدل — التعبئة فقط عندما يُرسل الحقل فارغًا (V6.1/V9.15.2).
 */

type DbLike = PrismaClient | Prisma.TransactionClient;

const EPS = 0.0005;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt3 = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const PART_ORD = ["", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
const GENERIC_NAMES = ["", "غير محدد"];

export type PrefixKind = "receipt" | "supervision" | "transfer" | "custody" | "stage_note";

const PREFIX_FIELDS: Record<PrefixKind, string> = {
  receipt: "descPrefixReceipt",
  supervision: "descPrefixSupervision",
  transfer: "descPrefixTransfer",
  custody: "descPrefixCustody",
  stage_note: "descPrefixStageNote",
};

/** بادئة البيان من الإعدادات (تُنزع «:» الزائدة) — فارغة = النص كما هو */
export async function applyDescriptionPrefix(db: DbLike, kind: PrefixKind, text: string): Promise<string> {
  if (!text) return text;
  const field = PREFIX_FIELDS[kind];
  if (!field) return text;
  // Task 85: بلا فلترة يدوية — العميل الوارد (ملّاف) يحمل سياق الشركة بنفسه
  const s = await db.setting.findFirst({});
  const raw = s ? String((s as unknown as Record<string, unknown>)[field] ?? "") : "";
  const prefix = raw.trim().replace(/[:：]+\s*$/, "").trim();
  // V9.15.19: إذا احتوت البادئة «سداد» وبدأ النص بـ«سداد » يُحذف من النص (منع التكرار)
  let body = text;
  if (prefix.includes("سداد") && body.startsWith("سداد ")) body = body.slice("سداد ".length);
  return prefix ? `${prefix}: ${body}` : text;
}

/** اسم العقد للبيان فقط (بلا رقم ولا مبلغ) — الاسم العام يُستبدل بالوصف ثم بالرقم */
export function contractDisplayName(c: { contractName: string; description: string; contractNumber: string }): string {
  let name = (c.contractName || "").trim();
  if (GENERIC_NAMES.includes(name)) name = (c.description || "").trim();
  return name || (c.contractNumber || "").trim();
}

/** ذيل البيان: «— عقد {الاسم}» وإن بدأ الاسم بكلمة «عقد» فلا تتكرر */
export function contractTail(name: string): string {
  const n = (name || "").trim();
  if (!n) return "";
  return n.startsWith("عقد") ? ` — ${n}` : ` — عقد ${n}`;
}

/** الترقيم الترتيبي — مرآة _ordinal_i: «الأولى…العاشرة» ثم «رقم 11» وما بعدها (V9.15.19) */
const ORDINAL_I_WORDS = [
  "الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة",
  "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة",
];
export function ordinalI(n: number): string {
  const i = Math.trunc(Number(n) || 0);
  return i >= 1 && i <= ORDINAL_I_WORDS.length ? ORDINAL_I_WORDS[i - 1] : `رقم ${i}`;
}

/** ذيل الدفع الجزئي — مرآة partial_tail: « ومتبقي منها {X:,.3f} د.ك» (المتبقي فقط بعد السند) */
export function partialTail(remainingAfter: number): string {
  const x = Number(remainingAfter) || 0;
  return x > 0.001 ? ` ومتبقي منها ${fmt3(x)} د.ك` : "";
}

/** أسماء مراحل العقد (لصيغة «وهي عن أعمال …») */
export async function stageNameMap(db: DbLike, contractId: number): Promise<Map<number, string>> {
  const rows = await db.contractStage.findMany({ where: { contractId }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface DescribeItem {
  /** رقم الدفعة في ترتيب الخطة (١-أساس) */
  number?: number;
  stage?: string;
  title?: string;
  full: boolean;
  continuation?: boolean;
  part_ordinal?: string | null;
  /** المتبقي على الخط قبل هذا السند والمبلغ المسحوب منه — لذيل الدفع الجزئي (V9.15.19) */
  remaining?: number;
  amount?: number;
  /** نص جاهز (لأوامر التغيير) يُستخدم كما هو */
  core?: string;
}

function allocCore(a: DescribeItem): string {
  if (a.core) return a.core;
  const stage = (a.stage || "").trim();
  const ord = ordinalI(Number(a.number) || 0);
  let t = stage ? `الدفعة ${ord} وهي عن أعمال ${stage}` : `الدفعة ${ord}`;
  if (!a.full) t = a.part_ordinal ? `الجزء ${a.part_ordinal} من ${t}` : `جزء من ${t}`;
  // V9.15.19: ذيل المتبقي للدفع الجزئي — عند وجود remaining وamount
  if (a.remaining !== undefined && a.amount !== undefined) {
    t += partialTail(r3(Number(a.remaining) - Number(a.amount)));
  }
  return t;
}

/** بيَن قصير من بنود التوزيع — بلا مبالغ ولا مقاول ولا رقم عقد (مرآة describe_items) */
export function describeItems(allocs: DescribeItem[], advance = 0, contractName = ""): string {
  const list = allocs || [];
  const cores = list.map(allocCore);
  let head: string;
  if (!cores.length) {
    head = "سداد على الحساب";
    if (advance > 0.0005) head += " وزيادة مقدمة";
  } else {
    const singleCont = list.length === 1 && list[0].continuation && list[0].full;
    head = (singleCont ? "استكمال " : "سداد ") + cores[0];
    head += cores.slice(1).map((c) => " و" + c).join("");
    if (advance > 0.0005) head += " وزيادة مقدمة";
  }
  return head + contractTail(contractName);
}

/** كم سندًا ساريًا سابقًا ربط هذه الخطوط (لترتيب «الجزء الثاني»…) — مرآة _prev_link_count */
export async function prevLinkCounts(
  db: DbLike,
  lineIds: number[],
  kind: "receipt" | "payment",
  excludeVoucherId?: number
): Promise<Map<number, number>> {
  if (!lineIds.length) return new Map();
  const rows = await db.voucherPaymentLink.findMany({
    where: {
      kind,
      lineId: { in: lineIds },
      voucherId: excludeVoucherId ? { not: excludeVoucherId } : undefined,
      voucher: { cancelled: false },
    },
    select: { lineId: true, voucherId: true },
  });
  const sets = new Map<number, Set<number>>();
  for (const r of rows) {
    const s = sets.get(r.lineId) ?? new Set<number>();
    s.add(r.voucherId);
    sets.set(r.lineId, s);
  }
  return new Map([...sets].map(([k, s]) => [k, s.size]));
}

/** مرآة _parts_paid_count: كم سند قبض سابقًا سارٍ (بلا تخصيص) غطى جزءًا من الشريحة [pStart,pEnd)؟ */
async function partsPaidCount(receipts: ReceiptLike[], pStart: number, pEnd: number): Promise<number> {
  const rows = [...receipts]
    .filter((r) => !(r.allocation || "").trim())
    .sort((a, b) => (a.vdate < b.vdate ? -1 : a.vdate > b.vdate ? 1 : a.id - b.id));
  let count = 0;
  let running = 0;
  for (const r of rows) {
    const vStart = running;
    const vEnd = running + Number(r.amount || 0);
    if (vEnd > pStart + 0.001 && vStart < pEnd - 0.001) count += 1;
    running = vEnd;
  }
  return count;
}

// ==================== الإشراف الهندسي ====================

function monthsCount(take: number, monthly: number): number {
  if (!monthly || take <= 0.001) return 0;
  const n = take / monthly;
  return Math.abs(n - Math.round(n)) < 0.01 && n >= 1 ? Math.round(n) : 0;
}

/** بيان سند قبض على عقد إشراف — الأشهر الصحيحة تُذكر وجزء الشهر يُذكر بمتبقيه (القرار 5/ب) */
export async function supervisionReceiptDescription(db: DbLike, core: NonNullable<ContractCore>, amount: number): Promise<string> {
  const st = core.sup;
  if (!st || amount <= 0) return "";
  const cName = contractDisplayName(core.contract);
  const monthly = Number(core.contract.supMonthly);
  let collected = st.collected;
  const base = st.baseValue;
  const parts: string[] = [];
  let remaining = amount;

  // 1) المدة الأساسية
  if (collected < base - 0.001 && remaining > 0.001) {
    const baseLeft = base - collected;
    const take = Math.min(remaining, baseLeft);
    const after = collected + take;
    const leftAfter = base - after;
    if (after >= base - 0.001) {
      parts.push(collected > 0.001 ? "استكمال قيمة عقد الإشراف" : "سداد قيمة عقد الإشراف كاملة");
    } else {
      const m = monthsCount(take, monthly);
      if (m) {
        const mt = m === 1 ? "شهر واحد" : m === 2 ? "شهرين" : `${m} أشهر`;
        parts.push(`سداد ${mt} من عقد الإشراف`);
      } else {
        parts.push(`سداد جزء من قيمة عقد الإشراف والمتبقي منها ${fmt3(Math.max(0, leftAfter))}`);
      }
    }
    remaining -= take;
    collected += take;
  }

  // 2) أشهر التمديد
  if (remaining > 0.001 && st.extensionValue > 0.001) {
    const extCovered = Math.max(0, collected - base);
    const extLeft = st.extensionValue - extCovered;
    const take = extLeft > 0.001 ? Math.min(remaining, extLeft) : 0;
    if (take > 0.001) {
      const m = monthsCount(take, monthly);
      if (m) {
        const mt = m === 1 ? "شهر تمديد واحد" : m === 2 ? "شهري تمديد" : `${m} أشهر تمديد`;
        parts.push(`سداد ${mt}`);
      } else {
        parts.push(`سداد جزء من أشهر التمديد والمتبقي منها ${fmt3(Math.max(0, extLeft - take))}`);
      }
      remaining -= take;
    }
  }

  let head = parts.length ? parts.join(" و") : "سداد على الحساب";
  if (remaining > 0.001 && parts.length) head += " وزيادة مقدمة";
  return applyDescriptionPrefix(db, "supervision", head + contractTail(cName));
}

// ==================== سند القبض الذكي ====================

interface Segment {
  number?: number;
  stage?: string;
  amount: number;
  addendum?: boolean;
  label?: string;
}

/** بيَن سند القبض: توزيع المبلغ على الدفعات بالترتيب ثم أوامر التغيير المعتمدة (مرآة smart_receipt_description) */
export async function smartReceiptDescription(db: DbLike, core: NonNullable<ContractCore>, amount: number): Promise<string> {
  if (!core || amount <= 0) return "";
  const contract = core.contract;
  const supC = {
    supStartDate: contract.supStartDate,
    supMonths: contract.supMonths,
    supMonthly: Number(contract.supMonthly),
    supDiscount: Number(contract.supDiscount),
    supWaivedMonths: Number(contract.supWaivedMonths),
  };
  if (isSupervision(supC) && core.sup) return supervisionReceiptDescription(db, core, amount);

  const cName = contractDisplayName(contract);
  const collectedBefore = core.computed.collected; // البركة: قبض سارٍ بلا تخصيص
  const value = core.current;
  const lines = core.computed.lines; // مرتبة (dueDate, sortOrder)
  const planTotal = r3(lines.reduce((s, l) => s + l.amountN, 0));
  const stageNames = await stageNameMap(db, contract.id);

  const segments: Segment[] = lines.map((l, i) => ({
    number: i + 1,
    stage: l.stageId ? stageNames.get(l.stageId) || "" : "",
    amount: l.amountN,
  }));

  // الشرائح القابلة للسداد بالترتيب: الدفعات ثم أوامر التغيير المعتمدة (ق8)
  if (value > planTotal + 0.001) {
    const [addendums, allocRows] = await Promise.all([
      db.addendum.findMany({
        where: { contractId: contract.id, status: "معتمد" },
        orderBy: { id: "asc" },
        select: { addendumNumber: true, addendumType: true, reason: true, amountAdd: true, amountDeduct: true },
      }),
      db.voucher.groupBy({
        by: ["allocation"],
        where: { contractId: contract.id, vtype: "receipt", cancelled: false, allocation: { not: "" } },
        _sum: { amount: true },
      }),
    ]);
    const allocatedMap = new Map(allocRows.map((r) => [r.allocation, Number(r._sum.amount || 0)]));
    let extraNeeded = value - planTotal;
    for (const a of addendums) {
      let net = Number(a.amountAdd) - Number(a.amountDeduct);
      net -= allocatedMap.get(a.addendumNumber) ?? 0;
      if (net <= 0.001 || extraNeeded <= 0.001) continue;
      const take = Math.min(net, extraNeeded);
      const baseT = (a.addendumType || "أمر تغييري") === "عقد إضافي" ? "العقد الإضافي" : "الأمر التغييري";
      const reason = (a.reason || "").trim();
      const label = reason ? `${baseT} ${a.addendumNumber} (${reason})` : `${baseT} ${a.addendumNumber}`;
      segments.push({ addendum: true, label, amount: take });
      extraNeeded -= take;
    }
  }

  // ق9–ق11: عقد بلا خطة
  if (!segments.length) {
    let head: string;
    if (Math.abs(collectedBefore + amount - value) < 0.001) head = "سداد كامل قيمة العقد";
    else if (collectedBefore < 0.001) head = "سداد دفعة أولى";
    else head = "سداد على الحساب";
    if (value > 0.001 && collectedBefore + amount > value + 0.001) head += " وزيادة مقدمة"; // ق7
    return applyDescriptionPrefix(db, "receipt", head + contractTail(cName));
  }

  // توزيع المبلغ الجديد على الشرائح بعد ما سُدِّد
  const items: DescribeItem[] = [];
  let remaining = amount;
  let cursor = collectedBefore;
  let pStart = 0;
  for (const seg of segments) {
    const segAmt = seg.amount;
    const pEnd = pStart + segAmt;
    if (cursor >= pEnd - 0.001 || remaining <= 0.001) {
      pStart = pEnd;
      continue;
    }
    const coverFrom = Math.max(cursor, pStart);
    const cover = Math.min(remaining, pEnd - coverFrom);
    const after = coverFrom - pStart + cover;
    const full = after >= segAmt - 0.001;
    const cont = Boolean(full && coverFrom > pStart + 0.001);
    if (seg.addendum) {
      items.push({ core: full ? seg.label! : `جزء من ${seg.label}`, full, continuation: cont });
    } else {
      const prev = full ? 0 : await partsPaidCount(core.receipts, pStart, pEnd);
      const ordinal = !full && prev > 0 && prev < PART_ORD.length ? PART_ORD[prev] : null;
      items.push({
        number: seg.number, stage: seg.stage, full, continuation: cont, part_ordinal: ordinal,
        remaining: r3(segAmt - (coverFrom - pStart)), amount: r3(cover),
      });
    }
    remaining -= cover;
    cursor = pStart + after;
    pStart = pEnd;
  }
  const advance = remaining > 0.001 ? remaining : 0;
  return applyDescriptionPrefix(db, "receipt", describeItems(items, advance, cName));
}

/** ملاحظة سند القبض التلقائية: مراحل العمل التي يغطيها السداد (مرآة smart_receipt_stage_note) */
export async function smartReceiptStageNote(db: DbLike, core: NonNullable<ContractCore>, amount: number): Promise<string> {
  if (!core || amount <= 0) return "";
  const stageNames = await stageNameMap(db, core.contract.id);
  let cursor = core.computed.collected;
  let remaining = amount;
  let pStart = 0;
  const names: string[] = [];
  for (const item of core.computed.lines) {
    const pEnd = pStart + item.amountN;
    if (cursor >= pEnd - 0.001 || remaining <= 0.001) {
      pStart = pEnd;
      continue;
    }
    const coverFrom = Math.max(cursor, pStart);
    const cover = Math.min(remaining, pEnd - coverFrom);
    if (cover > 0.001) {
      const sname = item.stageId ? stageNames.get(item.stageId) || "" : "";
      if (sname && !names.includes(sname)) names.push(sname);
    }
    remaining -= cover;
    cursor = coverFrom + cover;
    pStart = pEnd;
  }
  if (names.length) return applyDescriptionPrefix(db, "stage_note", "مرحلة العمل: " + names.join(" + "));
  return "";
}

// ==================== القبض المخصّص لعقد إضافي/أمر تغييري ====================

/**
 * بيان سند قبض مخصّص لعقد إضافي/أمر تغييري — مرآة allocated_description + allocation_options.
 * ق8: «سداد الأمر التغييري ADD-001 (السبب)» · الجزئي: «سداد جزء من…» / «سداد الجزء الثاني من…»
 * والاستكمال: «استكمال…» — والغير معروف: «سداد مقابل بند إضافي».
 */
export async function allocatedDescription(
  db: DbLike,
  contractId: number,
  amount: number,
  allocation: string,
  contractName: string,
  excludeVoucherId?: number
): Promise<string> {
  const alloc = (allocation || "").trim();
  const [addendums, allocRows] = await Promise.all([
    db.addendum.findMany({
      where: { contractId, status: "معتمد" },
      orderBy: { id: "asc" },
      select: { addendumNumber: true, addendumType: true, reason: true, amountAdd: true, amountDeduct: true },
    }),
    db.voucher.groupBy({
      by: ["allocation"],
      where: {
        contractId, vtype: "receipt", cancelled: false, allocation: { not: "" },
        ...(excludeVoucherId ? { id: { not: excludeVoucherId } } : {}),
      },
      _sum: { amount: true },
    }),
  ]);
  const allocatedMap = new Map(allocRows.map((r) => [r.allocation, Number(r._sum.amount || 0)]));
  const opt = addendums
    .map((a) => {
      const net = Number(a.amountAdd) - Number(a.amountDeduct);
      const baseT = (a.addendumType || "أمر تغييري") === "عقد إضافي" ? "العقد الإضافي" : "الأمر التغييري";
      const reason = (a.reason || "").trim();
      const label = reason ? `${baseT} ${a.addendumNumber} (${reason})` : `${baseT} ${a.addendumNumber}`;
      return { number: a.addendumNumber, label, amount: net, paid: allocatedMap.get(a.addendumNumber) ?? 0 };
    })
    .filter((o) => o.amount > 0.001)
    .find((o) => o.number === alloc);
  if (!opt) {
    return applyDescriptionPrefix(db, "receipt", "سداد مقابل بند إضافي" + contractTail(contractName));
  }
  const after = opt.paid + amount;
  let head: string;
  if (Math.abs(after - opt.amount) < 0.001) {
    head = opt.paid > 0.001 ? `استكمال ${opt.label}` : `سداد ${opt.label}`;
  } else {
    const prev = await db.voucher.count({
      where: {
        contractId, vtype: "receipt", cancelled: false, allocation: alloc,
        ...(excludeVoucherId ? { id: { not: excludeVoucherId } } : {}),
      },
    });
    head = prev === 0 ? `سداد جزء من ${opt.label}`
      : prev > 0 && prev < PART_ORD.length ? `سداد الجزء ${PART_ORD[prev]} من ${opt.label}`
      : `سداد جزء من ${opt.label}`;
  }
  return applyDescriptionPrefix(db, "receipt", head + contractTail(contractName));
}

// ==================== الروابط الصريحة (قبض/صرف مربوط بدفعات) ====================

/**
 * بيَن من توزيع الروابط الصريحة ثم الفائض على المستحقة التالية متخطيًا الموقوفة —
 * خوارزمية مطابقة لـapplyLinks حتى يتطابق البيان مع ما يُكتب فعليًا في voucher_payment_links.
 * تعيد النص وأسماء المراحل المغطاة (لملاحظة «مرحلة العمل»).
 */
export async function describeForLinks(
  db: DbLike,
  amount: number,
  explicitLinks: { lineId: number; amount: number }[] | null,
  lines: ComputedPlanLine[],
  gatedIds: Set<number>,
  kind: "receipt" | "payment",
  contractName: string,
  stageNames: Map<number, string>,
  excludeVoucherId?: number
): Promise<{ text: string; stages: string[] }> {
  const room = new Map<number, number>();
  for (const l of lines) room.set(l.id, Math.max(0, Math.min(r3(l.amountN - l.explicit), l.remaining)));
  const takes = new Map<number, number>();
  let left = r3(amount);
  const take = (lineId: number, want: number) => {
    const rm = room.get(lineId) ?? 0;
    const t = r3(Math.min(want, rm));
    if (t > EPS) {
      room.set(lineId, r3(rm - t));
      takes.set(lineId, r3((takes.get(lineId) || 0) + t));
      left = r3(left - t);
    }
  };
  // 1) المحدد صراحة
  for (const req of explicitLinks || []) take(req.lineId, Number(req.amount) || 0);
  // 2) الفائض spread على المستحقة التالية متخطيًا الموقوفة بالبوابة
  if (left > EPS) {
    for (const line of lines) {
      if (left <= EPS) break;
      if (gatedIds.has(line.id)) continue;
      if (!(line.remaining > EPS)) continue;
      take(line.id, left);
    }
  }
  if (!takes.size)
    return { text: describeItems([], Math.max(0, left), contractName), stages: [] };

  const prevs = await prevLinkCounts(db, [...takes.keys()], kind, excludeVoucherId);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const numberById = new Map(lines.map((l, i) => [l.id, i + 1]));
  const items: DescribeItem[] = [];
  const stages: string[] = [];
  for (const [lineId, amt] of takes) {
    const line = byId.get(lineId)!;
    const rem = Math.max(0, Math.min(r3(line.amountN - line.explicit), line.remaining));
    const full = amt >= rem - 0.0005;
    const prev = prevs.get(lineId) ?? 0;
    const stage = line.stageId ? stageNames.get(line.stageId) || "" : "";
    if (stage && !stages.includes(stage)) stages.push(stage);
    items.push({
      number: numberById.get(lineId),
      stage,
      title: line.title,
      full,
      continuation: Boolean(full && prev > 0),
      part_ordinal: !full && prev > 0 && prev < PART_ORD.length ? PART_ORD[prev] : null,
      remaining: rem,
      amount: amt,
    });
  }
  const advance = Math.max(0, left);
  return { text: describeItems(items, advance, contractName), stages };
}
