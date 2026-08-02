// One-shot migration: workspaces are gone.
//
//   bun cli/migrate-teams.ts          (then: bun run db:push)
//
// `org` becomes `team`. Personal orgs dissolve — their projects and walkthroughs
// reparent to the owning user (`team_id NULL, user_id = owner`), and their S3
// objects are copied from orgs/<personalOrgId>/… to orgs/<ownerUserId>/… because
// the key's space segment is now `teamId ?? userId`. Guests (membership.scope =
// 'projects') become full members, project_access dies, and api_token loses its
// org — tokens are user-scoped now.
//
// Raw SQL only. This runs against the OLD columns, before `db push` reconciles
// the schema, so the Prisma model API would be talking about a shape the database
// does not have yet. Every statement is guarded (IF EXISTS / column probes) so a
// crashed run can be re-run: the script resumes wherever it stopped.

import { copyObject, deletePrefix, walkthroughKey, walkthroughPrefix } from '../server/storage'
import { prisma } from '../server/prisma'

/** Anything that can run a raw statement — the client or a transaction handle. */
type RawExec = { $executeRawUnsafe: (sql: string) => Promise<number> }

const S3_COPY_CONCURRENCY = 8

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ reg: string | null }[]>(
    `SELECT to_regclass('public.${name}')::text AS reg`
  )
  return (rows[0]?.reg ?? null) !== null
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`
  )
  return Number(rows[0]?.n ?? 0) > 0
}

/**
 * Which column currently points at the space on `table`. A resumed run may find
 * the rename already done, so every statement written before the rename step has
 * to ask rather than assume.
 */
async function spaceCol(table: string): Promise<'team_id' | 'org_id'> {
  return (await columnExists(table, 'team_id')) ? 'team_id' : 'org_id'
}

/** `current` is probed before the transaction opens — a resumed run finds it already renamed. */
async function renameSpaceCol(tx: RawExec, table: string, current: string): Promise<void> {
  if (current !== 'org_id') return
  await tx.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME COLUMN "org_id" TO "team_id"`)
  console.log(`  ${table}.org_id → ${table}.team_id`)
}

async function count(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql)
  return Number(rows[0]?.n ?? 0)
}

// ── Guard ────────────────────────────────────────────────────────────────────

const orgExists = await tableExists('org')
const teamExists = await tableExists('team')

if (!orgExists && !teamExists) {
  console.error('migrate-teams: neither "org" nor "team" exists — is DATABASE_URL pointing at a')
  console.error('               Handback database? Nothing was changed.')
  process.exit(1)
}
if (!orgExists && teamExists && !(await columnExists('team', 'personal'))) {
  console.log('migrate-teams: already migrated (team exists, no personal flag). Nothing to do.')
  process.exit(0)
}
if (!orgExists) {
  console.log('migrate-teams: resuming an interrupted run (team exists, personal flag still there)')
}

const summary = {
  teamsKept: 0,
  ownerlessTeamsDeleted: 0,
  personalDissolved: 0,
  walkthroughsReparented: 0,
  projectsReparented: 0,
  s3Copied: 0,
  s3Failed: 0,
  guestsPromoted: 0,
  ownerRolesNormalized: 0,
  tokensDeOrged: 0,
}
const s3Failures: string[] = []

// ── Transaction 1: structural, non-destructive ───────────────────────────────

console.log('\n[1/3] structure')

// Resolved before the renames run, because these statements execute inside the
// same transaction that renames them.
const membershipSpace = await spaceCol('membership')
const inviteSpace = await spaceCol('invite')
const projectSpace = await spaceCol('project')
const walkthroughSpace = await spaceCol('walkthrough')

const ownerless = orgExists
  ? await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT o."id", o."name" FROM "org" o
        WHERE NOT EXISTS (SELECT 1 FROM "membership" m WHERE m."${membershipSpace}" = o."id")`
    )
  : await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT t."id", t."name" FROM "team" t
        WHERE NOT EXISTS (SELECT 1 FROM "membership" m WHERE m."${membershipSpace}" = t."id")`
    )

await prisma.$transaction(
  async (tx) => {
    if (orgExists && !teamExists) {
      await tx.$executeRawUnsafe(`ALTER TABLE "org" RENAME TO "team"`)
      console.log('  org → team')
    }

    await tx.$executeRawUnsafe(`ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "owner_id" TEXT`)
    await tx.$executeRawUnsafe(
      `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "seat_limit" INTEGER NOT NULL DEFAULT 5`
    )

    // A team with no members has no one to hand it to, and nothing in the new
    // model can address it. Dependent rows go first — the FKs cascade, but only
    // if they were created with ON DELETE CASCADE, and a hand-patched prod
    // database is not the place to find out.
    if (ownerless.length > 0) {
      const ids = ownerless.map((o) => `'${o.id}'`).join(', ')
      for (const o of ownerless) console.log(`  dropping memberless team "${o.name}" (${o.id})`)
      await tx.$executeRawUnsafe(`DELETE FROM "walkthrough" WHERE "${walkthroughSpace}" IN (${ids})`)
      await tx.$executeRawUnsafe(`DELETE FROM "project" WHERE "${projectSpace}" IN (${ids})`)
      await tx.$executeRawUnsafe(`DELETE FROM "invite" WHERE "${inviteSpace}" IN (${ids})`)
      summary.ownerlessTeamsDeleted = await tx.$executeRawUnsafe(
        `DELETE FROM "team" WHERE "id" IN (${ids})`
      )
    }

    // Owner backfill: the role='owner' membership if there is one, else the
    // earliest member. DISTINCT ON picks exactly one row per team, so a database
    // that somehow holds two owners still resolves.
    await tx.$executeRawUnsafe(
      `UPDATE "team" t SET "owner_id" = s."user_id"
         FROM (
           SELECT DISTINCT ON (m."${membershipSpace}")
                  m."${membershipSpace}" AS team_id, m."user_id"
             FROM "membership" m
            ORDER BY m."${membershipSpace}", (m."role" = 'owner') DESC, m."created_at" ASC
         ) s
        WHERE s."team_id" = t."id" AND t."owner_id" IS NULL`
    )

    await renameSpaceCol(tx, 'membership', membershipSpace)
    await renameSpaceCol(tx, 'invite', inviteSpace)
    await renameSpaceCol(tx, 'project', projectSpace)
    await renameSpaceCol(tx, 'walkthrough', walkthroughSpace)

    for (const table of ['project', 'walkthrough']) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "team_id" DROP NOT NULL`)
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "user_id" TEXT`)
    }
  },
  { timeout: 120_000, maxWait: 30_000 }
)

const stillNull = await count(`SELECT count(*) AS n FROM "team" WHERE "owner_id" IS NULL`)
if (stillNull > 0) {
  console.error(`migrate-teams: ${stillNull} team(s) still have no owner_id after backfill.`)
  console.error('               Refusing to continue — inspect them before re-running.')
  process.exit(1)
}

// ── S3: personal objects move to the owner's prefix ──────────────────────────

console.log('\n[2/3] S3')

const personalWalkthroughs = await prisma.$queryRawUnsafe<
  { wid: string; tid: string; uid: string }[]
>(
  `SELECT w."id" AS wid, t."id" AS tid, t."owner_id" AS uid
     FROM "walkthrough" w JOIN "team" t ON w."team_id" = t."id"
    WHERE t."personal"`
)

if (personalWalkthroughs.length === 0) {
  console.log('  no personal walkthroughs — nothing to copy')
} else {
  console.log(`  ${personalWalkthroughs.length} personal walkthrough(s) to re-prefix`)
  for (const { wid, tid, uid } of personalWalkthroughs) {
    try {
      const files = await prisma.$queryRawUnsafe<{ path: string }[]>(
        `SELECT "path" FROM "walkthrough_file" WHERE "walkthrough_id" = $1 AND "status" = 'uploaded'`,
        wid
      )
      const paths = files.map((f) => f.path)
      // Server-side copies, the same batch size the old moveToOrg used.
      for (let i = 0; i < paths.length; i += S3_COPY_CONCURRENCY) {
        await Promise.all(
          paths
            .slice(i, i + S3_COPY_CONCURRENCY)
            .map((path) =>
              copyObject(walkthroughKey(tid, wid, path), walkthroughKey(uid, wid, path))
            )
        )
      }
      await deletePrefix(walkthroughPrefix(tid, wid))
      summary.s3Copied += paths.length
      console.log(`  ${wid}: ${paths.length} object(s) → orgs/${uid}/gripes/${wid}/`)
    } catch (err) {
      // A dev database routinely references objects that were never uploaded.
      // The row still has to reparent, so log and keep going — the loud summary
      // at the end is what a prod run reads.
      summary.s3Failed++
      s3Failures.push(`${wid} (org ${tid} → user ${uid}): ${String(err)}`)
      console.warn(`  WARN ${wid}: S3 move failed — ${String(err)}`)
    }
  }
}

// ── Transaction 2: reparent + drop the old model ─────────────────────────────

console.log('\n[3/3] reparent + cleanup')

summary.personalDissolved = await count(`SELECT count(*) AS n FROM "team" WHERE "personal"`)
summary.teamsKept = await count(`SELECT count(*) AS n FROM "team" WHERE NOT "personal"`)
summary.tokensDeOrged = (await columnExists('api_token', 'org_id'))
  ? await count(`SELECT count(*) AS n FROM "api_token" WHERE "org_id" IS NOT NULL`)
  : 0

const hasScope = await columnExists('membership', 'scope')

await prisma.$transaction(
  async (tx) => {
    summary.walkthroughsReparented = await tx.$executeRawUnsafe(
      `UPDATE "walkthrough" w SET "user_id" = t."owner_id", "team_id" = NULL
         FROM "team" t WHERE w."team_id" = t."id" AND t."personal"`
    )
    summary.projectsReparented = await tx.$executeRawUnsafe(
      `UPDATE "project" p SET "user_id" = t."owner_id", "team_id" = NULL
         FROM "team" t WHERE p."team_id" = t."id" AND t."personal"`
    )

    // Guests lose their project scoping and become ordinary members.
    if (hasScope) {
      summary.guestsPromoted = await tx.$executeRawUnsafe(
        `UPDATE "membership" SET "role" = 'member' WHERE "scope" = 'projects'`
      )
    }
    // Ownership is Team.owner_id now; membership.role is admin | member only.
    summary.ownerRolesNormalized = await tx.$executeRawUnsafe(
      `UPDATE "membership" SET "role" = 'admin' WHERE "role" = 'owner'`
    )

    await tx.$executeRawUnsafe(
      `DELETE FROM "invite" WHERE "team_id" IN (SELECT "id" FROM "team" WHERE "personal")`
    )
    await tx.$executeRawUnsafe(
      `DELETE FROM "membership" WHERE "team_id" IN (SELECT "id" FROM "team" WHERE "personal")`
    )

    await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "project_access"`)
    await tx.$executeRawUnsafe(`ALTER TABLE "membership" DROP COLUMN IF EXISTS "scope"`)
    await tx.$executeRawUnsafe(`ALTER TABLE "invite" DROP COLUMN IF EXISTS "project_id"`)
    // Dropped before the personal teams are deleted: the column carries an FK
    // with ON DELETE CASCADE, so deleting first would take the tokens with it.
    await tx.$executeRawUnsafe(`ALTER TABLE "api_token" DROP COLUMN IF EXISTS "org_id"`)

    await tx.$executeRawUnsafe(`DELETE FROM "team" WHERE "personal"`)
    await tx.$executeRawUnsafe(`ALTER TABLE "team" DROP COLUMN IF EXISTS "personal"`)
    await tx.$executeRawUnsafe(`ALTER TABLE "team" ALTER COLUMN "owner_id" SET NOT NULL`)

    // Uniques Postgres kept under their old names through the column rename.
    // Left in place, `db push` would drop and recreate them — and the new schema
    // has no unique at all on (space, slug), so leaving them would reject the
    // legitimate duplicates the personal/team split now allows.
    const staleUniques: [table: string, name: string][] = [
      ['walkthrough', 'walkthrough_org_id_slug_key'],
      ['walkthrough', 'walkthrough_team_id_slug_key'],
      ['project', 'project_org_id_slug_key'],
      ['project', 'project_team_id_slug_key'],
      ['membership', 'membership_org_id_user_id_key'],
    ]
    for (const [table, name] of staleUniques) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`)
      await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`)
    }
  },
  { timeout: 120_000, maxWait: 30_000 }
)

// ── Summary ──────────────────────────────────────────────────────────────────

const rows: [string, number][] = [
  ['teams kept', summary.teamsKept],
  ['memberless teams deleted', summary.ownerlessTeamsDeleted],
  ['personal orgs dissolved', summary.personalDissolved],
  ['walkthroughs reparented', summary.walkthroughsReparented],
  ['projects reparented', summary.projectsReparented],
  ['S3 objects copied', summary.s3Copied],
  ['S3 walkthroughs failed', summary.s3Failed],
  ['guests promoted to member', summary.guestsPromoted],
  ['owner memberships → admin', summary.ownerRolesNormalized],
  ['tokens de-org’d', summary.tokensDeOrged],
]
const width = Math.max(...rows.map(([label]) => label.length))
console.log('\n─── migration summary ───')
for (const [label, n] of rows) console.log(`  ${label.padEnd(width)}  ${n}`)

if (summary.ownerlessTeamsDeleted > 0) {
  console.log(
    `\nNote: ${summary.ownerlessTeamsDeleted} memberless team(s) were deleted with their rows;`
  )
  console.log('      any S3 objects under their orgs/<id>/ prefixes are now orphaned. Ids above.')
}

if (s3Failures.length > 0) {
  console.log('\n!!! S3 MOVES THAT FAILED — these walkthroughs reparented in the database but')
  console.log('!!! their objects are still under the old personal-org prefix:')
  for (const f of s3Failures) console.log(`  - ${f}`)
}

console.log('\nNow run: bun run db:push')
process.exit(0)
