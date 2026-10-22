// ============================================================
// db.ts — عميل Prisma محمي بسياق الشركة (SaaS — Task 85)
// ------------------------------------------------------------
// الفكرة: كل الجداول التشغيلية تحمل company_id، وهذا الملف يصدّر
// `db` كغلاف (Proxy) فوق PrismaClient يحقن/يفرض company_id آليًا:
//   - القراءة (findMany/findFirst/count/aggregate/groupBy): دمج where.companyId
//   - findUnique/findUniqueOrThrow: توسيع حيث-الفريد إلى findFirst محصور
//   - create/createMany: حقن data.companyId (يطمس أي قيمة واردة)
//   - update/delete/upsert: تحقق ملكية مسبق (بالـ id) أو حقن المفتاح المركّب
//   - $transaction: يمرر معاملة ملّافة بنفس الحجب (tx.client آمنة تلقائيًا)
// مصدر السياق: توكن الجلسة (userId.companyId.timestamp.hmac) من كوكي
// ctrk_session — موقّع HMAC فلا يمكن تزويره. أو forCompany(id) للسياقات
// النظامية (بذر البيانات عند الدخول).
// الجداول العامة (User/UserPermission/FeatureFlag/AuditLog/PurgeAudit/
// AppNotification/DismissedAlert/Company) تمر بلا حجب.
// ============================================================
import { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { parseToken, SESSION_COOKIE } from "@/lib/session-token";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const base: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = base

// الجداول التشغيلية الخاضعة لفصل الشركات (57 نموذجًا)
const TENANT_MODELS = new Set<string>([
  "transactionParticipant", "stageMove", "numberSequence", "customer", "contract",
  "contractStage", "boqItem", "paymentPlanItem", "voucher", "project",
  "quotation", "quotationItem", "voucherPaymentLink", "addendum", "addendumItem",
  "claim", "subcontractor", "subContract", "subContractItem", "subPaymentPlanItem",
  "subPaymentSource", "contractType", "typePaymentTemplate", "typePaymentStage", "typeBundleComponent",
  "contractComponent", "entityBackup", "workflowStage", "contractScope", "setting",
  "paymentMethod", "expenseAccount", "contractGroup", "contractGroupItem", "invoice",
  "employee", "task", "visitStaff", "visit", "comment",
  "contractAttachment", "gatewayProfile", "gatewayOp", "bankLine", "otherCompanyTransfer",
  "transferOpAlloc", "otherCompanyOpening", "gatewayFeeVoucher", "matchAlias", "journalEntry",
  "contractEvent", "formCategory", "formTemplate", "formField", "formDocument",
  "stageNote", "txMessage",
]);

interface Ctx { companyId: number }

/**
 * قراءة سياق الشركة وقت الاستعلام:
 * - fixedId: شركة مقفلة داخل غلاف forCompany() (بذر/نظام) — آمن للتزامن (بلا حالة عامة)
 * - وإلا: توكن الجلسة من كوكي ctrk_session (موقّع HMAC)
 */
async function resolveCtx(fixedId: number | null): Promise<Ctx> {
  if (fixedId != null) return { companyId: fixedId };
  const c = await currentCompanyId();
  if (c == null) throw new Error("سياق الشركة مفقود — استدعاء جدول تشغيلي بلا جلسة ولا forCompany()");
  return { companyId: c };
}

/** معرّف الشركة الحالي من الجلسة (Bearer ثم كوكي — مطابق لأولوية getSessionUser) — أو null خارج الطلب */
export async function currentCompanyId(): Promise<number | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const auth = h.get("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      const p = parseToken(auth.slice(7).trim());
      if (p) return p.companyId;
    }
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const p = parseToken(token);
    return p ? p.companyId : null;
  } catch {
    return null;
  }
}

/** دمج where القراءة مع companyId (AND) */
function mergeWhere(where: unknown, ctx: Ctx): Record<string, unknown> {
  return { AND: [(where as object) ?? {}, { companyId: ctx.companyId }] };
}

/** توسيع حيث-الفريد (id / مركّب companyId_x) إلى where عادي محصور بالشركة */
function flattenUnique(w: Record<string, unknown> | undefined, ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w ?? {})) {
    if (k === "id") {
      out.id = v;
      out.companyId = ctx.companyId;
    } else if (k === "companyId") {
      out.companyId = ctx.companyId; // فرض السياق (Setting PK)
    } else if (typeof k === "string" && k.startsWith("companyId_")) {
      Object.assign(out, v as object);
      out.companyId = ctx.companyId;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** حقن companyId داخل حيث-الفريد (لتحديث/حذف/upsert بالمفتاح المركّب) */
function injectCompound(w: Record<string, unknown>, ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w ?? {})) {
    if (k === "companyId" || (typeof k === "string" && k.startsWith("companyId_"))) {
      out[k] = { ...(v as object), companyId: ctx.companyId };
    } else {
      out[k] = v;
    }
  }
  return out;
}

function notFound(): Error {
  const e = new Error("السجل غير موجود في نطاق الشركة الحالية");
  (e as unknown as { code: string }).code = "P2025";
  return e;
}

function scopeDelegate(delegate: Record<string, unknown>, fixedId: number | null) {
  return new Proxy(delegate, {
    get(target, prop, recv) {
      if (typeof prop !== "string") return Reflect.get(target, prop, recv);
      switch (prop) {
        case "findMany":
        case "findFirst":
        case "findFirstOrThrow":
        case "count":
        case "aggregate":
        case "groupBy":
          return async (args: { where?: unknown } = {}) => {
            const ctx = await resolveCtx(fixedId);
            args.where = mergeWhere(args.where, ctx);
            return (target[prop] as (a: unknown) => unknown)(args);
          };
        case "findUnique":
        case "findUniqueOrThrow": {
          const to = prop === "findUnique" ? "findFirst" : "findFirstOrThrow";
          return async (args: { where?: Record<string, unknown> } = {}) => {
            const ctx = await resolveCtx(fixedId);
            const where = flattenUnique(args.where, ctx);
            return (target[to] as (a: unknown) => unknown)({ ...args, where });
          };
        }
        case "create":
          return async (args: { data: Record<string, unknown> }) => {
            const ctx = await resolveCtx(fixedId);
            args.data = { ...args.data, companyId: ctx.companyId };
            return (target.create as (a: unknown) => unknown)(args);
          };
        case "createMany":
        case "createManyAndReturn":
          return async (args: { data: unknown }) => {
            const ctx = await resolveCtx(fixedId);
            const d = args.data;
            if (Array.isArray(d)) args.data = d.map((x) => ({ ...(x as object), companyId: ctx.companyId }));
            else args.data = { ...(d as object), companyId: ctx.companyId };
            return (target[prop] as (a: unknown) => unknown)(args);
          };
        case "update":
        case "upsert":
        case "delete":
          return async (args: { where?: Record<string, unknown>; create?: Record<string, unknown>; data?: unknown } = {}) => {
            const ctx = await resolveCtx(fixedId);
            const w = args.where ?? {};
            const keys = Object.keys(w);
            if (keys.length === 1 && keys[0] === "id") {
              const t2 = target as { findFirst: (a: unknown) => unknown };
              const found = (await t2.findFirst({ where: { id: w.id, companyId: ctx.companyId }, select: { id: true } })) as unknown;
              if (!found) throw notFound();
            } else {
              args.where = injectCompound(w, ctx);
            }
            if (prop === "upsert") args.create = { ...(args.create ?? {}), companyId: ctx.companyId };
            return (target[prop] as (a: unknown) => unknown)(args);
          };
        case "updateMany":
        case "deleteMany":
          return async (args: { where?: unknown } = {}) => {
            const ctx = await resolveCtx(fixedId);
            args.where = mergeWhere(args.where, ctx);
            return (target[prop] as (a: unknown) => unknown)(args);
          };
        default:
          return Reflect.get(target, prop, recv);
      }
    },
  });
}

function wrapClient<T extends object>(client: T, fixedId: number | null): T {
  return new Proxy(client, {
    get(t, prop, recv) {
      if (prop === "$transaction") {
        const orig = (t as unknown as { $transaction: (...a: unknown[]) => unknown }).$transaction;
        return (...args: unknown[]) => {
          const cb = args[0];
          if (typeof cb === "function") {
            return orig.call(t, async (tx: unknown, ...rest: unknown[]) =>
              (cb as (a: unknown, ...r: unknown[]) => unknown)(wrapClient(tx as object, fixedId), ...rest), args[1]);
          }
          return (orig as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      const v = Reflect.get(t, prop, recv);
      if (typeof prop === "string" && TENANT_MODELS.has(prop) && v && typeof v === "object") {
        return scopeDelegate(v as Record<string, unknown>, fixedId);
      }
      return v;
    },
  });
}

/** العميل المحمي — يُستخدم في كل المسارات كما كان (db.customer.findMany...) */
export const db = wrapClient(base, null);

/** عميل بلا حجب — للجداول العامة فقط أو قراءات إدارية عامة */
export const sysDb = base;

/** عميل محصور بشركة محددة — للسياقات النظامية (بذر عند الدخول، سكربتات) — آمن للتزامن */
export function forCompany(companyId: number): PrismaClient {
  return wrapClient(base, companyId);
}
