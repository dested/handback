// The editorial numbered section (ui.md: `01 / 02 / 03` mono numerals) shared by
// the two setup pages — /connect wires up the agent, /recorder wires up the
// extension. Same rhythm on both so the pair reads as one flow.

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
    <section className="border-border grid grid-cols-[3rem_1fr] gap-x-4 border-t pt-6">
      <span className="text-muted-foreground font-mono text-sm">{n}</span>
      <div className="min-w-0">
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{blurb}</p>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  )
}
