'use client'

import { useEffect, useState } from 'react'
import { Search, Loader2, FileText } from 'lucide-react'
import { CsvRecordPanel } from './csv-record-panel'

interface SearchResult {
  recordId: string
  fileId: string
  folderId: string
  folderLabel: string
  filename: string
  rowNumber: number
  preview: Record<string, string | null>
}

interface FolderOption {
  id: string
  label: string
}

/** Debounces a changing value by `delayMs`, so the search API isn't hit on every keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export function CsvSearchWorkspace() {
  const [query, setQuery] = useState('')
  const [folderId, setFolderId] = useState('')
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openRecordId, setOpenRecordId] = useState<string | null>(null)

  const debouncedQuery = useDebounced(query.trim(), 300)

  useEffect(() => {
    fetch('/api/csv-search/folders').then((r) => r.json()).then((d) => setFolders(d.folders))
  }, [])

  useEffect(() => {
    if (debouncedQuery.length < 3) {
      setResults(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ q: debouncedQuery })
    if (folderId) params.set('folderId', folderId)
    fetch(`/api/csv-search?${params}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? 'Search failed')
        return body
      })
      .then((body) => setResults(body.results))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [debouncedQuery, folderId])

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, address, SSN fragment, or any indexed value (min 3 characters)"
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <select
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      {loading && <div className="flex items-center gap-2 py-6 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…</div>}
      {error && <div className="rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">{error}</div>}

      {!loading && !error && results !== null && (
        results.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border-subtle)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">No matches.</div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Preview</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.recordId}
                    onClick={() => setOpenRecordId(r.recordId)}
                    className="cursor-pointer border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)]"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[var(--text-primary)]"><FileText className="h-3 w-3 text-[var(--text-muted)]" />{r.folderLabel}</div>
                      <div className="font-mono text-[10px] text-[var(--text-muted)]">{r.filename}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">{r.rowNumber}</td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">
                      {Object.entries(r.preview).map(([k, v]) => `${k}: ${v}`).join('  ·  ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {openRecordId && <CsvRecordPanel recordId={openRecordId} onClose={() => setOpenRecordId(null)} />}
    </div>
  )
}
