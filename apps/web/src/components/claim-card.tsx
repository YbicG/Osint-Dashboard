'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { predicateLabel, confidenceColorVar, confidenceTier } from '@/lib/predicate-labels'
import { cn } from '@/lib/cn'
import type { DossierClaim } from '@/server/dossier'

function formatValue(value: unknown): { primary: string; details: [string, string][] } {
  if (typeof value === 'string') return { primary: value, details: [] }
  if (typeof value === 'number' || typeof value === 'boolean') return { primary: String(value), details: [] }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '')
    // Prefer an obviously "primary" field if the payload has one, so the
    // card headline isn't just the first arbitrary JSON key.
    const primaryKey = ['fullName', 'name', 'matchedName', 'caseName', 'title', 'domain', 'subdomain', 'site', 'city']
      .find((k) => k in obj)
    const primary = primaryKey ? String(obj[primaryKey]) : entries[0] ? String(entries[0][1]) : '—'
    const details = entries
      .filter(([k]) => k !== primaryKey)
      .map(([k, v]) => [predicateLabel(k), Array.isArray(v) ? v.join(', ') : String(v)] as [string, string])
    return { primary, details }
  }
  return { primary: '—', details: [] }
}

export interface ClaimCardProps {
  claim: DossierClaim
  /** Redaction mode (see DossierWorkspace) — shows a checkbox to exclude this claim from the next report export. Purely a report-scoping tool: redacting here never touches the underlying claim or its collection_run. */
  redactable?: boolean
  redacted?: boolean
  onToggleRedact?: (claimId: string) => void
}

export function ClaimCard({ claim, redactable = false, redacted = false, onToggleRedact }: ClaimCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { primary, details } = formatValue(claim.value)
  const tier = confidenceTier(claim.confidence)

  return (
    <div className={cn('rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)]', redacted && 'opacity-50')}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
      >
        {redactable && (
          <input
            type="checkbox"
            checked={redacted}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleRedact?.(claim.id)}
            className="mt-1 h-3.5 w-3.5 flex-shrink-0 accent-[var(--status-error)]"
            title="Exclude from report export"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{predicateLabel(claim.predicate)}</div>
          <div className={cn('truncate text-sm text-[var(--text-primary)]', redacted && 'line-through')}>{primary}</div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
            style={{ color: confidenceColorVar(claim.confidence), backgroundColor: `color-mix(in srgb, ${confidenceColorVar(claim.confidence)} 15%, transparent)` }}
            title={`Confidence: ${(claim.confidence * 100).toFixed(0)}%`}
          >
            {tier === 'high' ? 'High' : tier === 'mid' ? 'Medium' : 'Low'}
          </span>
          <ChevronDown className={cn('h-3.5 w-3.5 text-[var(--text-muted)] transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2.5 text-xs">
          {details.length > 0 && (
            <dl className="mb-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              {details.map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="text-[var(--text-muted)]">{k}</dt>
                  <dd className="truncate text-[var(--text-secondary)]">{v}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {claim.rawSnippet && (
            <div className="mb-2 rounded bg-[var(--bg-canvas)] p-2 font-mono text-[11px] text-[var(--text-muted)]">
              {claim.rawSnippet}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-muted)]">
            <span>Source: <span className="text-[var(--text-secondary)]">{claim.sourceName}</span></span>
            {claim.observedAt && <span>Observed: {new Date(claim.observedAt).toLocaleDateString()}</span>}
            <span>Collected: {new Date(claim.collectedAt).toLocaleDateString()}</span>
            {claim.evidenceUrl && (
              <a
                href={claim.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[var(--accent)] hover:underline"
              >
                Evidence <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
