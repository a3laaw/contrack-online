import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const main = async () => {
  const users = await db.$queryRawUnsafe<{c: bigint}[]>(`SELECT count(*)::bigint c FROM users`)
  const contracts = await db.$queryRawUnsafe<{c: bigint}[]>(`SELECT count(*)::bigint c FROM contracts`)
  const cols = await db.$queryRawUnsafe<{column_name: string}[]>(`SELECT column_name FROM information_schema.columns WHERE table_name='settings' ORDER BY ordinal_position`)
  console.log('users=', users[0].c, 'contracts=', contracts[0].c)
  console.log('settings columns:', cols.map(c=>c.column_name).join(', '))
}
main().finally(()=>db.$disconnect())
