'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, Eye, Lock } from 'lucide-react'

interface RecordDetail {
  recordId: string
  fileId: string
  folderLabel: string
  filename: string
  rowNumber: number
  columns: string[]
  sensitiveColumns: string[]
  data: Record<string, string | null>
}

/**
 * Right-side slide-over showing one full CSV record. Opening it fetches the
 * masked record (GET .../[recordId], which audit-logs the view). Sensitive
 * columns stay masked until "Reveal sensitive fields" is clicked, which
 * calls the separate POST .../reveal endpoint (its own audit entry) and
 * swaps the unmasked values in locally — no page reload, no re-fetch of the
 * whole record.
 */
export function CsvRecordPanel({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const [record, setRecord] = useState<RecordDetail | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string | null> | null>(null)
  const [revealing, setRevealing] = useState(false)

  useEffect(() => {
    setRecord(null)
    setRevealed(null)
    fetch(`/api/csv-search/${recordId}`).then((r) => r.json()).then(setRecord)
  }, [recordId])

  async function onReveal() {
    setRevealing(true)
    try {
      const res = await fetch(`/api/csv-search/${recordId}/reveal`, { method: 'POST' })
      const body = await res.json()
      if (res.ok) setRevealed(body.revealed)
    } finally {
      setRevealing(false)
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{record?.folderLabel ?? 'Loading…'}</div>
          {record && <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">{record.filename} · row {record.rowNumber}</div>}
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!record ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading record…</div>
        ) : (
          <>
            {record.sensitiveColumns.length > 0 && (
              <button
                onClick={onReveal}
                disabled={revealing || revealed !== null}
                className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-xs font-medium text-[var(--status-blocked)] transition hover:bg-[var(--status-blocked)]/20 disabled:opacity-60"
              >
                {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                {revealed ? 'Sensitive fields revealed' : `Reveal ${record.sensitiveColumns.length} sensitive field${record.sensitiveColumns.length > 1 ? 's' : ''}`}
              </button>
            )}

            <dl className="space-y-3">
              {record.columns.map((column) => {
                const isSensitive = record.sensitiveColumns.includes(column)
                const value = isSensitive && revealed ? revealed[column] : record.data[column]
                return (
                  <div key={column}>
                    <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                      {isSensitive && <Lock className="h-2.5 w-2.5" />}
                      {column}
                    </dt>
                    <dd className={`mt-0.5 break-words text-sm ${isSensitive && !revealed ? 'font-mono text-[var(--status-blocked)]' : 'text-[var(--text-primary)]'}`}>
                      {value || <span className="text-[var(--text-muted)]">—</span>}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </>
        )}
      </div>
    </div>
  )
}
