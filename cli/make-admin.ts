// Promote an account to platform admin: bun cli/make-admin.ts you@example.com
// (prod has no shell — set ADMIN_EMAILS in SSM instead)

import { prisma } from '../server/prisma'

const email = process.argv[2]
if (!email) {
  console.error('usage: bun cli/make-admin.ts <email>')
  process.exit(1)
}
const user = await prisma.user.findUnique({ where: { email } })
if (!user) {
  console.error(`no user with email ${email}`)
  process.exit(1)
}
await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } })
console.log(`${email} is now a platform admin`)
process.exit(0)
