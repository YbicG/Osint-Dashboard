'use client'

import { useEffect, useMemo, useReducer, useState, use as usePromise } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2 } from 'lucide-react'
import { ConnectorStatusChip, type ConnectorChipState } from '@/components/connector-status-chip'
import { predicateLabel } from '@/lib/predicate-labels'

interface SearchSummary {
  search: { id: string; inputType: string; inputPayload: Record<string, unknown>; subjectEntityId: string | null }
  runs: { connectorId: string; sourceName: string; sourceCategory: string; status: ConnectorChipState['status']; claimsProduced: number }[]
}

interface ClaimFeedItem { id: string; predicate: string; connectorId: string }

type State = {
  chips: Record<string, ConnectorChipState>
  feed: ClaimFeedItem[]
  totalClaims: number
  complete: boolean
  subjectEntityId: string | null
  error: string | null
}

type Action =
  | { type: 'seed'; runs: SearchSummary['runs'] }
  | { type: 'plan'; connectors: { id: string; name: string; category: string }[] }
  | { type: 'status'; connectorId: string; connectorName: string; status: string }
  | { type: 'claim'; connectorId: string; predicate: string; entityId: string }
  | { type: 'complete'; totalClaims: number; subjectEntityId: string }
  | { type: 'error'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'seed': {
      const chips = { ...state.chips }
      for (const r of action.runs) {
        chips[r.connectorId] = { id: r.connectorId, name: r.sourceName, category: r.sourceCategory, status: r.status, claimsProduced: r.claimsProduced }
      }
      return { ...state, chips }
    }
    case 'plan': {
      const chips = { ...state.chips }
      for (const c of action.connectors) {
        if (!chips[c.id]) chips[c.id] = { id: c.id, name: c.name, category: c.category, status: 'pending', claimsProduced: 0 }
      }
      return { ...state, chips }
    }
    case 'status': {
      if (action.status.startsWith('log:')) return state // log lines are shown via feed only, not chip status
      const chips = { ...state.chips }
      const existing = chips[action.connectorId]
      chips[action.connectorId] = {
        id: action.connectorId,
        name: action.connectorName || existing?.name || action.connectorId,
        category: existing?.category ?? 'digital',
        status: action.status as ConnectorChipState['status'],
        claimsProduced: existing?.claimsProduced ?? 0,
      }
      return { ...state, chips }
    }
    case 'claim': {
      const chips = { ...state.chips }
      const existing = chips[action.connectorId]
      if (existing) chips[action.connectorId] = { ...existing, claimsProduced: existing.claimsProduced + 1 }
      const feed = [{ id: action.entityId, predicate: action.predicate, connectorId: action.connectorId }, ...state.feed].slice(0, 30)
      return { ...state, chips, feed, totalClaims: state.totalClaims + 1 }
    }
    case 'complete':
      return { ...state, complete: true, totalClaims: action.totalClaims, subjectEntityId: action.subjectEntityId }
    case 'error':
      return { ...state, error: action.message }
    default:
      return state
  }
}

export default function SearchResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params)
  const [summary, setSummary] = useState<SearchSummary | null>(null)
  const [state, dispatch] = useReducer(reducer, { chips: {}, feed: [], totalClaims: 0, complete: false, subjectEntityId: null, error: null })

  useEffect(() => {
    fetch(`/api/search/${id}`).then((r) => r.json()).then((data: SearchSummary) => {
      setSummary(data)
      dispatch({ type: 'seed', runs: data.runs })
      if (data.search.subjectEntityId) dispatch({ type: 'complete', totalClaims: 0, subjectEntityId: data.search.subjectEntityId })
    }).catch(() => {})

    const es = new EventSource(`/api/search/${id}/events`)
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data)
        if (parsed.type === 'plan') dispatch({ type: 'plan', connectors: parsed.connectors })
        else if (parsed.type === 'connector_status') dispatch({ type: 'status', connectorId: parsed.connectorId, connectorName: parsed.connectorName, status: parsed.status })
        else if (parsed.type === 'claim_ingested') dispatch({ type: 'claim', connectorId: parsed.connectorId, predicate: parsed.predicate, entityId: parsed.entityId })
        else if (parsed.type === 'search_complete') dispatch({ type: 'complete', totalClaims: parsed.totalClaims, subjectEntityId: parsed.subjectEntityId })
        else if (parsed.type === 'search_error') dispatch({ type: 'error', message: parsed.message })
      } catch { /* ignore malformed frame */ }
    }
    es.addEventListener('done', () => es.close())
    es.onerror = () => { /* EventSource auto-retries; nothing to do here */ }

    return () => es.close()
  }, [id])

  const chips = useMemo(() => Object.values(state.chips).sort((a, b) => a.name.localeCompare(b.name)), [state.chips])
  const inputLabel = summary ? Object.values(summary.search.inputPayload).find((v) => typeof v === 'string') as string ?? summary.search.inputType : '...'

  const doneCount = chips.filter((c) => !['pending', 'running'].includes(c.status)).length

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs text-[var(--text-muted)]">Searching</div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{inputLabel}</h1>
        </div>
        {state.subjectEntityId ? (
          <Link
            href={`/entities/${state.subjectEntityId}`}
            className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            View Dossier <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Collecting...
          </div>
        )}
      </div>

      {state.error && (
        <div className="mb-4 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
          {state.error}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{chips.length ? `${doneCount}/${chips.length} sources complete` : 'Planning sources...'}</span>
        <span>{state.totalClaims} claims collected</span>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {chips.map((chip) => <ConnectorStatusChip key={chip.id} chip={chip} />)}
      </div>

      {state.feed.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Live feed</h2>
          <div className="flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
            {state.feed.map((item, i) => (
              <div key={`${item.id}-${i}`} className="truncate">
                <span className="text-[var(--status-hit)]">+</span> {predicateLabel(item.predicate)}
                <span className="text-[var(--text-muted)]"> via {item.connectorId}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
