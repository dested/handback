// The one client-side space concept. A space is either Personal or a team, and
// this is the whole point of the restructure: Personal is not a fetched thing.
// It cannot load, fail, or need provisioning — it's a module constant that is
// always there, so `space` is never null and no surface needs an "are you set
// up yet" branch. Only teams are async, and their absence is just a shorter
// menu. The chosen space persists in localStorage so refreshes and new tabs
// land back where you were; SSR renders Personal, and the stored choice is
// applied on mount.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'

export type SpaceRole = 'owner' | 'admin' | 'member'

export type Space = {
  teamId: string | null
  name: string
  slug: string | null
  role: SpaceRole
}

type SpaceContextValue = {
  spaces: Space[]
  space: Space
  teamsLoaded: boolean
  setActiveSpace: (teamId: string | null) => void
  refreshTeams: () => void
}

export const PERSONAL_SPACE: Space = {
  teamId: null,
  name: 'Personal',
  slug: null,
  role: 'owner',
}

const SpaceContext = createContext<SpaceContextValue | null>(null)

const STORAGE_KEY = 'handback.activeSpace'
const PERSONAL_VALUE = 'personal'

/** Role arrives as a bare string on the wire; narrow it rather than trust it. */
function toRole(role: string): SpaceRole {
  return role === 'owner' || role === 'admin' ? role : 'member'
}

/**
 * Call whenever the signed-in identity changes — sign-out, sign-in, sign-up.
 * Everything cached belongs to the *previous* account: the query cache would
 * otherwise hand the next user someone else's teams (and inbox) until a
 * refetch lands, and the remembered space would point at a team they may not
 * even be in.
 */
export function clearIdentity(queryClient: QueryClient): void {
  localStorage.removeItem(STORAGE_KEY)
  queryClient.clear()
}

export function SpaceProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const teamsQuery = useQuery({ ...trpc.teams.mine.queryOptions(), enabled })
  // null until the effect reads storage, which is also the SSR value — so the
  // server and the first client paint agree on Personal.
  const [storedTeamId, setStoredTeamId] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    setStoredTeamId(stored === null || stored === PERSONAL_VALUE ? null : stored)
  }, [])

  const teams: Space[] = (teamsQuery.data ?? []).map((t) => ({
    teamId: t.id,
    name: t.name,
    slug: t.slug,
    role: toRole(t.role),
  }))
  const spaces = [PERSONAL_SPACE, ...teams]
  // A stored team you're no longer a member of resolves to Personal, which is
  // always a valid place to be.
  const space = teams.find((t) => t.teamId === storedTeamId) ?? PERSONAL_SPACE

  function setActiveSpace(teamId: string | null) {
    localStorage.setItem(STORAGE_KEY, teamId ?? PERSONAL_VALUE)
    setStoredTeamId(teamId)
  }

  function refreshTeams() {
    queryClient.invalidateQueries({ queryKey: trpc.teams.mine.queryKey() })
  }

  return (
    <SpaceContext.Provider
      value={{ spaces, space, teamsLoaded: teamsQuery.isSuccess, setActiveSpace, refreshTeams }}>
      {children}
    </SpaceContext.Provider>
  )
}

export function useActiveSpace(): SpaceContextValue {
  const ctx = useContext(SpaceContext)
  if (!ctx) throw new Error('useActiveSpace outside SpaceProvider')
  return ctx
}
