import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/server/auth'
import { SidebarNav } from '@/components/sidebar-nav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="flex">
      <SidebarNav user={user} />
      <main className="h-screen flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
