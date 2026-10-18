import { db } from '../src/lib/db'
async function main() {
  const accs = await db.expenseAccount.findMany({ orderBy: { id: 'asc' } })
  console.log('ExpenseAccounts:', JSON.stringify(accs, null, 0))
  const seqs = await db.numberSequence.findMany()
  console.log('Sequences:', JSON.stringify(seqs))
  const emps = await db.employee.findMany()
  console.log('Employees:', JSON.stringify(emps))
  console.log('Voucher count:', await db.voucher.count())
  const lastV = await db.voucher.findMany({ orderBy: { id: 'desc' }, take: 3, select: { voucherNumber: true, vtype: true, method: true, amount: true } })
  console.log('Last vouchers:', JSON.stringify(lastV))
}
main().finally(() => process.exit(0))
