"use client";

export class ApiError extends Error {
  status: number;
  overpay?: boolean;
  constructor(message: string, status: number, overpay?: boolean) {
    super(message);
    this.status = status;
    this.overpay = overpay;
  }
}

const TOKEN_KEY = "ctrk_token";

export function getStoredToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export async function apiFetch<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string; message?: string })?.error ||
      (data as { message?: string })?.message ||
      `فشل الطلب (${res.status})`;
    const overpay = (data as { overpay?: boolean })?.overpay;
    throw new ApiError(msg, res.status, overpay);
  }
  return data as T;
}

export const apiGet = <T = unknown>(path: string) => apiFetch<T>(path);
export const apiPost = <T = unknown>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "POST", body });
export const apiPatch = <T = unknown>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "PATCH", body });
export const apiPut = <T = unknown>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "PUT", body });
export const apiDelete = <T = unknown>(path: string) => apiFetch<T>(path, { method: "DELETE" });

// ============================================================
// واجهة نطاق مبسطة تستخدمها الحوارات (السندات/الطباعة/الأنواع)
// تلتف على نقاط النهاية الفعلية وتكشف استجاباتها
// ============================================================
export interface SettingsLite {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  headerTitle: string;
}

export interface CustomerOption {
  id: number;
  customerCode: string;
  name: string;
  phone: string;
  email: string;
}

export interface ContractOption {
  id: number;
  customerId: number;
  customerName: string;
  contractNumber: string;
  contractName: string;
  contractType: string;
  status: string;
}

/** دفعة من خطة العقد كما يرجعها GET /api/contracts/[id] */
export interface PlanLineLite {
  id: number;
  title: string;
  dueDate: string;
  amount: number;
  remaining: number;
  triggeredAt: string;
}

export interface ContractDetailLite {
  id: number;
  contractNumber: string;
  payments: PlanLineLite[];
}

export interface VoucherCreatedLite {
  id: number;
  voucherNumber: string;
  amount: number;
}

export interface ContractTypeLite {
  id: number;
  name: string;
  defaultAmount: number;
  notes: string;
  active: boolean;
  manualTrack: boolean;
  unitLabel: string;
  unitPrice: number;
  pricingMode: string;
  isSupervision: boolean;
  templatesCount: number;
}

export const api = {
  /** إعدادات الشركة (كائن الإعدادات نفسه) */
  settings: () => apiGet<{ settings: SettingsLite }>("/api/settings").then((r) => r.settings),
  /** قائمة العملاء (اختيارياً بالبحث) */
  customers: (q: string) =>
    apiGet<{ customers: CustomerOption[] }>(`/api/customers?q=${encodeURIComponent(q)}`).then((r) => r.customers),
  /** قائمة العقود مع فلترة العميل */
  contracts: (filter: { customerId?: number } = {}) => {
    const sp = new URLSearchParams();
    if (filter.customerId) sp.set("customerId", String(filter.customerId));
    const qs = sp.toString();
    return apiGet<{ contracts: ContractOption[] }>(`/api/contracts${qs ? `?${qs}` : ""}`).then((r) => r.contracts);
  },
  /** تفاصيل عقد (يشمل دفعات الخطة مع المتبقي) */
  contract: (id: number) =>
    apiGet<{ contract: ContractDetailLite }>(`/api/contracts/${id}`).then((r) => r.contract),
  /** إنشاء سند (قبض/صرف/تحويل) مع روابط الدفعات */
  createVoucher: (payload: Record<string, unknown>) =>
    apiPost<{ voucher: VoucherCreatedLite }>("/api/vouchers", payload).then((r) => r.voucher),
  /** إلغاء سند بسبب */
  cancelVoucher: (id: number, reason: string) =>
    apiPost<{ ok: boolean; id: number }>(`/api/vouchers/${id}/cancel`, { reason }),
  /** شجرة حسابات المصروفات */
  expenseAccounts: () => apiGet<import("@/lib/contrack-types").ExpenseAccountDTO[]>("/api/expense-accounts"),
  /** أنواع العقود (مع عدّاد القوالب) */
  contractTypes: () =>
    apiGet<{ types: ContractTypeLite[] }>("/api/contract-types").then((r) => r.types),
};
