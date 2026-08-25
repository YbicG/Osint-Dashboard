import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/server/auth'
import { CsvSearchWorkspace } from '@/components/csv-search-workspace'

export default async function CsvSearchPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">CSV Search</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Search across indexed CSV files from authorized source folders. Sensitive fields (SSNs, dates of birth, and similar identifiers) are masked until revealed, and every full record you open is logged.
        </p>
      </div>
      <CsvSearchWorkspace />
    </div>
  )
}
