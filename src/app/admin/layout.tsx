// The /admin shell: the admin-only gate, then the sidebar frame every admin
// page renders inside.

import { useQuery } from '@tanstack/react-query'
import { Link, Outlet } from 'react-router-dom'
import { ArrowLeft, Building2, Calculator, Film, Gauge, HardDrive, Scale, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuLink,
  SidebarProvider,
  SidebarTrigger,
} from '~/components/ui/sidebar'
import { useTRPC } from '~/lib/trpc'
import { ErrorText, Loading } from './shared'

const NAV = [
  { to: '/admin', end: true, icon: Gauge, label: 'Overview' },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/teams', icon: Building2, label: 'Teams' },
  { to: '/admin/walkthroughs', icon: Film, label: 'Walkthroughs' },
  { to: '/admin/usage', icon: HardDrive, label: 'Usage' },
  { to: '/admin/pricing', icon: Scale, label: 'Pricing' },
  { to: '/admin/costs', icon: Calculator, label: 'Costs' },
]

export function AdminLayout() {
  const trpc = useTRPC()
  const status = useQuery(trpc.admin.status.queryOptions())

  if (status.isPending)
    return (
      <div className="px-6 py-8">
        <Loading />
      </div>
    )

  // A failed probe must not read as "you're not an admin".
  if (status.isError)
    return (
      <div className="px-6 py-8">
        <ErrorText message={status.error.message} />
      </div>
    )

  if (!status.data?.isAdmin)
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Admins only</CardTitle>
            <CardDescription>This page is for platform admins.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/app" className="text-primary text-sm underline underline-offset-4">
              Back to the inbox
            </Link>
          </CardContent>
        </Card>
      </div>
    )

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.14em] uppercase group-data-[collapsed]/sidebar:hidden">
            Admin
          </span>
          <SidebarTrigger className="ml-auto group-data-[collapsed]/sidebar:ml-0" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuLink
                    to={item.to}
                    end={item.end}
                    icon={item.icon}
                    label={item.label}
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuLink to="/app" icon={ArrowLeft} label="Back to app" />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="mb-2 flex items-center gap-2 px-6 pt-4 md:hidden">
          <SidebarTrigger />
          <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.14em] uppercase">
            Admin
          </span>
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
