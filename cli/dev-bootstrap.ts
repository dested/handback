// Dev-only bootstrap: ensure a user, an org, and an API token exist, and
// print the raw token for the CLI. Idempotent — safe to re-run; a fresh token
// is minted every time (old ones stay valid until revoked).
//
//   bun cli/dev-bootstrap.ts [email] [password] [org-name]

import { createHash, randomBytes } from 'node:crypto'
import { auth } from '../server/auth'
import { slugify } from '../server/membership'
import { prisma } from '../server/prisma'

const email = process.argv[2] ?? 'dev@inloop.local'
const password = process.argv[3] ?? 'inloop-dev-password'
const orgName = process.argv[4] ?? 'Dev Org'

let user = await prisma.user.findUnique({ where: { email } })
if (!user) {
  await auth.api.signUpEmail({ body: { email, password, name: email.split('@')[0] } })
  user = await prisma.user.findUniqueOrThrow({ where: { email } })
  console.log(`created user ${email} (password: ${password})`)
} else {
  console.log(`user ${email} already exists`)
}

let membership = await prisma.membership.findFirst({
  where: { userId: user.id },
  include: { org: true },
})
if (!membership) {
  const org = await prisma.org.create({
    data: {
      name: orgName,
      slug: slugify(orgName),
      memberships: { create: { userId: user.id, role: 'owner' } },
    },
  })
  membership = await prisma.membership.findFirstOrThrow({
    where: { userId: user.id, orgId: org.id },
    include: { org: true },
  })
  console.log(`created org "${org.name}" (${org.slug})`)
} else {
  console.log(`org "${membership.org.name}" already exists`)
}

const raw = `ilp_${randomBytes(24).toString('base64url')}`
await prisma.apiToken.create({
  data: {
    orgId: membership.orgId,
    userId: user.id,
    name: 'dev-bootstrap',
    tokenHash: createHash('sha256').update(raw).digest('hex'),
    lastFour: raw.slice(-4),
  },
})
console.log(`token: ${raw}`)
process.exit(0)
