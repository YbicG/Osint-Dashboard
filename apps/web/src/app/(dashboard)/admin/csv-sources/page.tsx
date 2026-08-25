import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/server/auth'
import { AdminCsvSourcesTable } from '@/components/admin-csv-sources-table'
import { AddCsvFolderForm } from '@/components/add-csv-folder-form'

export default async function AdminCsvSourcesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'supervisor' && user.role !== 'auditor') redirect('/')

  const canManage = user.role === 'admin'

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">CSV Sources</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Folders on the server the CSV Search tab indexes. {canManage ? 'Any absolute path the server can read is allowed — adding a folder is an admin action, so this trusts you to point it somewhere authorized.' : 'Read-only for your role — an admin manages which folders are indexed.'}
        </p>
      </div>
      {canManage && <AddCsvFolderForm />}
      <AdminCsvSourcesTable canManage={canManage} />
    </div>
  )
}
