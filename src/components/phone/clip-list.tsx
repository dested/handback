// The clips waiting to be sent, and the two ways to add one. A row is a
// hairline-divided line, never a box — the list is a manifest, not a gallery.
//
// The mic lives here too: a voice note is just another clip, recorded in the
// page because there is no OS recorder for "I want to say one thing". It arms
// into a row rather than a modal, so the page never covers itself up.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Plus, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { mmss } from '~/lib/capture/format'

/** One picked file, from the moment it is picked — `probing` until we know what it is. */
export type Clip = {
  id: string
  file: File
  probing: boolean
  durationMs: number
  hasVideo: boolean
  /** An objectURL this component only renders; the page owns revoking it. */
  posterUrl: string | null
}

export const CLIP_ACCEPT = 'video/*,audio/*'

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ClipList({ clips, onRemove }: { clips: Clip[]; onRemove: (id: string) => void }) {
  if (!clips.length) return null
  return (
    <ul className="divide-border divide-y">
      {clips.map((clip, i) => (
        <li key={clip.id} className="flex items-center gap-3 py-3">
          {clip.posterUrl ? (
            <img
              src={clip.posterUrl}
              alt=""
              className="border-border size-14 shrink-0 rounded border object-cover"
            />
          ) : (
            // A voice note says so; a video whose poster wouldn't decode gets a
            // blank tile rather than a mic it doesn't deserve.
            <span className="border-border bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded border">
              {!clip.hasVideo && !clip.probing && <Mic className="size-4" />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm">
              clip {i + 1}
              {!clip.probing && ` · ${mmss(clip.durationMs)}`}
            </p>
            <p className="text-muted-foreground text-xs">
              {clip.probing ? 'reading…' : megabytes(clip.file.size)}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Remove clip ${i + 1}`}
            onClick={() => onRemove(clip.id)}
            className="text-muted-foreground hover:text-foreground shrink-0 p-1">
            <X className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Both ways in, on one row. The mic path holds its stream for exactly as long
 * as it is recording — armed on click, released on stop and on unmount, never
 * left open behind a page the person walked away from.
 */
export function AddClips({
  onAdd,
  disabled,
}: {
  onAdd: (files: File[]) => void
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [armed, setArmed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [refused, setRefused] = useState(false)

  const release = useCallback(() => {
    const live = stream.current
    if (!live) return
    for (const track of live.getTracks()) track.stop()
    stream.current = null
  }, [])

  useEffect(() => {
    return () => {
      const active = recorder.current
      if (active && active.state !== 'inactive') active.stop()
      recorder.current = null
      release()
    }
  }, [release])

  useEffect(() => {
    if (!armed) return
    const began = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Date.now() - began), 500)
    return () => window.clearInterval(timer)
  }, [armed])

  const start = useCallback(async () => {
    setRefused(false)
    let opened: MediaStream
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setRefused(true)
      return
    }
    stream.current = opened
    // Safari writes m4a and reads little else; everywhere else takes webm.
    const type = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm'
    let active: MediaRecorder
    try {
      active = new MediaRecorder(opened, { mimeType: type })
    } catch {
      // isTypeSupported lies on a couple of browsers; the default container is
      // still something the pipeline can decode.
      active = new MediaRecorder(opened)
    }
    const chunks: Blob[] = []
    active.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    active.onstop = () => {
      release()
      recorder.current = null
      setArmed(false)
      // What it actually wrote, which is not always what we asked for.
      const wrote = active.mimeType || type
      const blob = new Blob(chunks, { type: wrote })
      if (blob.size) onAdd([new File([blob], 'voice-note', { type: wrote })])
    }
    recorder.current = active
    active.start()
    setArmed(true)
  }, [onAdd, release])

  const stop = useCallback(() => {
    const active = recorder.current
    if (active && active.state !== 'inactive') active.stop()
  }, [])

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept={CLIP_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (picked.length) onAdd(picked)
        }}
      />

      {armed ? (
        <div className="border-border flex items-center gap-3 rounded-md border px-3 py-2.5">
          <span className="bg-destructive size-2 shrink-0 animate-pulse rounded-full" />
          <span className="font-mono text-sm">{mmss(elapsed)}</span>
          <button
            type="button"
            onClick={stop}
            className="text-primary ml-auto text-sm underline underline-offset-4">
            stop
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => input.current?.click()}>
            <Plus />
            add a clip
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => void start()}>
            <span aria-hidden className="font-mono">
              ◉
            </span>
            record a voice note
          </Button>
        </div>
      )}

      {refused && (
        <p className="text-muted-foreground text-sm">
          microphone was refused — check the site permissions
        </p>
      )}
    </div>
  )
}
