// Shared by the two setup pages — /connect wires up the agent, /recorder wires
// up the extension. Same rhythm on both so the pair reads as one flow.
//
// Numbers are for things the person actually does here. Reference material
// (tool lists, disconnect instructions, token management) gets a plain heading
// instead, so the step count on either page stays honest and small.

export function Step({
  n,
  title,
  blurb,
  children,
}: {
  n: string
  title: string
  blurb: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-card border-border flex gap-4 rounded-lg border p-5">
      <span className="bg-cobalt-wash text-cobalt flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">{blurb}</p>
        <div className="mt-4">{children}</div>
      </div>
    </section>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A token name nobody has to think of. Both setup pages mint tokens on a single
 * click, so the name can't be a question asked up front — the machine plus the
 * day is enough to tell two apart in the list a month later, which is the only
 * job the name has.
 *
 * Call it from a handler, never during render: `navigator` and the local date
 * both differ between the SSR runtime and the browser.
 */
export function autoTokenName(kind: string, userAgent: string, now: Date): string {
  const os = /iPhone|iPod/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Macintosh|Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Android/.test(userAgent)
            ? 'Android'
            : /Linux|X11/.test(userAgent)
              ? 'Linux'
              : null
  const day = `${MONTHS[now.getMonth()]} ${now.getDate()}`
  return os ? `${kind} — ${os}, ${day}` : `${kind} — ${day}`
}
