'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Lock, ExternalLink } from 'lucide-react'
import { SearchBar } from '@/components/search-bar'

interface CaseData {
  case: { id: string; title: string; status: string; purposeCode: string; createdAt: string; closedAt: string | null; biometricDataPurged: boolean }
  notes: { id: string; body: string; createdAt: string; authorName: string }[]
  subjects: { id: string; label: string; entityId: string | null; monitoringEnabled: boolean }[]
}

export function CaseDetail({ caseId, canManage }: { caseId: string; canManage: boolean }) {
  const [data, setData] = useState<CaseData | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [subjectDraft, setSubjectDraft] = useState('')
  const [busy, setBusy] = useState(false)

  function load() {
    fetch(`/api/cases/${caseId}`).then((r) => r.json()).then(setData)
  }
  useEffect(load, [caseId])

  async function addNote(e: React.FormEvent) {
    e.preventDefault()
    if (!noteDraft.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cases/${caseId}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: noteDraft }),
      })
      if (res.ok) { setNoteDraft(''); load() }
    } finally { setBusy(false) }
  }

  async function addSubject(e: React.FormEvent) {
    e.preventDefault()
    if (!subjectDraft.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cases/${caseId}/subjects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: subjectDraft }),
      })
      if (res.ok) { setSubjectDraft(''); load() }
    } finally { setBusy(false) }
  }

  async function setStatus(status: 'open' | 'on_hold' | 'closed') {
    if (status === 'closed' && !confirm('Close this case? This purges any biometric data associated with it and is logged to the audit trail.')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (res.ok) load()
    } finally { setBusy(false) }
  }

  if (!data) return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...</div>

  const { case: c, notes, subjects } = data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{c.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <span className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 uppercase tracking-wide">{c.status}</span>
            <span>{c.purposeCode.replace(/_/g, ' ')}</span>
            <span>· opened {new Date(c.createdAt).toLocaleDateString()}</span>
            {c.biometricDataPurged && <span className="flex items-center gap-1 text-[var(--status-hit)]"><Lock className="h-3 w-3" /> biometric data purged</span>}
          </div>
        </div>
        {canManage && c.status !== 'closed' && (
          <div className="flex gap-2">
            {c.status === 'open' && (
              <button onClick={() => setStatus('on_hold')} disabled={busy} className="rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                Put on hold
              </button>
            )}
            {c.status === 'on_hold' && (
              <button onClick={() => setStatus('open')} disabled={busy} className="rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                Reopen
              </button>
            )}
            <button onClick={() => setStatus('closed')} disabled={busy} className="rounded-md bg-[var(--status-error)]/15 px-2.5 py-1.5 text-xs font-medium text-[var(--status-error)] hover:bg-[var(--status-error)]/25">
              Close case
            </button>
          </div>
        )}
      </div>

      {c.status !== 'closed' && (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">New search in this case</h2>
          <SearchBar caseId={caseId} defaultPurposeCode={c.purposeCode} autoFocus={false} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Subjects ({subjects.length})</h2>
        <div className="mb-2 flex flex-col gap-1.5">
          {subjects.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm">
              <span className="text-[var(--text-primary)]">{s.label}</span>
              {s.entityId ? (
                <Link href={`/entities/${s.entityId}`} className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                  View dossier <ExternalLink className="h-3 w-3" />
                </Link>
              ) : (
                <span className="text-[11px] text-[var(--text-muted)]">not yet resolved to a search</span>
              )}
            </div>
          ))}
          {subjects.length === 0 && <p className="text-xs text-[var(--text-muted)]">No subjects added yet.</p>}
        </div>
        {c.status !== 'closed' && (
          <form onSubmit={addSubject} className="flex gap-2">
            <input
              value={subjectDraft}
              onChange={(e) => setSubjectDraft(e.target.value)}
              placeholder="Subject label (e.g. a name mentioned in the case)"
              className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <button type="submit" disabled={busy} className="flex items-center gap-1 rounded-md bg-[var(--accent-dim)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-fg)]">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Notes ({notes.length})</h2>
        {c.status !== 'closed' && (
          <form onSubmit={addNote} className="mb-3 flex flex-col gap-2">
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add a case note..."
              rows={3}
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <button type="submit" disabled={busy} className="self-end rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Add note
            </button>
          </form>
        )}
        <div className="flex flex-col gap-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{n.body}</p>
              <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">{n.authorName} · {new Date(n.createdAt).toLocaleString()}</div>
            </div>
          ))}
          {notes.length === 0 && <p className="text-xs text-[var(--text-muted)]">No notes yet.</p>}
        </div>
      </section>
    </div>
  )
}
