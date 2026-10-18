// ============================================================
// GET /api/backup — نسخة احتياطية كاملة (JSON واحد بكل الجداول) — مدير فقط
// - يجمع كل جداول النظام في JSON واحد مع meta (الوقت والمستخدم وعدد كل جدول)
// - يستثني كلمات المرور (passwordHash/salt)
// - يسجل تاريخ آخر نسخة في Settings.uiPrefs.last_backup_at
// - Content-Disposition: attachment ⇒ تنزيل مباشر
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard } from '@/lib/api-utils'
import { updateUiPrefs } from '@/lib/ui-prefs'

const pad2 = (n: number) => String(n).padStart(2, '0')

export async function GET(req: NextRequest) {
  const g = await adminGuard(req)
  if (g.error) return g.error

  const [
    users,
    userPermissions,
    customers,
    contractTypes,
    workflowStages,
    typePaymentTpls,
    typePaymentStages,
    typeBundleComponents,
    contracts,
    contractStages,
    boqItems,
    paymentPlans,
    contractComponents,
    subcontractors,
    subContracts,
    subContractItems,
    subPaymentPlans,
    subPaymentSources,
    vouchers,
    voucherPaymentLinks,
    expenseAccounts,
    addendums,
    addendumItems,
    claims,
    employees,
    paymentMethods,
    contractEvents,
    numberSequences,
    settings,
    invoices,
    tasks,
    visits,
    customerComments,
    contractGroups,
    contractGroupItems,
    gatewayProfiles,
    gatewayOps,
    bankLines,
    matchAliases,
    otherCompanyTransfers,
    transferOpAllocs,
  ] = await Promise.all([
    // المستخدمون — بلا كلمات المرور
    db.user.findMany({
      select: {
        id: true, username: true, role: true, fullName: true, jobTitle: true,
        isActive: true, createdAt: true,
      },
    }),
    db.userPermission.findMany(),
    db.customer.findMany(),
    db.contractType.findMany(),
    db.workflowStage.findMany(),
    db.typePaymentTpl.findMany(),
    db.typePaymentStage.findMany(),
    db.typeBundleComponent.findMany(),
    db.contract.findMany(),
    db.contractStage.findMany(),
    db.boqItem.findMany(),
    db.paymentPlan.findMany(),
    db.contractComponent.findMany(),
    db.subcontractor.findMany(),
    db.subContract.findMany(),
    db.subContractItem.findMany(),
    db.subPaymentPlan.findMany(),
    db.subPaymentSource.findMany(),
    db.voucher.findMany(),
    db.voucherPaymentLink.findMany(),
    db.expenseAccount.findMany(),
    db.addendum.findMany(),
    db.addendumItem.findMany(),
    db.claim.findMany(),
    db.employee.findMany(),
    db.paymentMethod.findMany(),
    db.contractEvent.findMany(),
    db.numberSequence.findMany(),
    db.settings.findMany(),
    db.invoice.findMany(),
    db.task.findMany(),
    db.visit.findMany(),
    db.customerComment.findMany(),
    db.contractGroup.findMany(),
    db.contractGroupItem.findMany(),
    db.gatewayProfile.findMany(),
    db.gatewayOp.findMany(),
    db.bankLine.findMany(),
    db.matchAlias.findMany(),
    db.otherCompanyTransfer.findMany(),
    db.transferOpAlloc.findMany(),
  ])

  const data: Record<string, unknown[]> = {
    users,
    userPermissions,
    customers,
    contractTypes,
    workflowStages,
    typePaymentTpls,
    typePaymentStages,
    typeBundleComponents,
    contracts,
    contractStages,
    boqItems,
    paymentPlans,
    contractComponents,
    subcontractors,
    subContracts,
    subContractItems,
    subPaymentPlans,
    subPaymentSources,
    vouchers,
    voucherPaymentLinks,
    expenseAccounts,
    addendums,
    addendumItems,
    claims,
    employees,
    paymentMethods,
    contractEvents,
    numberSequences,
    settings,
    invoices,
    tasks,
    visits,
    customerComments,
    contractGroups,
    contractGroupItems,
    gatewayProfiles,
    gatewayOps,
    bankLines,
    matchAliases,
    otherCompanyTransfers,
    transferOpAllocs,
  }

  const generatedAt = new Date().toISOString()
  const tables: Record<string, number> = {}
  for (const [k, v] of Object.entries(data)) tables[k] = v.length

  // تاريخ آخر نسخة ناجحة في uiPrefs
  try {
    await updateUiPrefs({ last_backup_at: generatedAt })
  } catch {
    /* لا نُفشل النسخة إن تعذر تسجيل التاريخ */
  }

  const now = new Date()
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`
  const filename = `contrack-backup-${stamp}.json`

  return NextResponse.json(
    {
      meta: {
        app: 'ConTrack Online',
        version: 'V9.15.18',
        generatedAt,
        generatedBy: g.user.username,
        tables,
      },
      data,
    },
    {
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    },
  )
}
