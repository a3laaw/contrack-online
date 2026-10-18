// ============================================================
// ConTrack Online — عميل API للإدارة:
// شجرة المراحل + قوالب الدفع + صلاحيات المستخدمين + حسابات
// المصروفات (إدارة) + النسخ الاحتياطي
// بنفس نمط followup-api.ts: توكن Bearer + أخطاء عربية
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  BackupFile,
  ExpenseAccountAdminDTO,
  ExpenseAccountCreateInput,
  PaymentTemplateDTO,
  PaymentTemplateInput,
  UserPermissionsDTO,
  PermissionMap,
  WorkflowStageInput,
  WorkflowStagePatch,
  WorkflowStagesResponse,
} from './admin-types'

async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken()
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = 'تعذر تنفيذ الطلب، يرجى المحاولة مرة أخرى'
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) msg = data.error
    } catch {
      /* تجاهل */
    }
    throw new ApiError(msg, res.status)
  }
  return (await res.json()) as T
}

const jsonBody = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

export const adminApi = {
  // ---------- شجرة المراحل ----------
  workflowStages: (contractType: string) =>
    adminRequest<WorkflowStagesResponse>(
      `/api/workflow-stages?contractType=${encodeURIComponent(contractType)}`,
    ),

  addStage: (input: WorkflowStageInput) =>
    adminRequest<{ id: number }>('/api/workflow-stages', { method: 'POST', ...jsonBody(input) }),

  updateStage: (id: number, patch: WorkflowStagePatch) =>
    adminRequest<{ id: number }>(`/api/workflow-stages?id=${id}`, {
      method: 'PATCH',
      ...jsonBody(patch),
    }),

  deleteStage: (id: number) =>
    adminRequest<{ ok: boolean }>(`/api/workflow-stages?id=${id}`, { method: 'DELETE' }),

  // ---------- قوالب الدفع ----------
  paymentTemplates: (contractType: string) =>
    adminRequest<{ contractType: string; templates: PaymentTemplateDTO[] }>(
      `/api/payment-templates?contractType=${encodeURIComponent(contractType)}`,
    ),

  addPaymentTemplate: (input: PaymentTemplateInput) =>
    adminRequest<{ id: number }>('/api/payment-templates', {
      method: 'POST',
      ...jsonBody(input),
    }),

  updatePaymentTemplate: (id: number, input: Omit<PaymentTemplateInput, 'contractType'>) =>
    adminRequest<{ id: number }>(`/api/payment-templates/${id}`, {
      method: 'PATCH',
      ...jsonBody(input),
    }),

  deletePaymentTemplate: (id: number) =>
    adminRequest<{ ok: boolean }>(`/api/payment-templates/${id}`, { method: 'DELETE' }),

  // ---------- صلاحيات المستخدمين ----------
  userPermissions: (userId: number) =>
    adminRequest<UserPermissionsDTO>(`/api/users/${userId}/permissions`),

  saveUserPermissions: (userId: number, permissions: PermissionMap) =>
    adminRequest<UserPermissionsDTO>(`/api/users/${userId}/permissions`, {
      method: 'PUT',
      ...jsonBody({ permissions }),
    }),

  // ---------- حسابات المصروفات (إدارة) ----------
  /** كل الحسابات بما فيها المعطلة (لشاشة الإعدادات) */
  expenseAccountsAll: () =>
    adminRequest<ExpenseAccountAdminDTO[]>('/api/expense-accounts?all=1'),

  addExpenseAccount: (input: ExpenseAccountCreateInput) =>
    adminRequest<{ id: number; fullPath: string }>('/api/expense-accounts', {
      method: 'POST',
      ...jsonBody(input),
    }),

  updateExpenseAccount: (
    id: number,
    patch: { isActive?: boolean; allowPosting?: boolean; includeInProfitability?: boolean; name?: string },
  ) =>
    adminRequest<{ id: number }>(`/api/expense-accounts?id=${id}`, {
      method: 'PATCH',
      ...jsonBody(patch),
    }),

  // ---------- النسخ الاحتياطي ----------
  /** تنزيل نسخة كاملة JSON (مدير فقط) — يعيد الملف مع بياناته */
  async downloadBackup(): Promise<{ meta: BackupFile['meta']; filename: string }> {
    const token = getStoredToken()
    const res = await fetch('/api/backup', {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: 'no-store',
    })
    if (!res.ok) {
      let msg = 'تعذر إنشاء النسخة الاحتياطية'
      try {
        const data = (await res.json()) as { error?: string }
        if (data?.error) msg = data.error
      } catch {
        /* تجاهل */
      }
      throw new ApiError(msg, res.status)
    }

    const backup = (await res.json()) as BackupFile
    const filename =
      res.headers
        .get('Content-Disposition')
        ?.match(/filename="?([^";]+)"?/)?.[1] ?? 'contrack-backup.json'

    // حفظ الملف محليًا عبر رابط كائن مؤقت
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    return { meta: backup.meta, filename }
  },
}
