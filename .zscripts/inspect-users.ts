import { db } from '../src/lib/db'
async function main() {
  const users = await db.user.findMany({ select: { id: true, username: true, role: true, isActive: true } })
  console.log('Users:', JSON.stringify(users))
}
main().finally(() => process.exit(0))
