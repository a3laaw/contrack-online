import "server-only";
/**
 * منفذ الاستيراد الفعلي — مرآة execute_import (import_service.py:933-1155):
 * إدخال البيانات المفحوصة بترتيب التبعية (عملاء ← عقود ← إشراف ← مقاولون ←
 * قبض ← باطن ← صرف)، مع تخطي الموجود بدل إيقاف الرفع، وتسجيل تجاوز المتبقي
 * كدفعة مقدمة (للتقرير لا للمنع). كل صف يُدخل داخل معاملة واحدة (transactions)
 * بنمط مسارات الويب، والسندات عبر createVoucher (قيود/رسوم/أحداث كالشاشات).
 * تنفيذ ما اختاره المستخدم: selected = أسماء أوراق الحاضرة المختارة (null = الكل).
 */

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { audit } from "@/lib/api-utils";
import { loadContractCore, nextNumberByKey } from "@/lib/contrack-server";
import { createVoucher, VoucherError } from "@/lib/voucher-server";

import { fmt3, nameKey } from "./normalize";
import type { ParseResult } from "./parse-core";

export class ImportRunError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export interface ImportRunStats {
  customers: number;
  contracts: number;
  sup_contracts: number;
  subs: number;
  payments: number;
  sub_contracts: number;
  expenses: number;
  skipped_customers: number;
  skipped_contracts: number;
  skipped_subs: number;
  skipped_payments: number;
  skipped_expenses: number;
  /** سندات تجاوزت المتبقي وسُجّلت كدفعة مقدمة (للمراجعة بعد الرفع) */
  overpaid: string[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const contractFallback = (amount: number) => `عقد بقيمة ${Number.isInteger(amount) ? `${amount}.0` : amount}`;
const supFallback = (monthly: number, months: number) =>
  `إشراف ${Number.isInteger(monthly) ? `${monthly}.0` : monthly}x${months}`;

export async function executeImport(
  parsed: ParseResult,
  selected: string[] | null,
  user: { id: number; username: string; role: string }
): Promise<ImportRunStats> {
  const inScope = (sheet: string): boolean => !selected || selected.includes(sheet);
  const scopeErrors = parsed.errors.filter((e) => inScope(e.sheet));
  if (scopeErrors.length) {
    throw new ImportRunError("لا يمكن الاستيراد · يوجد أخطاء لم تُصحح.", 400);
  }
  const data = parsed.data;
  const stats: ImportRunStats = {
    customers: 0,
    contracts: 0,
    sup_contracts: 0,
    subs: 0,
    payments: 0,
    sub_contracts: 0,
    expenses: 0,
    skipped_customers: 0,
    skipped_contracts: 0,
    skipped_subs: 0,
    skipped_payments: 0,
    skipped_expenses: 0,
    overpaid: [],
  };

  // ===== العملاء (:949-967) =====
  const existingNorm = new Map<string, { name: string; id: number }>();
  for (const c of await db.customer.findMany({ select: { id: true, name: true } })) {
    if ((c.name || "").trim()) existingNorm.set(nameKey(c.name), { name: c.name, id: c.id });
  }
  const customerIds = new Map<string, number>();
  for (const row of data.customers) {
    if (!inScope("العملاء")) break;
    const found = existingNorm.get(nameKey(row.name));
    if (found) {
      customerIds.set(row.name, found.id);
      customerIds.set(found.name, found.id);
      stats.skipped_customers += 1;
      continue;
    }
    const notes = (row.notes ? `${row.notes} ` : "") + "[مستورد]";
    try {
      const created = await db.$transaction(async (tx) => {
        const code = await nextNumberByKey("customer:code", "C", 4, tx);
        const c = await tx.customer.create({
          data: {
            customerCode: code,
            name: row.name,
            phone: row.phone,
            address: row.address,
            email: row.email,
            notes,
          },
        });
        await audit(tx, {
          username: user.username,
          action: "إنشاء",
          entityType: "customer",
          entityId: c.id,
          entityName: c.name,
          reason: "استيراد من البيانات القديمة",
        });
        return c;
      });
      customerIds.set(row.name, created.id);
      existingNorm.set(nameKey(row.name), { name: row.name, id: created.id });
      stats.customers += 1;
    } catch (e) {
      throw new ImportRunError(`توقف الاستيراد عند إدخال العميل «${row.name}»: ${errMsg(e)}`);
    }
  }

  // ===== العقود (:969-1015) =====
  // فهرس الأزواج (عميل، تسمية) — التسميات: الاسم/الوصف/الرقم للقائمة، واسم الملف للجديدة
  const pairIndex = new Map<string, number>(); // nameKey(عميل)|nameKey(تسمية) ← id
  for (const r of await db.contract.findMany({
    where: { status: { not: "ملغى" } },
    select: {
      id: true,
      contractName: true,
      description: true,
      contractNumber: true,
      customer: { select: { name: true } },
    },
  })) {
    const cname = r.customer?.name ?? "";
    if (!(cname || "").trim()) continue;
    for (const label of [r.contractName, r.description, r.contractNumber]) {
      if ((label || "").trim()) pairIndex.set(`${nameKey(cname)}|${nameKey(label)}`, r.id);
    }
  }
  const findExistingContract = (cname: string, labels: string[]): number | null => {
    const ck = nameKey(cname);
    for (const label of labels) {
      if (!label) continue;
      const id = pairIndex.get(`${ck}|${nameKey(label)}`);
      if (id) return id;
    }
    return null;
  };
  const registerContract = (cname: string, labels: string[], id: number) => {
    const ck = nameKey(cname);
    for (const label of labels) {
      if (label) pairIndex.set(`${ck}|${nameKey(label)}`, id);
    }
  };

  const createContractRow = async (row: {
    customer_name: string;
    title: string;
    amount: number;
    contract_date: string;
    start_date?: string;
    end_date?: string;
    status: string;
    contract_type?: string;
    notes?: string;
    sup?: { sup_start: string; months: number; monthly: number };
    eventDescription: string;
  }): Promise<number> => {
    const cid = customerIds.get(row.customer_name);
    if (!cid) throw new ImportRunError(`تعذر إيجاد معرف العميل «${row.customer_name}» وقت الإدخال.`);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await db.$transaction(async (tx) => {
          const contractNumber = await nextNumberByKey("contract:number", "CON", 4, tx);
          const contract = await tx.contract.create({
            data: {
              contractNumber,
              contractName: row.title || "عقد مستورد",
              customerId: cid,
              contractDate: row.contract_date,
              amount: r3(row.amount),
              notes: row.notes ?? "[مستورد]",
              contractType: row.contract_type ?? "غير محدد",
              startDate: row.start_date ?? "",
              endDate: row.end_date ?? "",
              status: row.status || "نشط",
              ...(row.sup
                ? {
                    supStartDate: row.sup.sup_start,
                    supMonths: row.sup.months,
                    supMonthly: r3(row.sup.monthly),
                  }
                : {}),
            },
          });
          await tx.contractEvent.create({
            data: {
              contractId: contract.id,
              eventType: "إنشاء العقد",
              description: row.eventDescription,
              username: user.username,
            },
          });
          await audit(tx, {
            username: user.username,
            action: "إنشاء",
            entityType: "contract",
            entityId: contract.id,
            entityName: contractNumber,
            reason: "استيراد من البيانات القديمة",
          });
          return contract.id;
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
          lastError = e; // تضارب رقم العقد — أعِد المحاولة برقم جديد
          continue;
        }
        lastError = e;
        break;
      }
    }
    throw new ImportRunError(`توقف الاستيراد عند إنشاء العقد «${row.title || ""}»: ${errMsg(lastError)}`);
  };

  for (const row of data.contracts) {
    if (!inScope("العقود")) break;
    const fallback = contractFallback(row.amount);
    const found = findExistingContract(row.customer_name, [row.title || fallback]);
    if (found) {
      registerContract(row.customer_name, [row.title || fallback], found);
      stats.skipped_contracts += 1;
      continue;
    }
    const conId = await createContractRow({
      customer_name: row.customer_name,
      title: row.title,
      amount: row.amount,
      contract_date: row.contract_date,
      start_date: row.start_date,
      end_date: row.end_date,
      status: row.status,
      contract_type: row.contract_type,
      eventDescription: "استيراد من البيانات القديمة",
    });
    registerContract(row.customer_name, [row.title || fallback], conId);
    stats.contracts += 1;
  }

  // ===== عقود الإشراف الهندسي (:1017-1043) =====
  for (const row of data.sup_contracts) {
    if (!inScope("عقود الإشراف")) break;
    const fallback = supFallback(row.monthly, row.months);
    const found = findExistingContract(row.customer_name, [row.title || fallback]);
    if (found) {
      registerContract(row.customer_name, [row.title || fallback], found);
      stats.skipped_contracts += 1;
      continue;
    }
    const conId = await createContractRow({
      customer_name: row.customer_name,
      title: row.title,
      amount: row.months * row.monthly,
      contract_date: row.contract_date,
      status: row.status,
      notes: "[مستورد]",
      sup: { sup_start: row.sup_start, months: row.months, monthly: row.monthly },
      eventDescription: "استيراد عقد إشراف من البيانات القديمة",
    });
    registerContract(row.customer_name, [row.title || fallback], conId);
    stats.sup_contracts += 1;
  }

  // ===== مقاولو الباطن (:1045-1054) =====
  const subIds = new Map<string, number>();
  for (const s of await db.subcontractor.findMany({ select: { id: true, name: true } })) {
    subIds.set(s.name, s.id);
  }
  const createSub = async (name: string, phone: string, activity: string, notes: string): Promise<number> => {
    try {
      return await db.$transaction(async (tx) => {
        const subCode = await nextNumberByKey("subcontractor:code", "SUB", 4, tx);
        const sub = await tx.subcontractor.create({
          data: { subCode, name, phone, activity, notes },
        });
        await audit(tx, {
          username: user.username,
          action: "إنشاء",
          entityType: "subcontractor",
          entityId: sub.id,
          entityName: sub.name,
          reason: "استيراد من البيانات القديمة",
        });
        return sub.id;
      });
    } catch (e) {
      throw new ImportRunError(`توقف الاستيراد عند إدخال المقاول «${name}»: ${errMsg(e)}`);
    }
  };
  for (const row of data.subs) {
    if (!inScope("مقاولو الباطن")) break;
    if (subIds.has(row.name)) {
      stats.skipped_subs += 1;
      continue;
    }
    const sid = await createSub(row.name, row.phone, row.activity, `${row.notes || ""} [مستورد]`);
    subIds.set(row.name, sid);
    stats.subs += 1;
  }

  // ===== سندات القبض (الدفعات) · تخطي الموجود بدل إيقاف الرفع (:1056-1092) =====
  for (const row of data.payments) {
    if (!inScope(row.sheet)) continue;
    const cid = customerIds.get(row.customer_name);
    if (!cid) continue;
    const conId = pairIndex.get(`${nameKey(row.contract_key[0])}|${nameKey(row.contract_key[1])}`) ?? null;
    const oldNo = (row.old_number || "").trim();
    if (oldNo) {
      const exists = await db.voucher.findFirst({ where: { voucherNumber: oldNo }, select: { id: true } });
      if (exists) {
        stats.skipped_payments += 1;
        continue;
      }
    }
    // تخطي المكرر بلا رقم قديم: نفس التاريخ/الطرف/العقد/المبلغ/البيان (:1066-1070)
    const cands = await db.voucher.findMany({
      where: { vtype: "receipt", cancelled: false, vdate: row.date, partyId: cid },
      select: { id: true, contractId: true, amount: true, description: true },
    });
    const dup = cands.find(
      (v) =>
        (v.contractId ?? null) === conId &&
        Math.abs(Number(v.amount) - row.amount) < 0.0005 &&
        (v.description || "").trim() === (row.description || "").trim()
    );
    if (dup) {
      stats.skipped_payments += 1;
      continue;
    }
    // تسجيل التجاوز (إن وُجد) قبل الإدخال حتى يظهر في التقرير النهائي (:1074-1083)
    if (conId) {
      const core = await loadContractCore(conId);
      if (core) {
        const dueValue = Math.max(core.current, core.sup ? core.sup.totalDue : 0);
        const over = r3(row.amount - (dueValue - core.collected));
        if (over > 1e-9) {
          stats.overpaid.push(
            `سند قبض بمبلغ ${fmt3(row.amount)} بتاريخ ${row.date} للعميل «${row.customer_name}»` +
              (row.contract_key[1] ? ` على عقد «${row.contract_key[1]}»` : "") +
              ` تجاوز المتبقي بمقدار ${fmt3(over)} · سُجّل كدفعة مقدمة على العقد.`
          );
        }
      }
    }
    try {
      // allow_overpay: الزيادة تُسجَّل كدفعة مقدمة ولا توقف الاستيراد
      await createVoucher(
        {
          vtype: "receipt",
          amount: row.amount,
          vdate: row.date,
          method: row.method,
          contractId: conId ?? undefined,
          description: row.description,
          notes: row.notes,
          allowOverpay: true,
        },
        user
      );
      stats.payments += 1;
    } catch (e) {
      if (e instanceof VoucherError) throw new ImportRunError(e.message, e.status);
      throw new ImportRunError(`توقف الاستيراد عند إدخال سند قبض: ${errMsg(e)}`);
    }
  }

  // ===== عقود الباطن (:1094-1105) =====
  for (const row of data.sub_contracts) {
    if (!inScope("عقود الباطن")) continue;
    const conId = pairIndex.get(`${nameKey(row.contract_key[0])}|${nameKey(row.contract_key[1])}`);
    const sid = subIds.get(row.sub_name);
    if (!conId || !sid) continue;
    try {
      await db.$transaction(async (tx) => {
        const sc = await tx.subContract.create({
          data: {
            subcontractorId: sid,
            contractId: conId,
            amount: r3(row.amount),
            startDate: row.start_date || "",
            endDate: row.end_date || "",
            description: row.description || "عقد باطن مستورد",
          },
        });
        await audit(tx, {
          username: user.username,
          action: "إنشاء",
          entityType: "sub_contract",
          entityId: sc.id,
          entityName: `عقد باطن #${sc.id}`,
          reason: "استيراد من البيانات القديمة",
        });
      });
      stats.sub_contracts += 1;
    } catch (e) {
      throw new ImportRunError(`توقف الاستيراد عند إدخال عقد باطن للمقاول «${row.sub_name}»: ${errMsg(e)}`);
    }
  }

  // ===== سندات الصرف (:1107-1146) =====
  for (const row of data.expenses) {
    if (!inScope("سندات الصرف")) continue;
    if (row.skipExisting) {
      stats.skipped_expenses += 1;
      continue;
    }
    const pname = row.party_name;
    let sid = subIds.get(pname);
    if (sid === undefined) {
      // مستفيد غير مسجل (مورد/مصروف عام) · يُسجل كمقاول تلقائيًا (:1116-1121)
      sid = await createSub(pname, "", "مورد / مصروف عام", "[مستورد]");
      subIds.set(pname, sid);
    }
    const conId = row.contract_key
      ? pairIndex.get(`${nameKey(row.contract_key[0])}|${nameKey(row.contract_key[1])}`) ?? null
      : null;
    // تخطي تكرار سند صرف بلا رقم قديم أيضًا (:1126-1135)
    const cands = await db.voucher.findMany({
      where: { vtype: "payment", cancelled: false, vdate: row.date },
      select: { id: true, party: true, contractId: true, amount: true, description: true },
    });
    const dup = cands.find(
      (v) =>
        (v.party || "").trim() === pname &&
        (v.contractId ?? null) === conId &&
        Math.abs(Number(v.amount) - row.amount) < 0.0005 &&
        (v.description || "").trim() === (row.description || "").trim()
    );
    if (dup) {
      stats.skipped_expenses += 1;
      continue;
    }
    // المقاول المرتبط بعقد باطن على هذا العقد يُصرف عبر سقفه (allow_overpay)
    const linked =
      conId && row.is_sub
        ? await db.subContract.findFirst({
            where: { subcontractorId: sid, contractId: conId, status: { not: "ملغى" } },
            select: { id: true },
          })
        : null;
    const expenseCustomerId = row.expense_customer_name
      ? customerIds.get(row.expense_customer_name) ?? null
      : null;
    try {
      const created = await createVoucher(
        {
          vtype: "payment",
          amount: row.amount,
          vdate: row.date,
          method: row.method,
          party: pname,
          // حارس الويب يمنع «subcontractor» بلا ربط باطن على العقد — البديل: مورد نصي بنفس الاسم (موثق)
          partyType: linked ? "subcontractor" : "",
          partyId: linked ? sid : undefined,
          subContractId: linked?.id,
          contractId: conId ?? undefined,
          expenseAccountId: row.expense_account_id,
          expenseCustomerId: expenseCustomerId ?? undefined,
          description: row.description,
          notes: row.notes,
          allowOverpay: true,
        },
        user
      );
      if (row.project_id) {
        await db.voucher.update({ where: { id: created.id }, data: { projectId: row.project_id } });
      }
      stats.expenses += 1;
    } catch (e) {
      if (e instanceof VoucherError) throw new ImportRunError(e.message, e.status);
      throw new ImportRunError(`توقف الاستيراد عند إدخال سند صرف: ${errMsg(e)}`);
    }
  }

  // تدقيق ختامي واحد للعملية (بنمط تدقيق مسارات الويب)
  await audit(db, {
    username: user.username,
    action: "استيراد بيانات قديمة",
    entityType: "system",
    entityName: "import_excel",
    reason:
      `عملاء ${stats.customers} · عقود ${stats.contracts} · إشراف ${stats.sup_contracts} · مقاولون ${stats.subs} · ` +
      `قبض ${stats.payments} · باطن ${stats.sub_contracts} · صرف ${stats.expenses}`,
  });

  return stats;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
