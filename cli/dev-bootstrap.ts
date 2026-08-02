// Dev-only bootstrap: ensure a user, a team, and an API token exist, and print
// the raw token for the CLI. Idempotent — safe to re-run; a fresh token is
// minted every time (old ones stay valid until revoked).
//
// The personal space needs no provisioning — it is the absence of a team — so
// the team here exists only to have something with members to click through.
//
//   bun cli/dev-bootstrap.ts [email] [password] [team-name]

import { createHash, randomBytes } from 'node:crypto'
import { auth } from '../server/auth'
import { slugify } from '../server/access'
import { prisma } from '../server/prisma'

const email = process.argv[2] ?? 'dev@handback.local'
const password = process.argv[3] ?? 'handback-dev-password'
const teamName = process.argv[4] ?? 'Dev Team'

let user = await prisma.user.findUnique({ where: { email } })
if (!user) {
  await auth.api.signUpEmail({ body: { email, password, name: email.split('@')[0] } })
  user = await prisma.user.findUniqueOrThrow({ where: { email } })
  console.log(`created user ${email} (password: ${password})`)
} else {
  console.log(`user ${email} already exists`)
}

await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true, features: ['team'] } })
console.log('platform admin + team feature enabled')

let team = await prisma.team.findFirst({ where: { ownerId: user.id } })
if (!team) {
  // Slug is globally unique; a second dev account asking for the same team name
  // gets its own team rather than being folded into someone else's.
  const base = slugify(teamName)
  let slug = base
  for (let n = 2; await prisma.team.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`
  team = await prisma.team.create({ data: { name: teamName, slug, ownerId: user.id } })
  console.log(`created team "${team.name}" (${team.slug})`)
} else {
  console.log(`team "${team.name}" already exists`)
}

// The owner holds a membership row too, so the roster is complete.
await prisma.membership.upsert({
  where: { teamId_userId: { teamId: team.id, userId: user.id } },
  update: {},
  create: { teamId: team.id, userId: user.id, role: 'admin' },
})

const raw = `hb_${randomBytes(24).toString('base64url')}`
await prisma.apiToken.create({
  data: {
    userId: user.id,
    name: 'dev-bootstrap',
    tokenHash: createHash('sha256').update(raw).digest('hex'),
    lastFour: raw.slice(-4),
  },
})
console.log(`token: ${raw}  (reaches your personal space and every team you're in)`)
console.log(`team id: ${team.id}  (bun cli/push.ts <folder> --team ${team.id})`)
process.exit(0)
