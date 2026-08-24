// The one markdown renderer the desk uses — the digest, the verdict body, the
// working brief, the raw report all pass through here. Every element is styled
// on the `components` prop (never global CSS) so the light-paper voice holds:
// hairline rules and tables, cobalt links, IBM Plex Mono for anything code, and
// nothing orange. Fenced code is styled once on the <pre>; the <code> inside it
// stays bare so it isn't double-boxed.

import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '~/lib/utils'

const components: Components = {
  p: ({ children }) => <p className="mb-3 text-[14px] leading-relaxed last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="font-display mt-5 mb-2 text-[18px] font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-display mt-5 mb-2 text-[16px] font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-display mt-5 mb-2 text-[15px] font-semibold first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="text-[14px] leading-relaxed">{children}</li>,
  code: ({ className, children }) => {
    // v10 drops the `inline` flag: fenced blocks carry a language- class or run
    // multi-line, and the <pre> below styles those. Everything else is inline.
    const text = String(children ?? '')
    const isBlock = /language-/.test(className ?? '') || text.includes('\n')
    if (isBlock) return <code className={className}>{children}</code>
    return (
      <code className="bg-muted/40 rounded-sm px-1 py-0.5 font-mono text-[12.5px]">{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="bg-muted/30 mb-3 overflow-x-auto rounded-md border p-3 font-mono text-xs last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-border text-muted-foreground mb-3 border-l-2 pl-3 last:mb-0">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-cobalt hover:underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="border-border border-collapse font-mono text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-border bg-muted/30 border px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-border border px-2 py-1">{children}</td>,
  img: ({ src, alt }) => (
    <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} className="max-w-full rounded-md border" />
  ),
  hr: () => <hr className="border-border my-4 border-0 border-t" />,
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
