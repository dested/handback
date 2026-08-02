# Teams restructure — workspaces are gone

- **Date:** 2026-08-01
- **Status:** active
- **Type:** plan
- **What:** Remove the workspace/Org concept entirely. A user has one implicit Personal space + zero or more Teams. Owner-approved decisions: true DB restructure (personal = `teamId: null`, owned by user), user-scoped tokens, seats/ownership modeled now (Stripe later), guests dropped.

## Target model

- **Team** (renamed from Org): `id, name, slug @unique, ownerId (owner_id → User, Restrict), seatLimit @default(5), createdAt`. `personal` flag deleted. Owner is authoritative on `Team.ownerId` (transferable via `teams.transferOwnership`); the owner also holds a Membership row (role `admin`). Effective role = `ownerId === userId ? 'owner' : membership.role`.
- **Membership**: `teamId, userId, role ('admin'|'member', default member), createdAt`. `scope` and ProjectAccess are deleted — no guests. `@@unique([teamId, userId])`.
- **Invite**: `teamId`, no `projectId`. Seat enforcement: members + pending invites must stay < seatLimit.
- **Project / Walkthrough**: ownership pair `teamId String?` + `userId String?` — exactly one set (code-enforced invariant). `userId` set = someone's personal space. Slug uniqueness per space is **code-enforced** (`findFirst` + suffix loop); the DB unique `(orgId, slug)` goes away because Prisma can't express partial uniques over a nullable pair.
- **ApiToken**: `orgId` dropped — a token is the user. Reaches personal + every team they're in. Platform-admin tokens still reach everything.
- **S3 keys**: `orgs/<spaceId>/gripes/<id>/<path>` where `spaceId = teamId ?? userId`. Team ids don't change in migration so team objects stay put; personal objects get copied `orgs/<personalOrgId>/…` → `orgs/<ownerUserId>/…` by the migration script.

## Server contracts (pinned)

- `server/access.ts` (replaces membership.ts): `Role = 'owner'|'admin'|'member'`; `requireTeamRole(userId, teamId, atLeast='member') → Role`; `requireSpaceAccess(userId, space: {teamId: string|null, userId: string|null}, atLeast)` — personal spaces admit only their owner (any atLeast passes for the owner); `requireViewAccess` keeps the platform-admin read-only bypass; `slugify` stays.
- `TokenAuth = { userId, tokenId, isAdmin }`; walkthroughs-api scope = `isAdmin ? {} : OR [{userId}, {teamId in memberTeamIds}]`.
- tRPC space input everywhere: `teamId: z.string().nullable()` — null = caller's personal.
- Routers: `orgs` → `teams` (mine, entitlements, create, rename, members, setRole, removeMember, transferOwnership); `invites` (teamId, seat-capped, no projectId); `tokens` (no orgId anywhere); `projects` + `walkthroughs` take `teamId|null`; `walkthroughs.move({walkthroughId, teamId|null})` replaces moveToOrg. `orgs.ensurePersonal` + `server/orgs.ts` + the sign-up hook are deleted — nothing to provision.
- Ingest: declare gains optional `teamId` (absent = personal); `/context` returns `{ user, personal: {projects}, teams: [{id,name,slug,projects}] }`; `GET /walkthroughs?team=personal|<id>` filters, unfiltered = everything the token reaches; list/brief field `workspace` → `space` ("Personal" or team name).

## Migration (`cli/migrate-teams.ts`, raw SQL + S3, runnable on any DATABASE_URL)

1. `org` → `team`; add `owner_id` (backfill from owner membership, else earliest member), `seat_limit`.
2. Rename `org_id` → `team_id` on membership/invite/project/walkthrough; make project/walkthrough `team_id` nullable; add `user_id`.
3. Personal reparent: walkthroughs/projects of `personal` teams get `user_id = owner`, `team_id = NULL`; S3 prefixes copied to the user id, old deleted.
4. Guests: `UPDATE membership SET role='member' WHERE scope='projects'`; `DROP TABLE project_access`; drop `membership.scope`, `invite.project_id`, `api_token.org_id`.
5. Delete personal team rows + memberships; drop `team.personal`; `owner_id SET NOT NULL`.
6. Then `bun run db:push` reconciles (no destructive drift left). Same script runs on prod via SSM before pushing main. `handback_test`: `db push --force-reset` (it's truncated by the suite anyway).

## Client

- `src/lib/org.tsx` → `src/lib/space.tsx`: `Space = { teamId: string|null, name, role }`; spaces = Personal + teams; localStorage `handback.activeSpace` (`personal` | teamId). Switcher shows **Personal** + teams + New team….
- Team nav tab only on a team space. team.tsx loses guest/scope UI, gains owner badge + transfer-ownership (owner only) + seat count.
- connect.tsx: token copy becomes account-wide. recorder.tsx handshake drops orgId. admin.tsx: teams stat + drill-down grouped Personal/teams. Word "workspace" is banned from all copy.

## Extension (1.3.0)

- `Settings.links` becomes one per **server**: `{ id: serverUrl, serverUrl, apiToken }`; migration folds existing per-workspace links (dedupe by serverUrl, keep most recently used token) and the 1.1.x flat fields.
- Destination row picks space (Personal / team) + project from the new `/context`; declare sends `teamId`. Home queue filters by the active destination space via `?team=`.
- Preview harness SETTINGS stub updated to the new shape.

## Waves

1. S1 schema+server core · S2 ingest/API/MCP · S3 migration script + CLI (3 Opus agents, parallel, disjoint files)
2. W1 client core · W2 client pages · W3 extension
3. e2e rebaseline, typecheck, quality gate, prod migration handoff notes.
