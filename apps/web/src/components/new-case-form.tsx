'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'

const PURPOSE_CODE_OPTIONS = [
  'criminal_investigation', 'civil_litigation_support', 'due_diligence', 'fraud_investigation',
  'missing_person', 'background_verification_non_fcra', 'journalism_research', 'other_documented',
]

export function NewCaseForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [purposeCode, setPurposeCode] = useState(PURPOSE_CODE_OPTIONS[0]!)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, purposeCode }),
      })
      if (res.ok) {
        setTitle('')
        setOpen(false)
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        <Plus className="h-4 w-4" /> New Case
      </button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Case title"
        required
        autoFocus
        className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      <select
        value={purposeCode}
        onChange={(e) => setPurposeCode(e.target.value)}
        className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1.5 text-xs text-[var(--text-secondary)] outline-none"
      >
        {PURPOSE_CODE_OPTIONS.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
      </select>
      <button type="submit" disabled={loading} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
        Create
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-[var(--text-muted)]">Cancel</button>
    </form>
  )
}
