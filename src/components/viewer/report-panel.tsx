import { useQuery } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { SectionHead } from './section-head'
import { useCopy } from './use-copy'

/**
 * report.md verbatim. Deliberately unrendered — the point of this section is to
 * show the human exactly what the agent will read, markdown syntax and all.
 */
export function ReportPanel({
  walkthroughId,
  url,
}: {
  walkthroughId: string
  url: string | undefined
}) {
  const { copied, copy } = useCopy()

  const report = useQuery({
    queryKey: ['handback.report', walkthroughId],
    enabled: url !== undefined,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const res = await fetch(url!)
      if (!res.ok) throw new Error(`report.md failed (${res.status})`)
      return res.text()
    },
  })

  const text = report.data

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <SectionHead>report</SectionHead>
          <p className="text-muted-foreground text-sm">
            Authored for the agent, not for you — this is exactly what your agent reads.
          </p>
        </div>
        {text !== undefined && (
          <Button variant="outline" size="sm" onClick={() => copy(text)}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>

      {url === undefined ? (
        <p className="text-muted-foreground text-sm">This walkthrough has no report.md.</p>
      ) : report.isError ? (
        <p className="text-muted-foreground text-sm">Couldn't load report.md.</p>
      ) : text === undefined ? (
        <div className="bg-muted h-40 animate-pulse rounded-md" />
      ) : (
        <pre className="bg-card max-h-[560px] overflow-y-auto rounded-md border p-4 font-mono text-xs whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </section>
  )
}
