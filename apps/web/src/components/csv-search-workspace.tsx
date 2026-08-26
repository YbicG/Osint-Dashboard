'use client'

import { useEffect, useState } from 'react'
import { Search, Loader2, FileText, IdCard, User } from 'lucide-react'
import { cn } from '@/lib/cn'
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

// The UI never uses the API's 'auto' mode -- letting the query shape decide
// silently is exactly what made this page confusing to use ("what will this
// actually search?"). Instead the analyst picks explicitly, and everything
// else (placeholder text, the field selector, help copy) follows from that
// choice. See apps/web/src/app/api/csv-search/route.ts's doc comment for
// what each mode queries server-side.
const SEARCH_MODES = [
  {
    value: 'name' as const,
    label: 'Name',
    icon: User,
    placeholder: 'e.g. Smith (min 3 characters)',
    help: 'Matches the start of a first or last name.',
  },
  {
    value: 'id' as const,
    label: 'SSN / phone / zip',
    icon: IdCard,
    placeholder: 'e.g. 1234 or 5551234567 (min 3 digits)',
    help: 'Matches any part of an SSN, or the start of a phone number or zip code.',
  },
]
type SearchMode = (typeof SEARCH_MODES)[number]['value']

// Only shown/used in 'name' mode. 'both' runs first_name and last_name as
// two independently indexed queries and unions the results, rather than one
// query that silently falls back to a full table scan -- picking a single
// field here is purely a speed/precision choice for the analyst, not a
// workaround. See route.ts's doc comment.
const NAME_FIELD_OPTIONS = [
  { value: 'both', label: 'First + last name' },
  { value: 'first_name', label: 'First name only' },
  { value: 'last_name', label: 'Last name only' },
] as const
type NameField = (typeof NAME_FIELD_OPTIONS)[number]['value']

export function CsvSearchWorkspace() {
  const [mode, setMode] = useState<SearchMode>('name')
  const [query, setQuery] = useState('')
  const [folderId, setFolderId] = useState('')
  const [nameField, setNameField] = useState<NameField>('both')
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openRecordId, setOpenRecordId] = useState<string | null>(null)

  const debouncedQuery = useDebounced(query.trim(), 300)
  const activeMode = SEARCH_MODES.find((m) => m.value === mode)!
  const minLength = mode === 'id' ? 3 : 3

  useEffect(() => {
    fetch('/api/csv-search/folders').then((r) => r.json()).then((d) => setFolders(d.folders))
  }, [])

  useEffect(() => {
    if (debouncedQuery.length < minLength) {
      setResults(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ q: debouncedQuery, mode, field: nameField })
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
  }, [debouncedQuery, folderId, mode, nameField, minLength])

  return (
    <div>
      {/* Mode toggle -- the first decision, since it determines everything else on this page */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Search by</span>
        {SEARCH_MODES.map((m) => {
          const active = m.value === mode
          const Icon = m.icon
          return (
            <button
              key={m.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setMode(m.value)
                setResults(null)
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                active
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent-fg)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          )
        })}
      </div>

      <div className="mb-1.5 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={activeMode.placeholder}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        {mode === 'name' && (
          <select
            value={nameField}
            onChange={(e) => setNameField(e.target.value as NameField)}
            className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          >
            {NAME_FIELD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
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
      <p className="mb-4 text-xs text-[var(--text-muted)]">{activeMode.help}</p>

      {loading && <div className="flex items-center gap-2 py-6 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…</div>}
      {error && <div className="rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">{error}</div>}

      {!loading && !error && results === null && (
        <div className="rounded-md border border-dashed border-[var(--border-subtle)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
          {query.trim().length === 0
            ? `Type ${minLength}+ characters to search ${mode === 'name' ? 'by name' : 'an SSN, phone number, or zip code'}.`
            : `Keep typing — ${minLength}+ characters needed to search.`}
        </div>
      )}

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
