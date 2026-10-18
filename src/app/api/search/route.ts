import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, normalizeArabic, ok } from "@/lib/api-utils";
import { VOUCHER_TYPE_LABELS } from "@/lib/voucher-server";
import { r3 } from "@/lib/contrack-core";

interface SearchItem {
  id: number;
  title: string;
  subtitle: string;
  href: string;
}
interface SearchGroup {
  type: string;
  label: string;
  items: SearchItem[];
}

/** البحث الشامل — GET /api/search?q=&limit=8 (تطبيع عربي على 6 كيانات) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit") || 8) || 8));
  const nq = normalizeArabic(q);
  // البحث يعمل للاستعلام ≥ حرفين (كالمصدر search_service)
  if (nq.length < 2) return ok({ groups: [], query: q });

  const hit = (...fields: (string | null | undefined)[]): boolean =>
    fields.some((f) => f && normalizeArabic(f).includes(nq));

  // 1) العملاء: name/phone/code (+ بريد/عنوان كالمصدر)
  const customers = (await db.customer.findMany({
    select: { id: true, name: true, customerCode: true, phone: true, email: true, address: true },
    orderBy: { id: "asc" },
    take: 5000,
  }))
    .filter((c) => hit(c.name, c.customerCode, c.phone, c.email, c.address))
    .slice(0, limit)
    .map<SearchItem>((c) => ({
      id: c.id,
      title: c.name,
      subtitle: `${c.customerCode}${c.phone ? ` · ${c.phone}` : ""}`,
      href: `customers?id=${c.id}`,
    }));

  // 2) العقود: number/name/description + اسم/هاتف/كود العميل (المبلغ = القيمة الأصلية + ملاحق معتمدة)
  const contracts = (
    await db.contract.findMany({
      select: {
        id: true, contractNumber: true, contractName: true, description: true, amount: true,
        customer: { select: { name: true, phone: true, customerCode: true } },
        addendums: { where: { status: "معتمد" }, select: { amountAdd: true, amountDeduct: true } },
      },
      orderBy: { id: "asc" },
      take: 5000,
    })
  )
    .filter((c) => hit(c.contractNumber, c.contractName, c.description, c.customer.name, c.customer.phone, c.customer.customerCode))
    .slice(0, limit)
    .map<SearchItem>((c) => {
      const addNet = c.addendums.reduce((s, a) => s + Number(a.amountAdd) - Number(a.amountDeduct), 0);
      return {
        id: c.id,
        title: `${c.contractNumber}${c.contractName ? ` — ${c.contractName}` : ""}`,
        subtitle: `${c.customer.name} · ${r3(Number(c.amount) + addNet)}`,
        href: `contracts?id=${c.id}`,
      };
    });

  // 3) السندات: number/party/description (+ حسابات وأرقام العقود)
  const vouchers = (
    await db.voucher.findMany({
      select: {
        id: true, voucherNumber: true, vtype: true, party: true, description: true, amount: true, account: true,
        expenseAccountSnapshot: true, custodyAccountSnapshot: true,
        contract: { select: { contractNumber: true } },
      },
      orderBy: { id: "asc" },
      take: 8000,
    })
  )
    .filter((v) => hit(v.voucherNumber, v.party, v.description, v.account, v.expenseAccountSnapshot, v.custodyAccountSnapshot, v.contract?.contractNumber))
    .slice(0, limit)
    .map<SearchItem>((v) => ({
      id: v.id,
      title: `${v.voucherNumber} · ${VOUCHER_TYPE_LABELS[v.vtype] || v.vtype}`,
      subtitle: `${v.party || "—"} · ${r3(Number(v.amount))}${v.description ? ` · ${v.description}` : ""}`,
      href: `vouchers?id=${v.id}`,
    }));

  // 4) المقاولون: name/code/phone/activity
  const subs = (await db.subcontractor.findMany({
    select: { id: true, name: true, subCode: true, phone: true, activity: true },
    orderBy: { id: "asc" },
    take: 5000,
  }))
    .filter((s) => hit(s.name, s.subCode, s.phone, s.activity))
    .slice(0, limit)
    .map<SearchItem>((s) => ({
      id: s.id,
      title: s.name,
      subtitle: `${s.subCode}${s.activity ? ` · ${s.activity}` : s.phone ? ` · ${s.phone}` : ""}`,
      href: `subcontractors?id=${s.id}`,
    }));

  // 5) الفواتير: number/description + بيانات العميل
  const invoices = (
    await db.invoice.findMany({
      select: {
        id: true, invoiceNumber: true, description: true, amount: true,
        customer: { select: { name: true, phone: true } },
      },
      orderBy: { id: "asc" },
      take: 5000,
    })
  )
    .filter((i) => hit(i.invoiceNumber, i.description, i.customer.name, i.customer.phone))
    .slice(0, limit)
    .map<SearchItem>((i) => ({
      id: i.id,
      title: `${i.invoiceNumber}${i.description ? ` — ${i.description}` : ""}`,
      subtitle: `${i.customer.name} · ${r3(Number(i.amount))}`,
      href: `invoices?id=${i.id}`,
    }));

  // 6) المطالبات: number/title (+ رقم العقد)
  const claims = (
    await db.claim.findMany({
      select: {
        id: true, claimNumber: true, title: true, amount: true, status: true,
        contract: { select: { contractNumber: true } },
      },
      orderBy: { id: "asc" },
      take: 5000,
    })
  )
    .filter((c) => hit(c.claimNumber, c.title, c.contract?.contractNumber))
    .slice(0, limit)
    .map<SearchItem>((c) => ({
      id: c.id,
      title: `${c.claimNumber} · ${c.title}`,
      subtitle: `${c.contract?.contractNumber || "—"} · ${r3(Number(c.amount))}`,
      href: `claims?id=${c.id}`,
    }));

  const all: SearchGroup[] = [
    { type: "customer", label: "العملاء", items: customers },
    { type: "contract", label: "العقود", items: contracts },
    { type: "voucher", label: "السندات", items: vouchers },
    { type: "subcontractor", label: "المقاولون", items: subs },
    { type: "invoice", label: "الفواتير", items: invoices },
    { type: "claim", label: "المطالبات", items: claims },
  ].filter((g) => g.items.length > 0);

  return ok({ groups: all, query: q });
}
