import { getCurrentUser } from '@/server/auth'
import { ResolutionQueue } from '@/components/resolution-queue'

export default async function ResolutionPage() {
  const user = await getCurrentUser()
  const canDecide = user?.role === 'admin' || user?.role === 'supervisor'

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Entity Resolution Queue</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Pairs of entities the matcher thinks might be the same person but isn&apos;t confident enough to merge automatically. Every decision here is written to the audit log.
        </p>
      </div>
      <ResolutionQueue canDecide={canDecide} />
    </div>
  )
}
