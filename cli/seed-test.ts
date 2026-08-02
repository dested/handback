// Local-only test seed: five throwaway accounts wired into three teams plus
// their personal spaces, so space scoping can be verified by logging in
// account-by-account. Idempotent — every run wipes the accounts it owns
// (email dested+test*@gmail.com) and rebuilds them from this file.
//
// Walkthroughs are DB rows only: no WalkthroughFile rows, no S3 objects. What's
// under test is who can see which row, not what plays back.
//
//   bun cli/seed-test.ts

import { createHash, randomBytes } from 'node:crypto'

const PASSWORD = 'password123'
const BASE_URL = 'http://localhost:3995'
const EMAIL_PREFIX = 'dested+test'
const EMAIL_SUFFIX = '@gmail.com'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Guard: this script deletes accounts. It runs against localhost or not at all.
// Must happen before anything imports ../server/prisma, hence the dynamic
// imports further down.
// ---------------------------------------------------------------------------

const rawDatabaseUrl = process.env.DATABASE_URL
if (!rawDatabaseUrl) fail('DATABASE_URL is not set — is .env present in the repo root?')

let dbUrl: URL
try {
  dbUrl = new URL(rawDatabaseUrl)
} catch {
  fail('DATABASE_URL is not a parseable URL — refusing to run.')
}

const host = dbUrl.hostname
if (host !== 'localhost' && host !== '127.0.0.1') {
  fail(
    `REFUSING TO RUN: DATABASE_URL points at "${host}", not localhost.\n` +
      'cli/seed-test.ts deletes users and teams. It is local-only, by design.'
  )
}

const dbName = dbUrl.pathname.replace(/^\//, '') || '(default)'
console.log(`seed-test → database "${dbName}" on ${host}\n`)

const { auth } = await import('../server/auth')
const { slugify } = await import('../server/access')
const { prisma } = await import('../server/prisma')

// ---------------------------------------------------------------------------
// The shape of the world this seed builds.
// ---------------------------------------------------------------------------

type UserKey = 'test1' | 'test2' | 'test3' | 'test4' | 'test5'
type TeamKey = 'acme' | 'northwind' | 'zenith'
/** A space is a team or one account's personal space. */
type SpaceKey = TeamKey | `personal:${UserKey}`
type MemberRole = 'admin' | 'member'
type Status = 'open' | 'in_review' | 'resolved'

type UserSpec = { key: UserKey; email: string; name: string; note: string }
type ProjectSpec = { name: string; originHints: string[] }
type TeamSpec = {
  key: TeamKey
  name: string
  ownerKey: UserKey
  seatLimit: number
  /** Members besides the owner; the owner's own row is always role 'admin'. */
  members: { key: UserKey; role: MemberRole }[]
  projects: ProjectSpec[]
}
type InviteSpec = { teamKey: TeamKey; email: string | null; role: MemberRole; createdByKey: UserKey }
type WalkthroughSpec = {
  space: SpaceKey
  title: string
  project: string | null
  status: Status
  uploaderKey: UserKey
  /** recordedAt = now − daysAgo; also drives the date half of the slug. */
  daysAgo: number
  hhmm: string
  durationMs: number
  frameCount: number
  megabytes: number
  errorCount: number
  droppedCount: number
}

const USERS: UserSpec[] = [
  {
    key: 'test1',
    email: `${EMAIL_PREFIX}1${EMAIL_SUFFIX}`,
    name: 'Test One',
    note: 'owns Acme · member of Northwind (full) · busiest personal space',
  },
  {
    key: 'test2',
    email: `${EMAIL_PREFIX}2${EMAIL_SUFFIX}`,
    name: 'Test Two',
    note: 'owns Northwind (seats full) · admin of Acme · one lonely personal walkthrough',
  },
  {
    key: 'test3',
    email: `${EMAIL_PREFIX}3${EMAIL_SUFFIX}`,
    name: 'Test Three',
    note: 'owns Zenith (solo, two pending invites) · member of Acme · empty personal space',
  },
  {
    key: 'test4',
    email: `${EMAIL_PREFIX}4${EMAIL_SUFFIX}`,
    name: 'Test Four',
    note: 'admin of Northwind only · must never see Acme or Zenith',
  },
  {
    key: 'test5',
    email: `${EMAIL_PREFIX}5${EMAIL_SUFFIX}`,
    name: 'Test Five',
    note: 'no teams, empty personal space — the fresh-account state, plus a Zenith invite waiting',
  },
]

const TEAMS: TeamSpec[] = [
  {
    key: 'acme',
    name: 'Acme',
    ownerKey: 'test1',
    seatLimit: 5,
    members: [
      { key: 'test2', role: 'admin' },
      { key: 'test3', role: 'member' },
    ],
    projects: [
      { name: 'Storefront', originHints: ['https://acme.example.com'] },
      { name: 'Billing', originHints: [] },
    ],
  },
  {
    key: 'northwind',
    name: 'Northwind',
    ownerKey: 'test2',
    // 3 seats, 3 members — deliberately full, so the Team page shows the
    // seat-full state and invites.create refuses.
    seatLimit: 3,
    members: [
      { key: 'test4', role: 'admin' },
      { key: 'test1', role: 'member' },
    ],
    projects: [
      { name: 'Web', originHints: [] },
      { name: 'API', originHints: [] },
    ],
  },
  {
    key: 'zenith',
    name: 'Zenith',
    ownerKey: 'test3',
    seatLimit: 5,
    members: [],
    projects: [{ name: 'Skunkworks', originHints: [] }],
  },
]

const PERSONAL_PROJECTS: { ownerKey: UserKey; projects: ProjectSpec[] }[] = [
  {
    ownerKey: 'test1',
    projects: [
      { name: 'Sidecar', originHints: [] },
      { name: 'Notes', originHints: [] },
    ],
  },
  {
    ownerKey: 'test4',
    projects: [
      { name: 'Homelab', originHints: [] },
      { name: 'Recipes', originHints: [] },
    ],
  },
]

const INVITES: InviteSpec[] = [
  {
    teamKey: 'zenith',
    email: `${EMAIL_PREFIX}5${EMAIL_SUFFIX}`,
    role: 'member',
    createdByKey: 'test3',
  },
  { teamKey: 'zenith', email: null, role: 'member', createdByKey: 'test3' },
]

const WALKTHROUGHS: WalkthroughSpec[] = [
  // Acme
  {
    space: 'acme',
    title: 'Checkout double-charges on retry',
    project: 'Storefront',
    status: 'open',
    uploaderKey: 'test3',
    daysAgo: 1,
    hhmm: '0914',
    durationMs: 184_000,
    frameCount: 96,
    megabytes: 22,
    errorCount: 3,
    droppedCount: 1,
  },
  {
    space: 'acme',
    title: 'Promo code applies to nothing',
    project: 'Storefront',
    status: 'in_review',
    uploaderKey: 'test2',
    daysAgo: 3,
    hhmm: '1602',
    durationMs: 121_000,
    frameCount: 64,
    megabytes: 13,
    errorCount: 1,
    droppedCount: 0,
  },
  {
    space: 'acme',
    title: 'Invoice PDF clips the footer',
    project: 'Billing',
    status: 'resolved',
    uploaderKey: 'test1',
    daysAgo: 7,
    hhmm: '1128',
    durationMs: 76_000,
    frameCount: 44,
    megabytes: 7,
    errorCount: 0,
    droppedCount: 0,
  },
  {
    space: 'acme',
    title: 'Search dies on emoji',
    project: null,
    status: 'open',
    uploaderKey: 'test1',
    daysAgo: 9,
    hhmm: '2041',
    durationMs: 233_000,
    frameCount: 118,
    megabytes: 31,
    errorCount: 2,
    droppedCount: 1,
  },
  // Northwind
  {
    space: 'northwind',
    title: 'Nav flickers on route change',
    project: 'Web',
    status: 'open',
    uploaderKey: 'test4',
    daysAgo: 2,
    hhmm: '1347',
    durationMs: 63_000,
    frameCount: 41,
    megabytes: 6,
    errorCount: 0,
    droppedCount: 0,
  },
  {
    space: 'northwind',
    title: '429s hammer the sync endpoint',
    project: 'API',
    status: 'in_review',
    uploaderKey: 'test2',
    daysAgo: 5,
    hhmm: '0822',
    durationMs: 297_000,
    frameCount: 149,
    megabytes: 39,
    errorCount: 3,
    droppedCount: 0,
  },
  {
    space: 'northwind',
    title: 'Login loops on expired session',
    project: null,
    status: 'open',
    uploaderKey: 'test1',
    daysAgo: 8,
    hhmm: '1735',
    durationMs: 142_000,
    frameCount: 73,
    megabytes: 16,
    errorCount: 2,
    droppedCount: 1,
  },
  // Zenith
  {
    space: 'zenith',
    title: 'Onboarding stalls at step 3',
    project: 'Skunkworks',
    status: 'open',
    uploaderKey: 'test3',
    daysAgo: 4,
    hhmm: '1019',
    durationMs: 158_000,
    frameCount: 82,
    megabytes: 19,
    errorCount: 1,
    droppedCount: 0,
  },
  // Personal — test1
  {
    space: 'personal:test1',
    title: "Sidecar panel won't dock",
    project: 'Sidecar',
    status: 'open',
    uploaderKey: 'test1',
    daysAgo: 2,
    hhmm: '2213',
    durationMs: 91_000,
    frameCount: 52,
    megabytes: 9,
    errorCount: 1,
    droppedCount: 0,
  },
  {
    space: 'personal:test1',
    title: 'Note editor eats newlines',
    project: 'Notes',
    status: 'in_review',
    uploaderKey: 'test1',
    daysAgo: 6,
    hhmm: '0755',
    durationMs: 204_000,
    frameCount: 107,
    megabytes: 27,
    errorCount: 0,
    droppedCount: 0,
  },
  {
    space: 'personal:test1',
    title: 'Font renders fuzzy on 4k',
    project: null,
    status: 'resolved',
    uploaderKey: 'test1',
    daysAgo: 10,
    hhmm: '1441',
    durationMs: 68_000,
    frameCount: 40,
    megabytes: 5,
    errorCount: 0,
    droppedCount: 0,
  },
  // Personal — test2
  {
    space: 'personal:test2',
    title: 'Draft mode loses tags',
    project: null,
    status: 'open',
    uploaderKey: 'test2',
    daysAgo: 3,
    hhmm: '1858',
    durationMs: 112_000,
    frameCount: 59,
    megabytes: 11,
    errorCount: 2,
    droppedCount: 0,
  },
  // Personal — test4
  {
    space: 'personal:test4',
    title: 'Grafana panel blank',
    project: 'Homelab',
    status: 'open',
    uploaderKey: 'test4',
    daysAgo: 1,
    hhmm: '2330',
    durationMs: 133_000,
    frameCount: 70,
    megabytes: 14,
    errorCount: 3,
    droppedCount: 1,
  },
  {
    space: 'personal:test4',
    title: 'Print view overflows',
    project: 'Recipes',
    status: 'resolved',
    uploaderKey: 'test4',
    daysAgo: 9,
    hhmm: '0630',
    durationMs: 87_000,
    frameCount: 47,
    megabytes: 8,
    errorCount: 0,
    droppedCount: 0,
  },
]

// ---------------------------------------------------------------------------
// Wipe. Owned teams go first — Team.owner is onDelete: Restrict, so a user with
// a team can't be deleted until the team is. Everything else cascades.
// ---------------------------------------------------------------------------

const seedEmails = USERS.map((u) => u.email)

const existing = await prisma.user.findMany({
  where: { email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_SUFFIX } },
  select: { id: true, email: true },
})

if (existing.length === 0) {
  console.log('wipe: no previous seed accounts found\n')
} else {
  const existingIds = existing.map((u) => u.id)
  const ownedTeams = await prisma.team.findMany({
    where: { ownerId: { in: existingIds } },
    select: { id: true, name: true },
  })
  if (ownedTeams.length > 0) {
    await prisma.team.deleteMany({ where: { id: { in: ownedTeams.map((t) => t.id) } } })
  }
  // Invites addressed to a seed account inside somebody else's team would
  // otherwise survive as orphans pointing at a deleted invitee.
  const strayInvites = await prisma.invite.deleteMany({ where: { email: { in: seedEmails } } })
  await prisma.user.deleteMany({ where: { id: { in: existingIds } } })

  console.log('wipe:')
  console.log(`  teams deleted:   ${ownedTeams.map((t) => t.name).join(', ') || '(none)'}`)
  console.log(`  users deleted:   ${existing.map((u) => u.email).join(', ')}`)
  console.log(`  stray invites:   ${strayInvites.count}`)
  console.log('')
}

// ---------------------------------------------------------------------------
// Users. Signed up through better-auth so the credential account row is built
// exactly the way a real sign-up builds it.
// ---------------------------------------------------------------------------

const userIds = new Map<UserKey, string>()
const userEmails = new Map<UserKey, string>()

for (const spec of USERS) {
  await auth.api.signUpEmail({ body: { email: spec.email, password: PASSWORD, name: spec.name } })
  const user = await prisma.user.update({
    where: { email: spec.email },
    // `team` entitlement so the team UI is reachable for every seed account.
    data: { emailVerified: true, features: ['team'] },
  })
  userIds.set(spec.key, user.id)
  userEmails.set(spec.key, user.email)
  console.log(`user: ${spec.email}  (${spec.name})`)
}
console.log('')

function userId(key: UserKey): string {
  const id = userIds.get(key)
  if (!id) throw new Error(`user ${key} was never created`)
  return id
}

// ---------------------------------------------------------------------------
// Teams, memberships, projects.
// ---------------------------------------------------------------------------

async function freeTeamSlug(name: string): Promise<string> {
  const base = slugify(name)
  let slug = base
  for (let n = 2; await prisma.team.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`
  return slug
}

const teamIds = new Map<TeamKey, string>()
/** Keyed `${SpaceKey}::${projectName}`. */
const projectIds = new Map<string, string>()

function teamId(key: TeamKey): string {
  const id = teamIds.get(key)
  if (!id) throw new Error(`team ${key} was never created`)
  return id
}

/** The ownership pair a Project/Walkthrough row carries for a space. */
function spaceOwner(space: SpaceKey): { teamId: string | null; userId: string | null } {
  if (space.startsWith('personal:')) {
    const key = space.slice('personal:'.length) as UserKey
    return { teamId: null, userId: userId(key) }
  }
  return { teamId: teamId(space as TeamKey), userId: null }
}

async function createProjects(space: SpaceKey, projects: ProjectSpec[]): Promise<void> {
  for (const p of projects) {
    const created = await prisma.project.create({
      data: { ...spaceOwner(space), name: p.name, slug: slugify(p.name), originHints: p.originHints },
    })
    projectIds.set(`${space}::${p.name}`, created.id)
  }
}

for (const spec of TEAMS) {
  const team = await prisma.team.create({
    data: {
      name: spec.name,
      slug: await freeTeamSlug(spec.name),
      ownerId: userId(spec.ownerKey),
      seatLimit: spec.seatLimit,
    },
  })
  teamIds.set(spec.key, team.id)

  // The owner holds a membership row too, so the roster is complete.
  await prisma.membership.create({
    data: { teamId: team.id, userId: userId(spec.ownerKey), role: 'admin' },
  })
  for (const m of spec.members) {
    await prisma.membership.create({
      data: { teamId: team.id, userId: userId(m.key), role: m.role },
    })
  }
  await createProjects(spec.key, spec.projects)

  const seats = spec.members.length + 1
  console.log(
    `team: ${spec.name} (${team.slug}) — owner ${spec.ownerKey}, ${seats}/${spec.seatLimit} seats` +
      (seats >= spec.seatLimit ? '  [FULL]' : '')
  )
}

for (const { ownerKey, projects } of PERSONAL_PROJECTS) {
  await createProjects(`personal:${ownerKey}`, projects)
}
console.log('')

// ---------------------------------------------------------------------------
// Invites. The row id IS the join-link token.
// ---------------------------------------------------------------------------

const inviteLinks: { label: string; url: string }[] = []
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

for (const spec of INVITES) {
  const invite = await prisma.invite.create({
    data: {
      teamId: teamId(spec.teamKey),
      email: spec.email,
      role: spec.role,
      createdById: userId(spec.createdByKey),
      expiresAt: new Date(Date.now() + WEEK_MS),
    },
  })
  const team = TEAMS.find((t) => t.key === spec.teamKey)
  inviteLinks.push({
    label: `${team?.name ?? spec.teamKey} → ${spec.email ?? 'OPEN LINK (any account)'} (${spec.role})`,
    url: `${BASE_URL}/join/${invite.id}`,
  })
}

// ---------------------------------------------------------------------------
// Walkthroughs. Finalized, one take each, no files.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

function recordedAtFor(spec: WalkthroughSpec): Date {
  const d = new Date(Date.now() - spec.daysAgo * DAY_MS)
  const hours = Number(spec.hhmm.slice(0, 2))
  const minutes = Number(spec.hhmm.slice(2))
  d.setHours(hours, minutes, 0, 0)
  return d
}

function walkthroughSlug(spec: WalkthroughSpec, recordedAt: Date): string {
  const y = recordedAt.getFullYear()
  const m = String(recordedAt.getMonth() + 1).padStart(2, '0')
  const day = String(recordedAt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}-${spec.hhmm}-${slugify(spec.title)}`
}

for (const spec of WALKTHROUGHS) {
  const recordedAt = recordedAtFor(spec)
  const projectId = spec.project ? (projectIds.get(`${spec.space}::${spec.project}`) ?? null) : null
  if (spec.project && !projectId) {
    throw new Error(`project "${spec.project}" not found in space ${spec.space}`)
  }
  const originHint = spec.project
    ? (TEAMS.flatMap((t) => t.projects).find((p) => p.name === spec.project)?.originHints[0] ?? null)
    : null

  await prisma.walkthrough.create({
    data: {
      ...spaceOwner(spec.space),
      projectId,
      slug: walkthroughSlug(spec, recordedAt),
      title: spec.title,
      origin: originHint,
      status: spec.status,
      recordedAt,
      uploadedAt: new Date(recordedAt.getTime() + 60_000),
      uploadedById: userId(spec.uploaderKey),
      durationMs: spec.durationMs,
      frameCount: spec.frameCount,
      errorCount: spec.errorCount,
      droppedCount: spec.droppedCount,
      bytes: BigInt(spec.megabytes) * 1024n * 1024n,
      // Unfinalized walkthroughs are invisible by design; every seed row is done.
      finalizedAt: new Date(recordedAt.getTime() + 120_000),
      resolvedAt: spec.status === 'resolved' ? new Date(recordedAt.getTime() + DAY_MS) : null,
      takes: {
        create: {
          index: 1,
          dir: 'rec-01',
          interrupted: false,
          startedAt: recordedAt,
          durationMs: spec.durationMs,
          frameCount: spec.frameCount,
        },
      },
    },
  })
}
console.log(`walkthroughs: ${WALKTHROUGHS.length} created (no files, no S3 objects)\n`)

// ---------------------------------------------------------------------------
// API tokens — minted the same way router.ts tokens.create mints them.
// ---------------------------------------------------------------------------

const rawTokens = new Map<UserKey, string>()

for (const spec of USERS) {
  const raw = `hb_${randomBytes(24).toString('base64url')}`
  await prisma.apiToken.create({
    data: {
      userId: userId(spec.key),
      name: 'seed',
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      lastFour: raw.slice(-4),
    },
  })
  rawTokens.set(spec.key, raw)
}

// ---------------------------------------------------------------------------
// Output. This is what the verification pass is checked against.
// ---------------------------------------------------------------------------

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  )
  const line = (cells: string[]): string =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ').trimEnd()
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

function heading(text: string): void {
  console.log(`\n${'='.repeat(78)}\n${text}\n${'='.repeat(78)}`)
}

function teamsFor(key: UserKey): TeamSpec[] {
  return TEAMS.filter((t) => t.ownerKey === key || t.members.some((m) => m.key === key))
}

function roleIn(team: TeamSpec, key: UserKey): 'owner' | MemberRole | null {
  if (team.ownerKey === key) return 'owner'
  return team.members.find((m) => m.key === key)?.role ?? null
}

function walkthroughsIn(space: SpaceKey): WalkthroughSpec[] {
  return WALKTHROUGHS.filter((w) => w.space === space)
}

function seatsUsed(team: TeamSpec): number {
  return team.members.length + 1
}

function isFull(team: TeamSpec): boolean {
  return seatsUsed(team) >= team.seatLimit
}

heading('1. CREDENTIALS  (all passwords the same, all emails pre-verified)')
console.log(
  table(
    ['EMAIL', 'PASSWORD', 'WHAT THEY ARE'],
    USERS.map((u) => [u.email, PASSWORD, u.note])
  )
)

heading('2. TEAM MATRIX')
console.log(
  table(
    ['TEAM', 'OWNER', 'MEMBERS (role)', 'SEATS', 'PROJECTS', 'WALKS'],
    TEAMS.map((t) => [
      t.name,
      t.ownerKey,
      [`${t.ownerKey}:owner`, ...t.members.map((m) => `${m.key}:${m.role}`)].join(' '),
      `${seatsUsed(t)}/${t.seatLimit}${isFull(t) ? ' FULL' : ''}`,
      t.projects.map((p) => p.name).join(', ') || '(none)',
      String(walkthroughsIn(t.key).length),
    ])
  )
)
console.log('\nPersonal spaces:')
console.log(
  table(
    ['USER', 'PROJECTS', 'WALKS'],
    USERS.map((u) => {
      const projects = PERSONAL_PROJECTS.find((p) => p.ownerKey === u.key)?.projects ?? []
      return [
        u.key,
        projects.map((p) => p.name).join(', ') || '(none)',
        String(walkthroughsIn(`personal:${u.key}`).length),
      ]
    })
  )
)

heading('3. INVITE LINKS  (7-day expiry)')
for (const link of inviteLinks) {
  console.log(`  ${link.label}`)
  console.log(`    ${link.url}`)
}

heading('4. API TOKENS  (name "seed" — shown once, here)')
console.log(
  table(
    ['EMAIL', 'TOKEN'],
    USERS.map((u) => [u.email, rawTokens.get(u.key) ?? '(missing)'])
  )
)

heading('5. EXPECTED VISIBILITY  (the cheat sheet to verify against)')
for (const u of USERS) {
  const teams = teamsFor(u.key)
  const personal = walkthroughsIn(`personal:${u.key}`)
  const reachable = personal.length + teams.reduce((n, t) => n + walkthroughsIn(t.key).length, 0)

  console.log(`\n--- ${u.email}  (${u.name}) ---`)
  console.log(`  Space switcher shows: Personal${teams.map((t) => ` + ${t.name}`).join('')}`)

  console.log(`  Personal inbox — ${personal.length} walkthrough(s):`)
  for (const w of personal) {
    console.log(`      • ${w.title}  [${w.status}${w.project ? ` · ${w.project}` : ' · no project'}]`)
  }
  if (personal.length === 0) console.log('      (empty — nothing at all, not even a project)')

  for (const t of teams) {
    const rows = walkthroughsIn(t.key)
    console.log(`  ${t.name} inbox — ${rows.length} walkthrough(s), role ${roleIn(t, u.key)}:`)
    for (const w of rows) {
      console.log(
        `      • ${w.title}  [${w.status}${w.project ? ` · ${w.project}` : ' · no project'}]`
      )
    }
    console.log(
      `    Team tab: ${seatsUsed(t)}/${t.seatLimit} seats` +
        (isFull(t)
          ? ' — MUST show the seat-full line; the invite form must refuse to create.'
          : ' — invite form available.')
    )
  }
  if (teams.length === 0) {
    console.log('  No team rows anywhere: no Team tab, no team in the switcher.')
  }

  const hidden = TEAMS.filter((t) => !teams.includes(t)).map((t) => t.name)
  console.log(
    `  NEGATIVE: ${u.key} must NOT see ${hidden.length ? hidden.join(' or ') : 'any team'} ` +
      'anywhere (switcher, /teams, direct URL by id — expect FORBIDDEN), and must not see any ' +
      "other account's personal walkthroughs."
  )
  console.log(
    `  MCP token: listing gripes with this token must return exactly ${reachable} walkthrough(s) ` +
      `(${personal.length} personal + ${reachable - personal.length} across ${teams.length} team(s)).`
  )
  if (u.key === 'test5') {
    const addressed = inviteLinks[0]
    console.log(
      `  Fresh-account check: empty personal space, zero teams. Opening ${addressed?.url ?? '(invite)'} ` +
        'while signed in as test5 must join Zenith as member (the address is bound to this account); ' +
        'the open link must work for anyone. After accepting, Zenith seats read 2/5.'
    )
  }
}

console.log('\nAll walkthroughs are finalized DB rows with no files — the viewer will show an')
console.log('empty file set. Scoping is what is under test, not playback.\n')

process.exit(0)
