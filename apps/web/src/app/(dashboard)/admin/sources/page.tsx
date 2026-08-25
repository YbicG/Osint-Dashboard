import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/server/auth'
import { AdminSourcesTable } from '@/components/admin-sources-table'

export default async function AdminSourcesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'supervisor' && user.role !== 'auditor') redirect('/')

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Source Health</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Every connector's run history — hit/miss/blocked/error breakdown, claim yield, and (admin-only) a kill switch for a source that's misbehaving.
        </p>
      </div>
      <AdminSourcesTable canToggle={user.role === 'admin'} />
    </div>
  )
}
