'use client'

import { useState } from 'react'
import { FolderPlus, Loader2 } from 'lucide-react'

/** Admin-only "register a new source folder" form. Posts to /api/admin/csv-sources and lets the parent table's own poll pick up the new row — no local list state here. */
export function AddCsvFolderForm() {
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/csv-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, label, recursive }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Failed to add folder')
        return
      }
      setPath('')
      setLabel('')
      setRecursive(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-6 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
        <FolderPlus className="h-4 w-4 text-[var(--accent)]" /> Add source folder
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Absolute path, e.g. D:\authorized-csv\county-records"
          required
          className="rounded-md border border-[var(--border-default)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label, e.g. County Records 2024"
          required
          className="rounded-md border border-[var(--border-default)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <label className="flex items-center gap-1.5 whitespace-nowrap px-1 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
          Include subfolders
        </label>
        <button
          type="submit"
          disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent-dim)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition hover:bg-[var(--accent)] disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--status-error)]">{error}</p>}
    </form>
  )
}
