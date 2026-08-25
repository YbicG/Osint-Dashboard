'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, ChevronDown } from 'lucide-react'
import type { SearchInputType } from '@osint/contracts'
import { detectInputType, buildSearchInput, INPUT_TYPE_LABELS } from '@/lib/detect-input'
import { cn } from '@/lib/cn'

const PURPOSE_CODE_OPTIONS: { value: string; label: string }[] = [
  { value: 'criminal_investigation', label: 'Criminal Investigation' },
  { value: 'civil_litigation_support', label: 'Civil Litigation Support' },
  { value: 'due_diligence', label: 'Due Diligence' },
  { value: 'fraud_investigation', label: 'Fraud Investigation' },
  { value: 'missing_person', label: 'Missing Person' },
  { value: 'background_verification_non_fcra', label: 'Background Verification (non-FCRA)' },
  { value: 'journalism_research', label: 'Journalism / Research' },
  { value: 'other_documented', label: 'Other (documented)' },
]

const ALL_TYPES: SearchInputType[] = [
  'person_name', 'phone_e164', 'email', 'username', 'address',
  'license_plate', 'vin', 'domain', 'ip_address', 'crypto_wallet', 'docket_number',
]

export interface SearchBarProps {
  /** When launched from a case (see CaseDetail's "New search" affordance), the search is attached to it and inherits its purpose code — a case already has a documented reason to exist, so re-asking per-search would be pure friction. */
  caseId?: string
  defaultPurposeCode?: string
  autoFocus?: boolean
}

export function SearchBar({ caseId, defaultPurposeCode, autoFocus = true }: SearchBarProps = {}) {
  const router = useRouter()
  const [raw, setRaw] = useState('')
  const [typeOverride, setTypeOverride] = useState<SearchInputType | null>(null)
  const [purposeCode, setPurposeCode] = useState(defaultPurposeCode ?? PURPOSE_CODE_OPTIONS[0]!.value)
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detectedType = useMemo(() => (raw.trim() ? detectInputType(raw) : 'person_name'), [raw])
  const activeType = typeOverride ?? detectedType

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!raw.trim()) return
    setError(null)
    setLoading(true)
    try {
      const input = buildSearchInput(activeType, raw)
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, purposeCode, caseId: caseId ?? null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Search failed to start')
        return
      }
      const { id } = await res.json()
      router.push(`/search/${id}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-2xl">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2.5 shadow-lg focus-within:border-[var(--accent)]">
        <Search className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Search a name, phone, email, username, address, plate, domain, IP..."
          className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          autoFocus={autoFocus}
        />

        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setTypeMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-hover)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            {INPUT_TYPE_LABELS[activeType]}
            <ChevronDown className="h-3 w-3" />
          </button>
          {typeMenuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-xl">
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTypeOverride(t); setTypeMenuOpen(false) }}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition hover:bg-[var(--bg-hover)]',
                    t === activeType ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]',
                  )}
                >
                  {INPUT_TYPE_LABELS[t]}
                  {t === detectedType && <span className="text-[9px] text-[var(--text-muted)]">detected</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !raw.trim()}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 px-1">
        {caseId ? (
          <span className="text-[10px] text-[var(--text-muted)]">
            Purpose: <span className="text-[var(--text-secondary)]">{purposeCode.replace(/_/g, ' ')}</span> (inherited from this case)
          </span>
        ) : (
          <>
            <label className="text-[11px] text-[var(--text-muted)]">Purpose:</label>
            <select
              value={purposeCode}
              onChange={(e) => setPurposeCode(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] outline-none"
            >
              {PURPOSE_CODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="text-[10px] text-[var(--text-muted)]">— required, and permanently attached to the audit log for this search.</span>
          </>
        )}
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 px-3 py-1.5 text-xs text-[var(--status-error)]">
          {error}
        </div>
      )}
    </form>
  )
}
