/** The section label every viewer surface leads with — a plain, dense heading. */
export function SectionHead({ children }: { children: React.ReactNode }) {
  return <p className="text-foreground text-[13px] font-semibold normal-case">{children}</p>
}
