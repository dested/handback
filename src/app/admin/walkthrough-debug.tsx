// Everything the platform knows about one walkthrough — including the exact
// brief MCP hands an agent — plus the one repair an admin ever needs: moving it
// into the right space.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import {
  ErrorText,
  Loading,
  PageHeader,
  SectionTitle,
  StatTile,
  StatusChip,
  Td,
  Th,
  fmtBytes,
  fmtDate,
  fmtDuration,
} from './shared'

const CHIP = 'border-border text-muted-foreground rounded border px-1.5 py-0.5 text-xs'
const FLAG = 'bg-review-wash text-review rounded px-1.5 py-0.5 font-mono text-[10px] uppercase'
const PRE =
  'bg-card border-border max-h-[32rem] overflow-auto rounded-md border p-4 font-mono text-xs whitespace-pre-wrap'

export function AdminWalkthroughDebugPage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { walkthroughId = '' } = useParams()

  const debug = useQuery(trpc.admin.walkthroughDebug.queryOptions({ walkthroughId }))
  const teams = useQuery(trpc.admin.teams.queryOptions({ query: '' }))

  const [dest, setDest] = useState('')

  const move = useMutation(
    trpc.admin.moveWalkthrough.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.admin.walkthroughDebug.queryKey({ walkthroughId }),
        })
        queryClient.invalidateQueries({ queryKey: trpc.admin.walkthroughs.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.admin.teams.queryKey() })
        setDest('')
      },
    })
  )

  if (debug.isPending) return <Loading />
  if (debug.isError) return <ErrorText message={debug.error.message} />
  if (!debug.data) return <ErrorText message="No such walkthrough." />

  const d = debug.data
  const uploadedFiles = d.files.filter((f) => f.status === 'uploaded')
  const uploadedBytes = uploadedFiles.reduce((sum, f) => sum + f.size, 0)

  return (
    <div className="space-y-8">
      <PageHeader title={d.title} sub={`${d.slug}${d.origin ? ` · ${d.origin}` : ''}`} />

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={d.status} />
        <Link
          to={d.space.kind === 'team' ? `/admin/teams/${d.space.id}` : `/admin/users/${d.space.id}`}
          className={CHIP}>
          {d.space.name}
        </Link>
        {d.project && <span className={CHIP}>{d.project.name}</span>}
        {d.finalizedAt === null && <span className={FLAG}>unfinished</span>}
        <Link to={`/walkthroughs/${d.id}`} className="text-cobalt ml-auto text-sm hover:underline">
          open in viewer →
        </Link>
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-6 font-mono text-xs">
        <span>recorded {fmtDate(d.recordedAt)}</span>
        <span>uploaded {fmtDate(d.uploadedAt)}</span>
        <span>finalized {fmtDate(d.finalizedAt)}</span>
        <span>resolved {fmtDate(d.resolvedAt)}</span>
      </div>

      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <StatTile label="Length" value={fmtDuration(d.durationMs)} />
        <StatTile label="Frames kept" value={d.frameCount} />
        <StatTile label="Errors" value={d.errorCount} sub={`${d.droppedCount} dropped off-tab`} />
        <StatTile label="Size" value={fmtBytes(d.bytes)} />
        <StatTile label="Files" value={d.files.length} />
      </div>

      <section className="space-y-3">
        <SectionTitle>Move to another space</SectionTitle>
        {d.finalizedAt === null ? (
          // The server refuses these anyway: pending file rows can hide real
          // objects the copy would skip and the source wipe would destroy.
          <p className="text-muted-foreground text-sm">
            This walkthrough never finished uploading — it can be deleted, not moved.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <select
                aria-label="Destination"
                className="border-input bg-background h-9 rounded-md border px-2.5 text-sm"
                value={dest}
                disabled={teams.isPending}
                onChange={(e) => setDest(e.target.value)}>
                <option value="" disabled>
                  {teams.isPending ? 'Loading teams…' : 'Choose a destination…'}
                </option>
                {(teams.data ?? [])
                  .filter((t) => !(d.space.kind === 'team' && d.space.id === t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                {d.uploadedBy && d.space.kind !== 'personal' && (
                  <option value="personal">{d.uploadedBy.name} (personal)</option>
                )}
              </select>
              <Button
                variant="outline"
                disabled={!dest || move.isPending}
                onClick={() =>
                  move.mutate({ walkthroughId, teamId: dest === 'personal' ? null : dest })
                }>
                Move
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Quota applies at the destination; the project assignment does not survive a move.
            </p>
            {teams.isError && <ErrorText message={teams.error.message} />}
            {move.isError && <ErrorText message={move.error.message} />}
          </>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle
          right={
            <span className="text-muted-foreground font-mono text-xs">
              {d.briefFrameLimit} of {d.frameFilesUploaded} frame links inlined
            </span>
          }>
          What the agent receives
        </SectionTitle>
        <p className="text-muted-foreground text-sm">
          The exact brief MCP returns for this walkthrough — same code path, nothing simulated.
          Frame links beyond the cap are omitted with a pointer to the files list.
        </p>
        {d.brief ? (
          <pre className={PRE}>{d.brief}</pre>
        ) : (
          <p className="text-muted-foreground text-sm">
            No brief — the walkthrough isn't reachable by the agent API.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Takes</SectionTitle>
        {d.takes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No takes recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Take</Th>
                  <Th className="w-20">Length</Th>
                  <Th className="w-20">Frames</Th>
                  <Th className="w-32">Transcriber</Th>
                  <Th className="w-64">Video</Th>
                  <Th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {d.takes.map((t) => (
                  <tr key={t.id}>
                    <Td className="font-mono text-xs">{t.dir}</Td>
                    <Td className="font-mono text-xs">{fmtDuration(t.durationMs)}</Td>
                    <Td className="font-mono text-xs">{t.frameCount}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {t.transcriber ?? '—'}
                    </Td>
                    <Td className="text-muted-foreground max-w-64 truncate font-mono text-xs">
                      {t.videoPath ?? '—'}
                    </Td>
                    <Td>{t.interrupted && <span className={FLAG}>interrupted</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle
          right={
            <span className="text-muted-foreground font-mono text-xs">
              {uploadedFiles.length} uploaded · {fmtBytes(uploadedBytes)}
            </span>
          }>
          Files
        </SectionTitle>
        {d.files.length === 0 ? (
          <p className="text-muted-foreground text-sm">No files.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Path</Th>
                  <Th className="w-40">Type</Th>
                  <Th className="w-24">Size</Th>
                  <Th className="w-28">Status</Th>
                </tr>
              </thead>
              <tbody>
                {d.files.map((f) => (
                  <tr key={f.id}>
                    <Td>
                      {f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cobalt font-mono text-xs hover:underline">
                          {f.path}
                        </a>
                      ) : (
                        <span className="font-mono text-xs">{f.path}</span>
                      )}
                    </Td>
                    <Td className="text-muted-foreground font-mono text-xs">{f.contentType}</Td>
                    <Td className="font-mono text-xs">{fmtBytes(f.size)}</Td>
                    <Td>
                      {f.status === 'uploaded' ? (
                        <span className="bg-approve-wash text-approve rounded px-1.5 py-0.5 text-xs">
                          uploaded
                        </span>
                      ) : (
                        <span className="bg-review-wash text-review rounded px-1.5 py-0.5 text-xs">
                          {f.status}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>report.md</SectionTitle>
        {d.reportMd ? (
          <pre className={PRE}>{d.reportMd}</pre>
        ) : (
          <p className="text-muted-foreground text-sm">No report.md was uploaded.</p>
        )}
      </section>
    </div>
  )
}
