'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Search, Briefcase, ShieldCheck, LogOut, Radar, GitMerge, Activity, History, FileSearch, FolderCog } from 'lucide-react'
import { cn } from '@/lib/cn'

const NAV_ITEMS = [
  { href: '/', label: 'Search', icon: Search },
  { href: '/history', label: 'History', icon: History },
  { href: '/cases', label: 'Cases', icon: Briefcase },
  { href: '/resolution', label: 'Review Queue', icon: GitMerge },
  { href: '/csv-search', label: 'CSV Search', icon: FileSearch },
]

const ADMIN_NAV_ITEMS = [
  { href: '/admin/sources', label: 'Source Health', icon: Activity },
  { href: '/admin/csv-sources', label: 'CSV Sources', icon: FolderCog },
]

export function SidebarNav({ user }: { user: { displayName: string; role: string; email: string } }) {
  const pathname = usePathname()
  const router = useRouter()
  const navItems = ['admin', 'supervisor', 'auditor'].includes(user.role) ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS

  async function onLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-2 px-4 py-4">
        <Radar className="h-5 w-5 text-[var(--accent)]" />
        <span className="text-sm font-semibold tracking-tight">OSINT Dashboard</span>
      </div>

      <nav className="flex-1 px-2 py-2">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                active
                  ? 'bg-[var(--accent-dim)] text-[var(--accent-fg)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-[var(--border-subtle)] px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-dim)] text-xs font-semibold text-[var(--accent-fg)]">
            {user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-[var(--text-primary)]">{user.displayName}</div>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <ShieldCheck className="h-2.5 w-2.5" /> {user.role}
            </div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </aside>
  )
}
