import { desc } from 'drizzle-orm'
import Link from 'next/link'
import { caseTable } from '@osint/db/schema'
import { db } from '@/server/db'
import { NewCaseForm } from '@/components/new-case-form'

export default async function CasesPage() {
  const cases = await db.select().from(caseTable).orderBy(desc(caseTable.createdAt))

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Cases</h1>
        <NewCaseForm />
      </div>

      {cases.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No cases yet. Cases group subjects, notes, and searches under one purpose-coded investigation.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {cases.map((c) => (
            <Link
              key={c.id}
              href={`/cases/${c.id}`}
              className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 transition hover:border-[var(--accent)]"
            >
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)]">{c.title}</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {c.purposeCode.replace(/_/g, ' ')} · created {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>
              <span className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                {c.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
