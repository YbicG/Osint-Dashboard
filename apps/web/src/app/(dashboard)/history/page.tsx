import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { ArrowRight } from 'lucide-react'
import { searchRequest, appUser } from '@osint/db/schema'
import { db } from '@/server/db'
import { INPUT_TYPE_LABELS } from '@/lib/detect-input'

/**
 * Every search this org has ever run, newest first — the audit-adjacent
 * "what did we look for and when" view. Full accountability lives in
 * audit_log (hash-chained, every action); this is the human-scannable
 * subset scoped to searches specifically, since that's what an investigator
 * actually wants to revisit day to day.
 */
export default async function HistoryPage() {
  const searches = await db.select({ search: searchRequest, requestedByName: appUser.displayName })
    .from(searchRequest)
    .innerJoin(appUser, eq(searchRequest.requestedByUserId, appUser.id))
    .orderBy(desc(searchRequest.createdAt))
    .limit(100)

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Search History</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Last 100 searches across the organization, most recent first.</p>
      </div>

      {searches.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No searches yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {searches.map(({ search, requestedByName }) => {
            const payload = search.inputPayload as Record<string, unknown>
            const label = (payload.fullName ?? payload.raw ?? payload.value ?? search.inputType) as string
            return (
              <Link
                key={search.id}
                href={search.subjectEntityId ? `/entities/${search.subjectEntityId}` : `/search/${search.id}`}
                className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm transition hover:border-[var(--accent)]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex-shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    {INPUT_TYPE_LABELS[search.inputType as keyof typeof INPUT_TYPE_LABELS] ?? search.inputType}
                  </span>
                  <span className="truncate text-[var(--text-primary)]">{label}</span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 text-[11px] text-[var(--text-muted)]">
                  <span>{requestedByName}</span>
                  <span>{new Date(search.createdAt).toLocaleString()}</span>
                  <span className="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 uppercase tracking-wide">{search.purposeCode.replace(/_/g, ' ')}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
