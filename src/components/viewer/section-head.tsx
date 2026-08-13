/** The small-caps mono section label every viewer surface leads with. */
export function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
      {children}
    </p>
  )
}
