import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { useActiveOrg } from '~/lib/org'
import { useTRPC } from '~/lib/trpc'
import { StatusControl } from './status-control'
import type { Walkthrough } from './types'
import { useCopy } from './use-copy'

/** What the agent needs to find this walkthrough and report back when it's done. */
function agentBrief(walkthrough: Walkthrough): string {
  return (
    `Read the walkthrough "${walkthrough.title}" at ${window.location.origin}/walkthroughs/${walkthrough.id}. ` +
    `Pull the full brief with the handback MCP tool get_walkthrough("${walkthrough.id}") — the report.md ` +
    `inside is authored for you, follow it. When your fix is up, set the walkthrough to in_review ` +
    `with set_walkthrough_status.`
  )
}

/** The review actions: triage status, which project it belongs to, hand-off, delete. */
export function WalkthroughControls({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { orgs, org, setActiveOrgId } = useActiveOrg()
  const { copied, copy } = useCopy()

  const walkthroughQueryKey = trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id })

  // Refetch this walkthrough and every inbox list (any project/status filter).
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: walkthroughQueryKey })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
  }

  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate })
  )
  const assignProject = useMutation(
    trpc.walkthroughs.assignProject.mutationOptions({ onSettled: invalidate })
  )
  const remove = useMutation(
    trpc.walkthroughs.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
        navigate('/app')
      },
    })
  )

  const move = useMutation(
    trpc.walkthroughs.moveToOrg.mutationOptions({
      onSuccess: (_result, variables) => {
        // The URL doesn't change; following the walkthrough into its new workspace is
        // what keeps walkthroughs.get answering for the caller after the refetch.
        setActiveOrgId(variables.orgId)
        invalidate()
      },
    })
  )

  // Keyed off the walkthrough's own org, not the active one — reaching this page
  // already proved membership, and the two can differ mid-switch. Guests only
  // hold a slice of the workspace, so filing a walkthrough elsewhere isn't theirs to do.
  const canAssign = org?.id === walkthrough.orgId && org?.scope === 'org'
  const projects = useQuery({
    ...trpc.projects.list.queryOptions({ orgId: walkthrough.orgId }),
    enabled: canAssign,
  })

  // In-flight variables stand in for the server's answer, so the control moves
  // the instant it's clicked and snaps back on its own if the write fails.
  const status = setStatus.isPending
    ? (setStatus.variables?.status ?? walkthrough.status)
    : walkthrough.status
  const projectId = assignProject.isPending
    ? (assignProject.variables?.projectId ?? '')
    : (walkthrough.project?.id ?? '')

  // Deleting is admin-only server-side, and role only means anything when the
  // active workspace is this walkthrough's workspace.
  const canDelete =
    org?.id === walkthrough.orgId && (org?.role === 'owner' || org?.role === 'admin')

  // Only whole-workspace members on both ends may move a walkthrough, and the source
  // side of that is exactly the guard project assignment already needs.
  const destinations = orgs.filter((o) => o.scope === 'org' && o.id !== walkthrough.orgId)

  function confirmDelete() {
    if (!window.confirm(`Delete "${walkthrough.title}"? The recording and report go with it.`))
      return
    remove.mutate({ walkthroughId: walkthrough.id })
  }

  function confirmMove(orgId: string) {
    const dest = destinations.find((o) => o.id === orgId)
    if (!dest || !org) return
    const warning =
      `Move "${walkthrough.title}" to ${dest.name}? Everyone in ${org.name} loses access to it, ` +
      `and its project assignment is cleared.`
    if (!window.confirm(warning)) return
    move.mutate({ walkthroughId: walkthrough.id, orgId: dest.id })
  }

  // A platform admin reached this walkthrough from /admin without belonging to its
  // workspace: the read side lets them look, every mutation still 403s. Show
  // nothing they can't actually do.
  if (!walkthrough.viewerIsMember) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="border-review/40 bg-review-wash text-review rounded-md border px-2 py-1 font-mono text-xs">
          admin view · read only
        </span>
        <Button variant="outline" onClick={() => copy(agentBrief(walkthrough))}>
          {copied ? 'Copied' : 'Copy agent brief'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <StatusControl
          status={status}
          disabled={setStatus.isPending}
          onChange={(next) => setStatus.mutate({ walkthroughId: walkthrough.id, status: next })}
        />

        {canAssign && (
          <select
            aria-label="Project"
            className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-sm disabled:opacity-60"
            value={projectId}
            disabled={assignProject.isPending || projects.isLoading}
            onChange={(e) =>
              assignProject.mutate({
                walkthroughId: walkthrough.id,
                projectId: e.target.value || null,
              })
            }>
            <option value="">— No project —</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}

        {canAssign && destinations.length > 0 && (
          <select
            aria-label="Move to workspace"
            className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-sm disabled:opacity-60"
            value=""
            disabled={move.isPending}
            onChange={(e) => confirmMove(e.target.value)}>
            <option value="" disabled>
              {move.isPending ? 'Moving…' : 'Move to workspace…'}
            </option>
            {destinations.map((dest) => (
              <option key={dest.id} value={dest.id}>
                {dest.name}
              </option>
            ))}
          </select>
        )}

        <Button variant="outline" onClick={() => copy(agentBrief(walkthrough))}>
          {copied ? 'Copied' : 'Copy agent brief'}
        </Button>

        {canDelete && (
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/40 ml-auto"
            disabled={remove.isPending || move.isPending}
            onClick={confirmDelete}>
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        )}
      </div>

      {move.error && <p className="text-destructive text-sm">{move.error.message}</p>}
    </div>
  )
}
