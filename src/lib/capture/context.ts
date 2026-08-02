import { assertAuthorized, authHeaders, explain, INGEST } from './api'

/**
 * Ported from `extension/src/lib/context.ts`, against the same origin. What one
 * token can see: who it belongs to, the personal space it always has, and every
 * team it reaches — each with the projects a walkthrough may be pinned to. The
 * phone asks once and uses the answer to fill the destination picker.
 */

/** The projects of one space, in the shape the picker renders. */
export type SpaceProjects = { id: string; name: string; slug: string; originHints: string[] }[]

/** What GET /api/ingest/context says a token can see. */
export interface ServerContext {
  user: { id: string; name: string; email: string }
  personal: { projects: SpaceProjects }
  teams: { id: string; name: string; slug: string; projects: SpaceProjects }[]
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readUser(value: unknown): ServerContext['user'] | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, name, email } = value as { id?: unknown; name?: unknown; email?: unknown }
  const [i, n, e] = [str(id), str(name), str(email)]
  return i !== null && n !== null && e !== null ? { id: i, name: n, email: e } : null
}

function readProjects(value: unknown): SpaceProjects | null {
  if (!Array.isArray(value)) return null
  const out: SpaceProjects = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null
    const { id, name, slug, originHints } = raw as {
      id?: unknown
      name?: unknown
      slug?: unknown
      originHints?: unknown
    }
    const [i, n, s] = [str(id), str(name), str(slug)]
    if (i === null || n === null || s === null) return null
    const hints = Array.isArray(originHints)
      ? originHints.filter((h): h is string => typeof h === 'string')
      : []
    out.push({ id: i, name: n, slug: s, originHints: hints })
  }
  return out
}

function readPersonal(value: unknown): ServerContext['personal'] | null {
  if (typeof value !== 'object' || value === null) return null
  const projects = readProjects((value as { projects?: unknown }).projects)
  return projects ? { projects } : null
}

function readTeams(value: unknown): ServerContext['teams'] | null {
  if (!Array.isArray(value)) return null
  const out: ServerContext['teams'] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null
    const { id, name, slug, projects } = raw as {
      id?: unknown
      name?: unknown
      slug?: unknown
      projects?: unknown
    }
    const [i, n, s] = [str(id), str(name), str(slug)]
    const p = readProjects(projects)
    if (i === null || n === null || s === null || !p) return null
    out.push({ id: i, name: n, slug: s, projects: p })
  }
  return out
}

/** Throws AuthError when the token is dead, a plain Error for anything else. */
export async function fetchContext(token: string): Promise<ServerContext> {
  let res: Response
  try {
    res = await fetch(INGEST.context, { headers: authHeaders(token) })
  } catch {
    throw new Error('context failed: the phone could not reach Handback')
  }
  assertAuthorized(res)
  if (!res.ok) throw await explain('context', res)
  const payload: unknown = await res.json().catch(() => null)
  if (typeof payload !== 'object' || payload === null) throw new Error('context: not an object')
  const { user, personal, teams } = payload as {
    user?: unknown
    personal?: unknown
    teams?: unknown
  }
  const readUserResult = readUser(user)
  const readPersonalResult = readPersonal(personal)
  const readTeamsResult = readTeams(teams)
  if (!readUserResult || !readPersonalResult || !readTeamsResult) {
    throw new Error('context: unexpected shape')
  }
  return { user: readUserResult, personal: readPersonalResult, teams: readTeamsResult }
}

/** What to call the space uploads go to. null is the token owner's own space. */
export function spaceName(ctx: ServerContext | null, teamId: string | null): string {
  if (!teamId) return 'Personal'
  return ctx?.teams.find((t) => t.id === teamId)?.name ?? ''
}

/** The projects of that space — a project belongs to exactly one. */
export function spaceProjects(ctx: ServerContext | null, teamId: string | null): SpaceProjects {
  if (!ctx) return []
  if (!teamId) return ctx.personal.projects
  return ctx.teams.find((t) => t.id === teamId)?.projects ?? []
}
