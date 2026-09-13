// Underline tab bar — the view/section switcher (List | Board, the walkthrough
// page's deep tabs). Controlled: the caller owns `value` and gets `onChange`.

import { cn } from '~/lib/utils'

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: { key: K; label: string; count?: number }[]
  value: K
  onChange: (k: K) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-row border-b border-border', className)}>
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              '-mb-px border-b-2 px-2.5 py-2 text-[13px] font-medium',
              active
                ? 'border-foreground text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            )}>
            {item.label}
            {item.count !== undefined && (
              <span className="text-muted-foreground ml-1.5 font-mono text-xs">{item.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
