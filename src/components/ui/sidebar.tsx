// shadcn's sidebar primitive re-cut for this repo: no radix, no asChild, light-only.
// Collapsed state persists to localStorage; mobile renders as an overlay panel.
import * as React from 'react'
import { PanelLeft, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '~/lib/utils'

const STORAGE_KEY = 'handback.adminSidebar'

type SidebarContextValue = {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useSidebar must be used within SidebarProvider')
  }
  return ctx
}

function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Starts expanded on both server and client — reading localStorage in the
  // initializer would render a different width than the SSR markup and break
  // hydration. The persisted state lands in an effect, after first paint.
  const [collapsed, setCollapsedState] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)

  React.useEffect(() => {
    if (window.localStorage.getItem(STORAGE_KEY) === 'collapsed') setCollapsedState(true)
  }, [])

  const setCollapsed = React.useCallback((v: boolean) => {
    setCollapsedState(v)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, v ? 'collapsed' : 'open')
    }
  }, [])

  const value = React.useMemo<SidebarContextValue>(
    () => ({ collapsed, setCollapsed, mobileOpen, setMobileOpen }),
    [collapsed, setCollapsed, mobileOpen]
  )

  return (
    <SidebarContext.Provider value={value}>
      <div data-slot="sidebar-provider" className="flex w-full flex-1 items-stretch">
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({ children, className }: { children?: React.ReactNode; className?: string }) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar()

  React.useEffect(() => {
    if (!mobileOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen, setMobileOpen])

  return (
    <>
      <aside
        data-slot="sidebar"
        data-collapsed={collapsed ? '' : undefined}
        className={cn(
          'group/sidebar bg-sidebar border-sidebar-border sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-200 md:flex',
          collapsed ? 'w-14' : 'w-60',
          className
        )}
      >
        {children}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/20" onClick={() => setMobileOpen(false)} />
          <aside
            data-slot="sidebar"
            className="group/sidebar bg-sidebar border-sidebar-border absolute inset-y-0 left-0 flex w-64 flex-col border-r shadow-sm"
          >
            {children}
          </aside>
        </div>
      )}
    </>
  )
}

function SidebarHeader({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn(
        'border-sidebar-border flex h-14 shrink-0 items-center gap-2 border-b px-4 group-data-[collapsed]/sidebar:justify-center group-data-[collapsed]/sidebar:px-0',
        className
      )}
    >
      {children}
    </div>
  )
}

function SidebarContent({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div data-slot="sidebar-content" className={cn('flex-1 overflow-y-auto py-2', className)}>
      {children}
    </div>
  )
}

function SidebarFooter({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn('border-sidebar-border border-t p-2', className)}
    >
      {children}
    </div>
  )
}

function SidebarGroup({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div data-slot="sidebar-group" className={cn('px-2 py-2', className)}>
      {children}
    </div>
  )
}

function SidebarGroupLabel({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <p
      data-slot="sidebar-group-label"
      className={cn(
        'text-muted-foreground px-2.5 pb-1.5 font-mono text-[10px] font-medium tracking-[0.14em] uppercase group-data-[collapsed]/sidebar:hidden',
        className
      )}
    >
      {children}
    </p>
  )
}

function SidebarMenu({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <ul data-slot="sidebar-menu" className={cn('flex flex-col gap-0.5', className)}>
      {children}
    </ul>
  )
}

function SidebarMenuItem({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <li data-slot="sidebar-menu-item" className={className}>
      {children}
    </li>
  )
}

const itemClass =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0 group-data-[collapsed]/sidebar:justify-center group-data-[collapsed]/sidebar:px-0'

function SidebarMenuButton({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      title={label}
      onClick={onClick}
      className={cn(
        itemClass,
        'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
        className
      )}
    >
      <Icon />
      <span className="truncate group-data-[collapsed]/sidebar:hidden">{label}</span>
    </button>
  )
}

function SidebarMenuLink({
  to,
  end,
  icon: Icon,
  label,
  className,
}: {
  to: string
  end?: boolean
  icon: LucideIcon
  label: string
  className?: string
}) {
  const { setMobileOpen } = useSidebar()
  return (
    <NavLink
      to={to}
      end={end}
      data-slot="sidebar-menu-link"
      title={label}
      onClick={() => setMobileOpen(false)}
      className={({ isActive }) =>
        cn(
          itemClass,
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
          className
        )
      }
    >
      <Icon />
      <span className="truncate group-data-[collapsed]/sidebar:hidden">{label}</span>
    </NavLink>
  )
}

function SidebarSeparator({ className }: { className?: string }) {
  return (
    <div
      data-slot="sidebar-separator"
      className={cn('border-sidebar-border mx-2 my-2 border-t', className)}
    />
  )
}

function SidebarTrigger({ className }: { className?: string }) {
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen } = useSidebar()
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      aria-label="Toggle sidebar"
      onClick={() => {
        if (window.matchMedia('(min-width: 768px)').matches) {
          setCollapsed(!collapsed)
        } else {
          setMobileOpen(!mobileOpen)
        }
      }}
      className={cn(
        'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors [&_svg]:size-4',
        className
      )}
    >
      <PanelLeft />
    </button>
  )
}

function SidebarInset({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div data-slot="sidebar-inset" className={cn('min-w-0 flex-1', className)}>
      {children}
    </div>
  )
}

export {
  useSidebar,
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuLink,
  SidebarSeparator,
  SidebarTrigger,
  SidebarInset,
}
