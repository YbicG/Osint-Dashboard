'use client'

import { useState } from 'react'
import { LayoutGrid, Clock3, Waypoints, Map as MapIcon } from 'lucide-react'
import { DossierTabs } from '@/components/dossier-tabs'
import { TimelineView } from '@/components/timeline-view'
import { LinkGraph } from '@/components/link-graph'
import { MapView } from '@/components/map-view'
import { cn } from '@/lib/cn'
import type { DossierClaim } from '@/server/dossier'

const VIEWS = [
  { id: 'claims', label: 'Claims', icon: LayoutGrid },
  { id: 'timeline', label: 'Timeline', icon: Clock3 },
  { id: 'graph', label: 'Graph', icon: Waypoints },
  { id: 'map', label: 'Map', icon: MapIcon },
] as const

type ViewId = (typeof VIEWS)[number]['id']

export interface DossierViewSwitcherProps {
  entityId: string
  centerLabel: string
  claims: DossierClaim[]
  edges: { id: string; type: string; sourceEntityId: string; targetEntityId: string; confidence: number }[]
  relatedEntities: { id: string; type: string; displayLabel: string }[]
  redactMode?: boolean
  redactedIds?: Set<string>
  onToggleRedact?: (claimId: string) => void
}

const ADDRESS_PREDICATES = new Set(['current_address', 'former_address'])

export function DossierViewSwitcher({
  entityId, centerLabel, claims, edges, relatedEntities, redactMode, redactedIds, onToggleRedact,
}: DossierViewSwitcherProps) {
  const [view, setView] = useState<ViewId>('claims')
  const addressClaims = claims.filter((c) => ADDRESS_PREDICATES.has(c.predicate))

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-[var(--border-subtle)] pb-2">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition',
              view === id
                ? 'bg-[var(--accent-dim)] text-[var(--accent-fg)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {view === 'claims' && (
        <DossierTabs claims={claims} redactMode={redactMode} redactedIds={redactedIds} onToggleRedact={onToggleRedact} />
      )}
      {view === 'timeline' && <TimelineView claims={claims} />}
      {view === 'graph' && (
        <LinkGraph entityId={entityId} edges={edges} relatedEntities={relatedEntities} centerLabel={centerLabel} />
      )}
      {view === 'map' && <MapView entityId={entityId} addressClaims={addressClaims} />}
    </div>
  )
}
