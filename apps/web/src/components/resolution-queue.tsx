'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, X, ArrowUpRight, Loader2 } from 'lucide-react'

interface Candidate {
  id: string
  score: number
  matchedOn: string[]
  firstFlaggedAt: string
  lastScoredAt: string
  entityA: { id: string; displayLabel: string }
  entityB: { id: string; displayLabel: string }
}

export function ResolutionQueue({ canDecide }: { canDecide: boolean }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  function load() {
    fetch('/api/resolution/candidates').then((r) => r.json()).then((d) => setCandidates(d.candidates))
  }
  useEffect(load, [])

  async function decide(id: string, action: 'confirm' | 'reject') {
    setBusyId(id)
    try {
      const res = await fetch(`/api/resolution/candidates/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) setCandidates((prev) => prev?.filter((c) => c.id !== id) ?? null)
    } finally {
      setBusyId(null)
    }
  }

  if (candidates === null) {
    return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...</div>
  }

  if (candidates.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No pending review candidates — every scored match is either confidently auto-merged or confidently distinct right now.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {candidates.map((c) => (
        <div key={c.id} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Link href={`/entities/${c.entityA.id}`} className="text-[var(--text-primary)] hover:underline">{c.entityA.displayLabel}</Link>
              <ArrowUpRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <Link href={`/entities/${c.entityB.id}`} className="text-[var(--text-primary)] hover:underline">{c.entityB.displayLabel}</Link>
            </div>
            <span className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
              {(c.score * 100).toFixed(0)}% match
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-1">
            {c.matchedOn.map((m, i) => (
              <span key={i} className="rounded bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">{m}</span>
            ))}
          </div>

          {canDecide ? (
            <div className="flex gap-2">
              <button
                onClick={() => decide(c.id, 'confirm')}
                disabled={busyId === c.id}
                className="flex items-center gap-1 rounded-md bg-[var(--status-hit)]/15 px-2.5 py-1 text-xs font-medium text-[var(--status-hit)] transition hover:bg-[var(--status-hit)]/25 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Same person — merge
              </button>
              <button
                onClick={() => decide(c.id, 'reject')}
                disabled={busyId === c.id}
                className="flex items-center gap-1 rounded-md bg-[var(--status-error)]/15 px-2.5 py-1 text-xs font-medium text-[var(--status-error)] transition hover:bg-[var(--status-error)]/25 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Different people
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--text-muted)]">Only supervisors/admins can decide merge candidates.</p>
          )}
        </div>
      ))}
    </div>
  )
}
