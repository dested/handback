import { chromium } from '@playwright/test'
import { prisma } from './server/prisma'

const org = await prisma.org.findFirst({ where: { name: 'Dested LLC' } })
const owner = await prisma.user.findUnique({ where: { email: 'dested@gmail.com' } })
if (!org || !owner) throw new Error('seed missing')
const email = `invite-probe-${Date.now()}@example.com`
const inv = await prisma.invite.create({
  data: { orgId: org.id, email, role: 'member', createdById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 864e5) },
})

const browser = await chromium.launch()
const page = await browser.newContext().then((c) => c.newPage())
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERR:', m.text()))

await page.goto(`http://localhost:3995/join/${inv.id}`)
await page.getByRole('link', { name: 'Create an account' }).click()
await page.waitForURL(/\/sign-up\?invite=/)
console.log('→ sign-up url:', page.url())
console.log('→ email prefilled:', await page.locator('#email').inputValue())
console.log('→ subhead:', await page.locator('h1 + p').innerText())

await page.locator('#name').fill('Invite Probe')
await page.locator('#password').fill('probe-password-123')
await page.getByRole('button', { name: 'Create account' }).click()
await page.waitForURL('**/app', { timeout: 15000 })
console.log('→ landed:', page.url())

const user = await prisma.user.findUnique({ where: { email } })
const ms = await prisma.membership.findMany({
  where: { userId: user?.id }, include: { org: { select: { name: true } } },
})
console.log('→ memberships:', JSON.stringify(ms.map((m) => ({ org: m.org.name, role: m.role, scope: m.scope }))))
const after = await prisma.invite.findUnique({ where: { id: inv.id } })
console.log('→ invite acceptedAt:', after?.acceptedAt?.toISOString() ?? null)

await browser.close()
// cleanup the throwaway account
if (user) {
  await prisma.membership.deleteMany({ where: { userId: user.id } })
  await prisma.session.deleteMany({ where: { userId: user.id } })
  await prisma.account.deleteMany({ where: { userId: user.id } })
  await prisma.invite.deleteMany({ where: { id: inv.id } })
  await prisma.user.delete({ where: { id: user.id } })
  console.log('→ cleaned up probe account')
}
process.exit(0)
