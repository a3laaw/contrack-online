// ============================================================
// ConTrack Online — ترقيم المطالبات العالمي CLM-#### (المرحلة 4)
// كالأصل claims_service._next_number: MAX(الرقم الموجود) + 1
// بصيغة 4 أرقام — يُستدعى دائمًا داخل معاملة (tx) لضمان الذرية.
// ============================================================
import type { TxClient } from '@/lib/api-utils'

/** الرقم العالمي التالي للمطالبة — يجب استدعاؤه داخل $transaction */
export async function nextClaimNumber(tx: TxClient): Promise<string> {
  const rows = await tx.claim.findMany({ select: { claimNumber: true } })
  let maxN = 0
  for (const r of rows) {
    const n = parseInt(r.claimNumber.slice(4), 10)
    if (Number.isFinite(n) && n > maxN) maxN = n
  }
  return `CLM-${String(maxN + 1).padStart(4, '0')}`
}

/** وسم عقد الباطن التركيبي SUB-00X (لا يوجد عمود كود في المخطط) */
export function subLabel(id: number | null | undefined): string | null {
  return id != null ? `SUB-${String(id).padStart(3, '0')}` : null
}
