'use client'

import { useMemo, useState } from 'react'
import { CATEGORY_LABELS, CATEGORY_ORDER, predicateCategory } from '@/lib/predicate-labels'
import { ClaimCard } from '@/components/claim-card'
import { cn } from '@/lib/cn'
import type { DossierClaim } from '@/server/dossier'

export interface DossierTabsProps {
  claims: DossierClaim[]
  redactMode?: boolean
  redactedIds?: Set<string>
  onToggleRedact?: (claimId: string) => void
}

export function DossierTabs({ claims, redactMode = false, redactedIds, onToggleRedact }: DossierTabsProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, DossierClaim[]>()
    for (const claim of claims) {
      const cat = predicateCategory(claim.predicate)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(claim)
    }
    return map
  }, [claims])

  const availableCategories = CATEGORY_ORDER.filter((c) => grouped.has(c))
  const [active, setActive] = useState(availableCategories[0] ?? 'identity')

  if (claims.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--text-muted)]">No claims collected yet for this entity.</p>
  }

  const activeClaims = (grouped.get(active) ?? []).sort((a, b) => b.confidence - a.confidence)

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-[var(--border-subtle)] pb-2">
        {availableCategories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActive(cat)}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition',
              active === cat
                ? 'bg-[var(--accent-dim)] text-[var(--accent-fg)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
            )}
          >
            {CATEGORY_LABELS[cat] ?? cat}
            <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">{grouped.get(cat)!.length}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {activeClaims.map((claim) => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            redactable={redactMode}
            redacted={redactedIds?.has(claim.id)}
            onToggleRedact={onToggleRedact}
          />
        ))}
      </div>
    </div>
  )
}
