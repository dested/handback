import { Button } from '~/components/ui/button'
import { mmss } from '~/lib/capture/format'
import type { LiveUpdate, SourceState } from '~/lib/capture/live'
import { cn } from '~/lib/utils'

/**
 * What the recorder is doing, while it does it — the extension panel's
 * recording state, and the one piece of this page that has to be visible while
 * the person is somewhere else entirely. So it renders either in the page or
 * inside the Document PiP window (`pip.tsx`) without knowing which.
 *
 * The two audio lines are the whole reason this is more than a clock. Chrome
 * only offers "share audio" on tab and full-screen pickers, never on a window,
 * and its absence is completely silent — you find out when you play the take
 * back. So each source states itself in three parts: not shared, shared but
 * nothing heard yet, or live. "Shared but silent" minutes in means the sound is
 * reaching the ears through a device the browser isn't capturing.
 */

const AUDIO_WORDS: Record<SourceState, string> = {
  none: 'not shared',
  silent: 'silent',
  live: 'live',
}

function AudioLine({ label, state }: { label: string; state: SourceState }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'size-[7px] shrink-0 rounded-full',
          state === 'live' && 'bg-cobalt',
          // Shared but never heard is the failure worth naming; violet is the
          // warning ink (ui.md — nothing orange, ever).
          state === 'silent' && 'bg-review',
          state === 'none' && 'border-border border'
        )}
      />
      <span className="text-muted-foreground font-mono text-xs">
        {label} · {AUDIO_WORDS[state]}
      </span>
    </div>
  )
}

/** The two source lines + the mic-blocked warning, shared by the floating HUD
 *  and the in-page panel so they never state audio differently. */
export function AudioMeters({ live }: { live: LiveUpdate | null }) {
  const micDenied = live?.micState === 'denied'
  return (
    <div className="space-y-1.5">
      <AudioLine label="app audio" state={live?.sysAudio ?? 'none'} />
      <AudioLine label="your voice" state={micDenied ? 'none' : (live?.micAudio ?? 'none')} />
      {micDenied && (
        <p className="text-destructive text-xs">
          the mic was blocked — this take will have no narration
        </p>
      )}
    </div>
  )
}

export interface RecordingHudProps {
  live: LiveUpdate | null
  onStop: () => void
  stopping: boolean
  /** Present only when the HUD is floating; puts it back in the page. */
  onReturn?: () => void
}

export function RecordingHud({ live, onStop, stopping, onReturn }: RecordingHudProps) {
  return (
    <section className="bg-card border-border space-y-4 rounded-md border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="bg-destructive size-2.5 animate-pulse rounded-full" aria-hidden />
          <span className="font-display text-3xl font-semibold tabular-nums">
            {mmss(live?.elapsedMs ?? 0)}
          </span>
        </div>
        <span className="text-muted-foreground font-mono text-xs">
          {live?.frameCount ?? 0} keyframes
        </span>
      </div>

      <div className="border-border border-t pt-3">
        <AudioMeters live={live} />
      </div>

      <Button type="button" className="h-[46px] w-full" disabled={stopping} onClick={onStop}>
        {stopping ? 'finishing…' : 'Stop recording'}
      </Button>

      {onReturn && (
        <button
          type="button"
          onClick={onReturn}
          className="text-muted-foreground hover:text-foreground w-full text-center font-mono text-xs underline underline-offset-4">
          put this back in the page
        </button>
      )}
    </section>
  )
}
