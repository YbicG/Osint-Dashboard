'use client'

import { useEffect, useState } from 'react'
import { Loader2, Power, PowerOff } from 'lucide-react'
import { CATEGORY_LABELS } from '@/lib/predicate-labels'
import { cn } from '@/lib/cn'

interface SourceRow {
  sourceId: string
  connectorId: string
  name: string
  category: string
  costType: string
  enabled: boolean
  totalRuns: number
  hits: number
  misses: number
  blocked: number
  errors: number
  skippedCaptcha: number
  totalClaims: number
  lastRunAt: string | null
  hitRate: number | null
}

function HealthBar({ row }: { row: SourceRow }) {
  if (row.totalRuns === 0) return <span className="text-[11px] text-[var(--text-muted)]">Never run</span>
  const segments = [
    { count: row.hits, color: 'var(--status-hit)' },
    { count: row.misses, color: 'var(--status-miss)' },
    { count: row.blocked, color: 'var(--status-blocked)' },
    { count: row.errors + row.skippedCaptcha, color: 'var(--status-error)' },
  ]
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
      {segments.map((s, i) => s.count > 0 && (
        <div key={i} style={{ width: `${(s.count / row.totalRuns) * 100}%`, backgroundColor: s.color }} />
      ))}
    </div>
  )
}

export function AdminSourcesTable({ canToggle }: { canToggle: boolean }) {
  const [rows, setRows] = useState<SourceRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  function load() {
    fetch('/api/admin/sources').then((r) => r.json()).then((d) => setRows(d.sources))
  }
  useEffect(load, [])

  async function toggle(row: SourceRow) {
    setBusyId(row.sourceId)
    try {
      const res = await fetch(`/api/admin/sources/${row.sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !row.enabled }),
      })
      if (res.ok) load()
    } finally {
      setBusyId(null)
    }
  }

  if (rows === null) {
    return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...</div>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Runs</th>
            <th className="px-3 py-2 font-medium">Health</th>
            <th className="px-3 py-2 font-medium">Claims</th>
            <th className="px-3 py-2 font-medium">Last run</th>
            {canToggle && <th className="px-3 py-2 font-medium">Enabled</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sourceId} className={cn('border-b border-[var(--border-subtle)] last:border-0', !row.enabled && 'opacity-50')}>
              <td className="px-3 py-2.5">
                <div className="text-[var(--text-primary)]">{row.name}</div>
                <div className="font-mono text-[10px] text-[var(--text-muted)]">{row.connectorId}</div>
              </td>
              <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">{CATEGORY_LABELS[row.category] ?? row.category}</td>
              <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">{row.totalRuns}</td>
              <td className="w-40 px-3 py-2.5"><HealthBar row={row} /></td>
              <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">{row.totalClaims}</td>
              <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">
                {row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : '—'}
              </td>
              {canToggle && (
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => toggle(row)}
                    disabled={busyId === row.sourceId}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                      row.enabled
                        ? 'bg-[var(--status-hit)]/15 text-[var(--status-hit)] hover:bg-[var(--status-hit)]/25'
                        : 'bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                    )}
                  >
                    {row.enabled ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
                    {row.enabled ? 'On' : 'Off'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
