// The agent's result, as a bordered card: the summary, the files it touched as
// mono chips, and a links row — the PR, a toggle that opens the evidence shots
// inline, and a toggle for the full write-up.

import { useState } from 'react'
import { Markdown } from '~/components/viewer/desk/markdown'
import type { Walkthrough } from '~/components/viewer/types'

type Note = Walkthrough['notes'][number]

export function ResultCard({
  note,
  urlByPath,
}: {
  note: Note
  urlByPath: Map<string, string>
}) {
  const [showBody, setShowBody] = useState(false)
  const [showShots, setShowShots] = useState(false)

  const shownFiles = note.filesTouched.slice(0, 6)
  const moreFiles = note.filesTouched.length - shownFiles.length
  const shots = note.evidencePaths
    .map((path) => ({ path, url: urlByPath.get(path) }))
    .filter((s): s is { path: string; url: string } => s.url !== undefined)

  return (
    <section>
      <h3 className="text-foreground mb-1 text-[13px] font-semibold">
        Result from {note.authorName}
      </h3>
      <div className="border-border bg-card space-y-3 rounded-lg border p-4">
        <p className="text-[13px] leading-relaxed">{note.summary}</p>

        {shownFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shownFiles.map((file) => (
              <span
                key={file}
                className="bg-muted text-foreground/80 rounded px-1.5 py-0.5 font-mono text-[11px] break-all">
                {file}
              </span>
            ))}
            {moreFiles > 0 && (
              <span className="text-muted-foreground font-mono text-[11px]">+{moreFiles} more</span>
            )}
          </div>
        )}

        {(note.prUrl || shots.length > 0 || note.bodyMd) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {note.prUrl && (
              <a
                href={note.prUrl}
                target="_blank"
                rel="noreferrer"
                className="text-cobalt font-mono text-xs hover:underline">
                view the PR ↗
              </a>
            )}
            {shots.length > 0 && (
              <button
                type="button"
                onClick={() => setShowShots((s) => !s)}
                className="text-cobalt font-mono text-xs hover:underline">
                {shots.length} evidence screenshot{shots.length === 1 ? '' : 's'}
              </button>
            )}
            {note.bodyMd && (
              <button
                type="button"
                onClick={() => setShowBody((s) => !s)}
                className="text-muted-foreground hover:text-foreground font-mono text-xs">
                {showBody ? 'Hide write-up' : 'Full write-up'}
              </button>
            )}
          </div>
        )}

        {showShots && shots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {shots.map((shot) => (
              <a key={shot.path} href={shot.url} target="_blank" rel="noreferrer">
                <img src={shot.url} alt="" className="border-border h-20 rounded border object-cover" />
              </a>
            ))}
          </div>
        )}

        {showBody && note.bodyMd && <Markdown className="text-[13px]">{note.bodyMd}</Markdown>}
      </div>
    </section>
  )
}
