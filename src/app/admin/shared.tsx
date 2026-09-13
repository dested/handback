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
    <div className="bg-card min-w-[9rem] rounded-lg border p-4">
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs font-medium">{label}</p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
    </div>
  )
}

export function PageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="space-y-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-[13px]">{sub}</p>
    </header>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-border flex items-baseline justify-between border-b pb-2">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {right}
    </div>
  )
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'text-muted-foreground border-border border-b px-3 py-1.5 text-left text-xs font-medium',
        className
      )}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn('border-border/60 border-b px-3 py-2.5 align-middle', className)}>
      {children}
    </td>
  )
}

export const Loading = () => <p className="text-muted-foreground text-sm">Loading…</p>

export function ErrorText({ message }: { message: string }) {
  return <p className="text-destructive text-sm">{message}</p>
}
