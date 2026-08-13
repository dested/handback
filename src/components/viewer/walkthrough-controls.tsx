import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { useActiveSpace } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import { ShareControl } from './share-control'
import { StatusControl } from './status-control'
import type { Walkthrough } from './types'
import { useCopy } from './use-copy'

/** Stands in for Personal in the move menu, whose real value is `null`. */
const PERSONAL_OPTION = 'personal'

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
  const { spaces, setActiveSpace } = useActiveSpace()
  const { copied, copy } = useCopy()

  const walkthroughQueryKey = trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id })

  // Refetch this walkthrough and every inbox list (any project/status filter).
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: walkthroughQueryKey })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }

  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate })
  )
  const assignProject = useMutation(
    trpc.walkthroughs.assignProject.mutationOptions({ onSettled: invalidate })
  )
  const setKind = useMutation(trpc.walkthroughs.setKind.mutationOptions({ onSettled: invalidate }))
  const remove = useMutation(
    trpc.walkthroughs.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
        navigate('/app')
      },
    })
  )

  const move = useMutation(
    trpc.walkthroughs.move.mutationOptions({
      onSuccess: (_result, variables) => {
        // The URL doesn't change; following the walkthrough into its new space is
        // what keeps walkthroughs.get answering for the caller after the refetch.
        setActiveSpace(variables.teamId)
        invalidate()
      },
    })
  )

  // `viewerIsMember` is the whole gate: the server already decided whether this
  // caller belongs to the walkthrough's space, and the active space can differ
  // from it mid-switch.
  const canAssign = walkthrough.viewerIsMember
  const projects = useQuery({
    ...trpc.projects.list.queryOptions({ teamId: walkthrough.teamId }),
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
  const kind = setKind.isPending ? (setKind.variables?.kind ?? walkthrough.kind) : walkthrough.kind

  // Deleting a team's walkthrough is admin-only server-side; your own personal
  // space is always yours to delete from.
  const canDelete =
    walkthrough.viewerIsMember &&
    (walkthrough.teamId === null ||
      ['owner', 'admin'].includes(
        spaces.find((s) => s.teamId === walkthrough.teamId)?.role ?? 'member'
      ))

  // Every space you're in except the one it already sits in — Personal included.
  const destinations = spaces.filter((s) => s.teamId !== walkthrough.teamId)

  function confirmDelete() {
    if (!window.confirm(`Delete "${walkthrough.title}"? The recording and report go with it.`))
      return
    remove.mutate({ walkthroughId: walkthrough.id })
  }

  function confirmMove(value: string) {
    // '' is the placeholder option, so Personal rides under its own sentinel.
    const dest = destinations.find((s) => (s.teamId ?? PERSONAL_OPTION) === value)
    if (!dest) return
    const sourceLoses = walkthrough.teamId === null ? '' : ' The team loses access to it.'
    const warning =
      dest.teamId === null
        ? `Move "${walkthrough.title}" to your personal space? The team loses access to it, and its project assignment is cleared.`
        : `Move "${walkthrough.title}" to ${dest.name}?${sourceLoses} Its project assignment is cleared.`
    if (!window.confirm(warning)) return
    move.mutate({ walkthroughId: walkthrough.id, teamId: dest.teamId })
  }

  // A platform admin reached this walkthrough from /admin without belonging to its
  // space: the read side lets them look, every mutation still 403s. Show
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

        {/* Who it's for is a judgement, not a property of the recording — a
            walkthrough filed for an agent can turn out to be the thing you
            just want to send someone. Nothing is rewritten either way. */}
        {canAssign && (
          <select
            aria-label="Who this is for"
            className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-sm disabled:opacity-60"
            value={kind}
            disabled={setKind.isPending}
            onChange={(e) =>
              setKind.mutate({
                walkthroughId: walkthrough.id,
                kind: e.target.value === 'human' ? 'human' : 'agent',
              })
            }>
            <option value="agent">for an agent</option>
            <option value="human">for a person</option>
          </select>
        )}

        {canAssign && destinations.length > 0 && (
          <select
            aria-label="Move to space"
            className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-sm disabled:opacity-60"
            value=""
            disabled={move.isPending}
            onChange={(e) => confirmMove(e.target.value)}>
            <option value="" disabled>
              {move.isPending ? 'Moving…' : 'Move to space…'}
            </option>
            {destinations.map((dest) => (
              <option key={dest.teamId ?? PERSONAL_OPTION} value={dest.teamId ?? PERSONAL_OPTION}>
                {dest.name}
              </option>
            ))}
          </select>
        )}

        {/* A human handback is FOR a person — the share link is its point, and
            an agent brief would tell an agent to pull a walkthrough that its
            list deliberately hides. Reads the optimistic `kind`, so flipping the
            select above takes the brief with it on the same click. */}
        {kind !== 'human' && (
          <Button variant="outline" onClick={() => copy(agentBrief(walkthrough))}>
            {copied ? 'Copied' : 'Copy agent brief'}
          </Button>
        )}
        <ShareControl walkthrough={walkthrough} />

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
