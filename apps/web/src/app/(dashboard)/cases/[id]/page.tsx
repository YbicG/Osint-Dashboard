import { getCurrentUser } from '@/server/auth'
import { CaseDetail } from '@/components/case-detail'

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  const canManage = user?.role === 'admin' || user?.role === 'supervisor'

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <CaseDetail caseId={id} canManage={canManage} />
    </div>
  )
}
