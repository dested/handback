// Files attached to the walkthrough — the spec, the CSV, the spreadsheet the
// narration referenced. Attachments ride the agent brief, so adding one here is
// handing the agent evidence. The panel also renders the detection pass's
// nudges ("the recording mentions X — attach it?"), each of which opens the
// picker already bound to the suggestion it answers.
//
// Self-contained on `walkthroughs.attachments`: the viewer, /upload's done
// screen and /record's done screen all render this same component.

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { putBlob } from '~/lib/edit/transfer'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { mmss } from './format'
import { SectionHead } from './section-head'

const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type UploadState = { name: string; pct: number }

export function AttachmentsPanel({
  walkthroughId,
  onSeek,
  poll = false,
  framed = false,
}: {
  walkthroughId: string
  /** Present in the viewer — a suggestion's time chip seeks the player. */
  onSeek?: (ms: number) => void
  /** Intake done screens set this: the detection pass runs async right after
   *  finalize, so the first suggestions can land seconds after mount. */
  poll?: boolean
  /** Viewer mode: render the whole ruled section (head included) — and none of
   *  it when there is nothing to show and no right to add. */
  framed?: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const mountedAt = useRef(Date.now())

  const attachments = useQuery(
    trpc.walkthroughs.attachments.queryOptions(
      { walkthroughId },
      {
        // Poll for under a minute — the pass either answered by then or degraded
        // to nothing, and an empty answer must not poll forever.
        refetchInterval: (query) =>
          poll &&
          Date.now() - mountedAt.current < 60_000 &&
          (query.state.data?.suggestions.length ?? 0) === 0
            ? 5000
            : false,
      }
    )
  )
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.walkthroughs.attachments.queryKey({ walkthroughId }),
      }),
      // Attachments change the walkthrough's files and bytes.
      queryClient.invalidateQueries({
        queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId }),
      }),
    ])

  const presign = useMutation(trpc.walkthroughs.presignAttachments.mutationOptions())
  const finalize = useMutation(trpc.walkthroughs.finalizeAttachments.mutationOptions())
  const remove = useMutation(
    trpc.walkthroughs.deleteAttachment.mutationOptions({ onSettled: invalidate })
  )
  const dismiss = useMutation(
    trpc.walkthroughs.dismissSuggestion.mutationOptions({ onSettled: invalidate })
  )

  const [uploading, setUploading] = useState<UploadState[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [arming, setArming] = useState<string | null>(null)
  // The suggestion the next pick answers; null = a plain "attach a file".
  const pendingSuggestion = useRef<string | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)

  async function upload(files: File[]) {
    const suggestionId = pendingSuggestion.current
    pendingSuggestion.current = null
    const picked = files.filter((f) => f.size > 0)
    if (picked.length === 0) return
    setUploadError(null)
    setUploading(picked.map((f) => ({ name: f.name, pct: 0 })))
    try {
      const { uploads } = await presign.mutateAsync({
        walkthroughId,
        files: picked.map((f) => ({
          name: f.name,
          size: f.size,
          contentType: f.type || 'application/octet-stream',
        })),
      })
      for (let i = 0; i < picked.length; i++) {
        const file = picked[i]
        const target = uploads[i]
        if (!file || !target) continue
        await putBlob(target.name, target.url, target.contentType, file, (p) => {
          const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0
          setUploading((prev) => prev.map((u, j) => (j === i ? { ...u, pct } : u)))
        })
      }
      const first = uploads[0]
      await finalize.mutateAsync({
        walkthroughId,
        paths: uploads.map((u) => u.path),
        fulfils: suggestionId && first ? [{ suggestionId, path: first.path }] : undefined,
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "the file didn't upload")
    } finally {
      setUploading([])
      await invalidate()
    }
  }

  const data = attachments.data
  if (!data) return null
  const open = data.suggestions.filter((s) => !s.dismissed && s.attachedPath === null)
  // Nothing to show and nothing to do — the section stays out of the page.
  if (!data.canEdit && data.files.length === 0) return null

  const body = (
    <div className="max-w-2xl space-y-3">
      {data.canEdit && (
        <input
          ref={picker}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length) void upload(files)
          }}
        />
      )}

      {/* The nudges: what the recording asked for that nobody attached yet. */}
      {data.canEdit &&
        open.map((s) => (
          <div
            key={s.id}
            className="border-cobalt/30 bg-cobalt-wash/50 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-md border px-3 py-2">
            {s.atMs !== null &&
              (onSeek ? (
                <button
                  type="button"
                  onClick={() => onSeek(s.atMs ?? 0)}
                  className="text-cobalt shrink-0 font-mono text-xs hover:underline">
                  {mmss(s.atMs)}
                </button>
              ) : (
                <span className="text-cobalt shrink-0 font-mono text-xs">{mmss(s.atMs)}</span>
              ))}
            <p className="min-w-0 flex-1 text-sm leading-relaxed">
              The recording mentions <span className="font-medium">“{s.label}”</span> — attach it?
              {s.quote && (
                <span className="text-muted-foreground block truncate text-xs">“{s.quote}”</span>
              )}
            </p>
            <span className="flex shrink-0 items-baseline gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={() => {
                  pendingSuggestion.current = s.id
                  picker.current?.click()
                }}
                className="text-cobalt underline underline-offset-4">
                attach
              </button>
              <button
                type="button"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate({ suggestionId: s.id })}
                className="text-muted-foreground hover:text-foreground">
                dismiss
              </button>
            </span>
          </div>
        ))}

      {/* What's attached. */}
      {data.files.map((f) => (
        <div key={f.path} className="group flex items-baseline gap-2.5">
          <a
            href={f.url}
            className="text-cobalt min-w-0 truncate font-mono text-sm underline-offset-4 hover:underline">
            {f.name}
          </a>
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            {fmtSize(f.size)}
          </span>
          {data.canEdit &&
            (arming === f.path ? (
              <span className="shrink-0 font-mono text-xs">
                delete?{' '}
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => {
                    setArming(null)
                    remove.mutate({ walkthroughId, path: f.path })
                  }}
                  className="text-destructive underline underline-offset-4">
                  yes
                </button>{' '}
                <button
                  type="button"
                  onClick={() => setArming(null)}
                  className="text-muted-foreground">
                  keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Delete ${f.name}`}
                onClick={() => setArming(f.path)}
                className="text-muted-foreground hover:text-destructive shrink-0 font-mono text-xs opacity-0 transition-opacity group-hover:opacity-100">
                ×
              </button>
            ))}
        </div>
      ))}

      {uploading.map((u) => (
        <p key={u.name} className="text-muted-foreground font-mono text-xs">
          uploading {u.name}… {u.pct}%
        </p>
      ))}
      {uploadError && <p className="text-destructive text-sm">{uploadError}</p>}

      {data.canEdit && (
        <div
          className={cn(
            'flex items-center gap-3',
            (data.files.length > 0 || open.length > 0) && 'pt-1'
          )}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading.length > 0}
            onClick={() => {
              pendingSuggestion.current = null
              picker.current?.click()
            }}>
            Attach a file
          </Button>
          {data.files.length === 0 && open.length === 0 && (
            <p className="text-muted-foreground text-sm">
              A spec, a spreadsheet, a log — your agent gets it with the brief.
            </p>
          )}
        </div>
      )}
    </div>
  )

  if (!framed) return body
  return (
    <section className="space-y-2.5">
      <SectionHead>attachments</SectionHead>
      {body}
    </section>
  )
}
