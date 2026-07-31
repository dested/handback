import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { useActiveOrg } from '~/lib/org'
import { useTRPC } from '~/lib/trpc'
import { StatusControl } from './status-control'
import type { Gripe } from './types'
import { useCopy } from './use-copy'

/** What the agent needs to find this gripe and report back when it's done. */
function agentBrief(gripe: Gripe): string {
  return (
    `Read the gripe "${gripe.title}" at ${window.location.origin}/gripes/${gripe.id}. ` +
    `Pull the full brief with the handback MCP tool get_gripe("${gripe.id}") — the report.md ` +
    `inside is authored for you, follow it. When your fix is up, set the gripe to in_review ` +
    `with set_gripe_status.`
  )
}

/** The review actions: triage status, which project it belongs to, hand-off, delete. */
export function GripeControls({ gripe }: { gripe: Gripe }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { org } = useActiveOrg()
  const { copied, copy } = useCopy()

  const gripeQueryKey = trpc.gripes.get.queryKey({ gripeId: gripe.id })

  // Refetch this gripe and every inbox list (any project/status filter).
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: gripeQueryKey })
    queryClient.invalidateQueries({ queryKey: trpc.gripes.list.queryKey() })
  }

  const setStatus = useMutation(trpc.gripes.setStatus.mutationOptions({ onSettled: invalidate }))
  const assignProject = useMutation(
    trpc.gripes.assignProject.mutationOptions({ onSettled: invalidate })
  )
  const remove = useMutation(
    trpc.gripes.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.gripes.list.queryKey() })
        navigate('/app')
      },
    })
  )

  // Keyed off the gripe's own org, not the active one — reaching this page
  // already proved membership, and the two can differ mid-switch. Guests only
  // hold a slice of the workspace, so filing a gripe elsewhere isn't theirs to do.
  const canAssign = org?.id === gripe.orgId && org?.scope === 'org'
  const projects = useQuery({
    ...trpc.projects.list.queryOptions({ orgId: gripe.orgId }),
    enabled: canAssign,
  })

  // In-flight variables stand in for the server's answer, so the control moves
  // the instant it's clicked and snaps back on its own if the write fails.
  const status = setStatus.isPending ? (setStatus.variables?.status ?? gripe.status) : gripe.status
  const projectId = assignProject.isPending
    ? (assignProject.variables?.projectId ?? '')
    : (gripe.project?.id ?? '')

  // Deleting is admin-only server-side, and role only means anything when the
  // active workspace is this gripe's workspace.
  const canDelete = org?.id === gripe.orgId && (org?.role === 'owner' || org?.role === 'admin')

  function confirmDelete() {
    if (!window.confirm(`Delete "${gripe.title}"? The recording and report go with it.`)) return
    remove.mutate({ gripeId: gripe.id })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusControl
        status={status}
        disabled={setStatus.isPending}
        onChange={(next) => setStatus.mutate({ gripeId: gripe.id, status: next })}
      />

      {canAssign && (
        <select
          aria-label="Project"
          className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-sm disabled:opacity-60"
          value={projectId}
          disabled={assignProject.isPending || projects.isLoading}
          onChange={(e) =>
            assignProject.mutate({ gripeId: gripe.id, projectId: e.target.value || null })
          }>
          <option value="">— No project —</option>
          {(projects.data ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      )}

      <Button variant="outline" onClick={() => copy(agentBrief(gripe))}>
        {copied ? 'Copied' : 'Copy agent brief'}
      </Button>

      {canDelete && (
        <Button
          variant="outline"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/40 ml-auto"
          disabled={remove.isPending}
          onClick={confirmDelete}>
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </Button>
      )}
    </div>
  )
}
