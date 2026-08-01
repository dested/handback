// Active-org context. orgs.mine is fetched once (only when signed in); the
// chosen org id persists in localStorage so refreshes and new tabs keep the
// same workspace. SSR renders with orgs unloaded — every consumer must handle
// `org === null` (loading OR genuinely org-less).

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'

export type OrgSummary = {
  id: string
  name: string
  slug: string
  role: string
  scope: string
  personal: boolean
  teamEnabled: boolean
}

type OrgContextValue = {
  orgs: OrgSummary[]
  org: OrgSummary | null
  orgsLoaded: boolean
  setActiveOrgId: (id: string) => void
  refreshOrgs: () => void
}

const OrgContext = createContext<OrgContextValue | null>(null)

const STORAGE_KEY = 'handback.activeOrgId'

export function OrgProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const orgsQuery = useQuery({ ...trpc.orgs.mine.queryOptions(), enabled })
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null)

  useEffect(() => {
    setActiveOrgIdState(localStorage.getItem(STORAGE_KEY))
  }, [])

  const orgs = orgsQuery.data ?? []
  const org = orgs.find((o) => o.id === activeOrgId) ?? orgs[0] ?? null

  function setActiveOrgId(id: string) {
    localStorage.setItem(STORAGE_KEY, id)
    setActiveOrgIdState(id)
  }

  function refreshOrgs() {
    queryClient.invalidateQueries({ queryKey: trpc.orgs.mine.queryKey() })
  }

  return (
    <OrgContext.Provider
      value={{ orgs, org, orgsLoaded: orgsQuery.isSuccess, setActiveOrgId, refreshOrgs }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useActiveOrg(): OrgContextValue {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useActiveOrg outside OrgProvider')
  return ctx
}
