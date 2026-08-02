// Formatters and small pieces shared by every page under /admin.

import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Formatted from UTC parts on purpose: locale formatting differs between the
// SSR runtime and the browser, which would break hydration.
export function fmtDate(value: string | null) {
  if (!value) return 'never'
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export function fmtBytes(n: number) {
  const gb = n / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`
}

export function fmtDuration(ms: number) {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export const STATUS_CLASS: Record<string, string> = {
  open: 'bg-cobalt-wash text-cobalt',
  in_review: 'bg-review-wash text-review',
  resolved: 'bg-approve-wash text-approve',
}

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded px-2 py-0.5 text-xs font-medium',
        STATUS_CLASS[status] ?? 'bg-muted text-muted-foreground'
      )}>
      {status === 'in_review' ? 'in review' : status}
    </span>
  )
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div>
      <p className="font-mono text-2xl">{value}</p>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
    </div>
  )
}

export function PageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="space-y-1">
      <h1 className="font-display text-3xl font-semibold">{title}</h1>
      <p className="text-muted-foreground text-sm">{sub}</p>
    </header>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-border flex items-baseline justify-between border-b pb-2">
      <h2 className="font-display text-xl font-semibold">{children}</h2>
      {right}
    </div>
  )
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'text-muted-foreground pr-4 pb-2 text-left text-xs font-medium tracking-wide uppercase',
        className
      )}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn('border-border border-t py-2.5 pr-4 align-top', className)}>{children}</td>
  )
}

export const Loading = () => <p className="text-muted-foreground text-sm">Loading…</p>

export function ErrorText({ message }: { message: string }) {
  return <p className="text-destructive text-sm">{message}</p>
}
