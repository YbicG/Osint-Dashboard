import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Users, ArrowUpRight } from 'lucide-react'
import { getDossierData } from '@/server/dossier'
import { DossierWorkspace } from '@/components/dossier-workspace'
import { edgeTypeLabel } from '@/lib/edge-labels'

export default async function EntityDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getDossierData(id)
  if (!data) notFound()

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{data.entity.type}</div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">{data.entity.displayLabel}</h1>
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          {data.claims.length} claims across {new Set(data.claims.map((c) => c.sourceName)).size} sources
        </div>
      </div>

      {data.relatedEntities.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            <Users className="h-3.5 w-3.5" /> Relationships
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.edges.map((edge) => {
              const otherId = edge.sourceEntityId === id ? edge.targetEntityId : edge.sourceEntityId
              const other = data.relatedEntities.find((e) => e.id === otherId)
              if (!other) return null
              return (
                <Link
                  key={edge.id}
                  href={`/entities/${other.id}`}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                >
                  <span className="text-[var(--text-muted)]">{edgeTypeLabel(edge.type)}</span>
                  {other.displayLabel}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <DossierWorkspace
        entityId={data.entity.id}
        centerLabel={data.entity.displayLabel}
        claims={data.claims}
        edges={data.edges}
        relatedEntities={data.relatedEntities}
      />
    </div>
  )
}
