'use client'

import { useState } from 'react'
import { EyeOff, Eye } from 'lucide-react'
import { DossierViewSwitcher } from '@/components/dossier-view-switcher'
import { ExportMenu } from '@/components/export-menu'
import { cn } from '@/lib/cn'
import type { DossierClaim } from '@/server/dossier'

/**
 * Owns redaction selection state and renders the export controls alongside
 * the claims/timeline/graph/map view switcher. Redaction here is
 * report-scoping only — checking a claim never modifies or retracts it, it
 * just tells the next PDF/CSV/JSON export (see /api/entities/[id]/report's
 * `exclude` param) to leave it out. Lives above DossierViewSwitcher because
 * the redacted set has to survive switching views (redact a claim while
 * looking at Claims, then check the Export menu without losing the
 * selection).
 */
export interface DossierWorkspaceProps {
  entityId: string
  centerLabel: string
  claims: DossierClaim[]
  edges: { id: string; type: string; sourceEntityId: string; targetEntityId: string; confidence: number }[]
  relatedEntities: { id: string; type: string; displayLabel: string }[]
}

export function DossierWorkspace({ entityId, centerLabel, claims, edges, relatedEntities }: DossierWorkspaceProps) {
  const [redactMode, setRedactMode] = useState(false)
  const [redactedIds, setRedactedIds] = useState<Set<string>>(new Set())

  function toggleRedact(claimId: string) {
    setRedactedIds((prev) => {
      const next = new Set(prev)
      if (next.has(claimId)) next.delete(claimId)
      else next.add(claimId)
      return next
    })
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        <button
          onClick={() => setRedactMode((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition',
            redactMode
              ? 'border-[var(--status-error)]/40 bg-[var(--status-error)]/10 text-[var(--status-error)]'
              : 'border-[var(--border-default)] bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          )}
        >
          {redactMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {redactMode ? 'Done redacting' : 'Redact for export'}
        </button>
        <ExportMenu entityId={entityId} excludedIds={redactedIds} />
      </div>

      {redactMode && (
        <div className="mb-4 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
          Check any claim below to exclude it from the next PDF/CSV/JSON export. This does not delete or retract the
          claim — it stays in the dossier and in every collection run's record, it just won't appear in the report
          you download.
        </div>
      )}

      <DossierViewSwitcher
        entityId={entityId}
        centerLabel={centerLabel}
        claims={claims}
        edges={edges}
        relatedEntities={relatedEntities}
        redactMode={redactMode}
        redactedIds={redactedIds}
        onToggleRedact={toggleRedact}
      />
    </div>
  )
}
