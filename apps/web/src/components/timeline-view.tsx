'use client'

import { useEffect, useMemo, useState } from 'react'
import { CATEGORY_LABELS, CATEGORY_ORDER, predicateCategory } from '@/lib/predicate-labels'
import { ClaimCard } from '@/components/claim-card'
import { cn } from '@/lib/cn'
import type { DossierClaim } from '@/server/dossier'

/**
 * Category -> color mapping for the timeline's left rail.
 *
 * Deliberately reuses the existing design tokens (--accent, --status-hit,
 * --status-pending, --status-blocked, --status-error, --status-miss) rather
 * than inventing a new palette. There are only 5 distinct hues in the
 * system (blue/accent, green/hit, gray/miss, amber/blocked, red/error --
 * the --confidence tokens are color-for-color aliases of the --status
 * ones), so the 13 predicate categories are grouped onto those 5 by rough
 * semantic weight: identity-adjacent goes blue, verified holdings and
 * records go green, associative or sensitive data goes amber, legal
 * severity goes red, incidental or administrative records go gray.
 */
const CATEGORY_COLOR_VAR: Record<string, string> = {
  identity: 'var(--accent)',
  contact: 'var(--accent)',
  digital: 'var(--accent)',
  addresses: 'var(--status-hit)',
  property_assets: 'var(--status-hit)',
  vital_records: 'var(--status-hit)',
  business: 'var(--status-pending)',
  relationships: 'var(--status-blocked)',
  financial: 'var(--status-blocked)',
  criminal_legal: 'var(--status-error)',
  watchlists: 'var(--status-error)',
  vehicles: 'var(--status-miss)',
  media: 'var(--status-miss)',
}

function categoryColor(category: string): string {
  return CATEGORY_COLOR_VAR[category] ?? 'var(--status-miss)'
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Rendered per "page" and on each Load More click. This is a plain
 * slice-and-grow window, not a virtualized list — see the notes returned
 * alongside this component for why that tradeoff is fine for v1.
 */
const PAGE_SIZE = 50

type DatedClaim = DossierClaim & { observedAt: Date }

export function TimelineView({ claims }: { claims: DossierClaim[] }) {
  const datedClaims = useMemo(
    () => claims.filter((c): c is DatedClaim => c.observedAt !== null),
    [claims],
  )
  const undatedCount = claims.length - datedClaims.length

  const categoriesPresent = useMemo(() => {
    const set = new Set(datedClaims.map((c) => predicateCategory(c.predicate)))
    return CATEGORY_ORDER.filter((c) => set.has(c))
  }, [datedClaims])

  const sourcesPresent = useMemo(
    () => [...new Set(datedClaims.map((c) => c.sourceName))].sort((a, b) => a.localeCompare(b)),
    [datedClaims],
  )

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set(categoriesPresent))
  const [selectedSources, setSelectedSources] = useState<Set<string>>(() => new Set(sourcesPresent))
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Changing a filter invalidates the current window — otherwise "Load
  // more" math (and the "N of M" footer) would be counting against the
  // pre-filter list.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [selectedCategories, selectedSources])

  const filteredSorted = useMemo(
    () =>
      datedClaims
        .filter((c) => selectedCategories.has(predicateCategory(c.predicate)) && selectedSources.has(c.sourceName))
        .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()),
    [datedClaims, selectedCategories, selectedSources],
  )

  const visible = filteredSorted.slice(0, visibleCount)

  const yearGroups = useMemo(() => {
    const yearMap = new Map<number, Map<number, DatedClaim[]>>()
    for (const c of visible) {
      const y = c.observedAt.getFullYear()
      const m = c.observedAt.getMonth()
      if (!yearMap.has(y)) yearMap.set(y, new Map())
      const monthMap = yearMap.get(y)!
      if (!monthMap.has(m)) monthMap.set(m, [])
      monthMap.get(m)!.push(c)
    }
    return [...yearMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, monthMap]) => ({
        year,
        months: [...monthMap.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([month, monthClaims]) => ({ month, claims: monthClaims })),
      }))
  }, [visible])

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function toggleSource(src: string) {
    setSelectedSources((prev) => {
      const next = new Set(prev)
      if (next.has(src)) next.delete(src)
      else next.add(src)
      return next
    })
  }

  if (datedClaims.length === 0) {
    return (
      <div className="flex flex-col gap-2 py-8">
        <p className="text-center text-sm text-[var(--text-muted)]">No dated claims to plot.</p>
        {undatedCount > 0 && (
          <p className="text-center text-xs text-[var(--text-muted)]">
            {undatedCount} claim{undatedCount === 1 ? '' : 's'} {undatedCount === 1 ? 'has' : 'have'} no date and
            aren&apos;t shown here.
          </p>
        )}
      </div>
    )
  }

  const filtersActive = selectedCategories.size < categoriesPresent.length || selectedSources.size < sourcesPresent.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <FilterGroup
          label="Category"
          options={categoriesPresent}
          selected={selectedCategories}
          onToggle={toggleCategory}
          renderLabel={(c) => CATEGORY_LABELS[c] ?? c}
          swatch={categoryColor}
        />
        {sourcesPresent.length > 1 && (
          <FilterGroup
            label="Source"
            options={sourcesPresent}
            selected={selectedSources}
            onToggle={toggleSource}
            renderLabel={(s) => s}
          />
        )}
      </div>

      {filteredSorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">No claims match the current filters.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {yearGroups.map((yg) => (
            <div key={yg.year}>
              <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{yg.year}</div>
              <div className="flex flex-col gap-5">
                {yg.months.map((mg) => (
                  <div key={mg.month}>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      {MONTH_NAMES[mg.month]}
                    </div>
                    <div className="flex flex-col gap-2">
                      {mg.claims.map((claim) => {
                        const cat = predicateCategory(claim.predicate)
                        const color = categoryColor(cat)
                        return (
                          <div key={claim.id} className="flex gap-2.5">
                            <div className="flex w-9 flex-shrink-0 justify-end pt-2.5 font-mono text-[10px] text-[var(--text-muted)]">
                              {String(claim.observedAt.getDate()).padStart(2, '0')}
                            </div>
                            <div
                              className="w-[3px] flex-shrink-0 rounded-full"
                              style={{ backgroundColor: color }}
                              title={CATEGORY_LABELS[cat] ?? cat}
                            />
                            <div className="min-w-0 flex-1">
                              <ClaimCard claim={claim} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {filteredSorted.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
              className="self-center rounded-md border border-[var(--border-default)] bg-[var(--bg-hover)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
            >
              Load {Math.min(PAGE_SIZE, filteredSorted.length - visibleCount)} more ({filteredSorted.length - visibleCount} remaining)
            </button>
          )}
        </div>
      )}

      <div className="border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--text-muted)]">
        Showing {Math.min(visibleCount, filteredSorted.length)} of {filteredSorted.length} dated claims
        {filtersActive ? ' (filtered)' : ''}.
        {undatedCount > 0 &&
          ` ${undatedCount} claim${undatedCount === 1 ? '' : 's'} ${undatedCount === 1 ? 'has' : 'have'} no date and aren't shown here.`}
      </div>
    </div>
  )
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
  renderLabel,
  swatch,
}: {
  label: string
  options: string[]
  selected: Set<string>
  onToggle: (value: string) => void
  renderLabel: (value: string) => string
  swatch?: (value: string) => string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      {options.map((opt) => {
        const active = selected.has(opt)
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(opt)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition',
              active
                ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent-fg)]'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]',
            )}
          >
            {swatch && (
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: swatch(opt), opacity: active ? 1 : 0.5 }}
              />
            )}
            {renderLabel(opt)}
          </button>
        )
      })}
    </div>
  )
}
