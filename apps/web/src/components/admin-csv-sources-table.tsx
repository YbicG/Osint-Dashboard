'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { Loader2, Power, PowerOff, RefreshCw, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

interface CsvFileRow {
  id: string
  relativePath: string
  status: string
  rowCount: number
  errorRowCount: number
  columns: string[]
  sensitiveColumns: string[]
  errorMessage: string | null
  indexedAt: string | null
}

interface CsvFolderRow {
  id: string
  path: string
  label: string
  recursive: boolean
  enabled: boolean
  lastScanAt: string | null
  lastScanStatus: 'idle' | 'scanning' | 'error'
  lastScanError: string | null
  fileCount: number
  indexedFileCount: number
  errorFileCount: number
  totalRows: number
  totalErrorRows: number
  files: CsvFileRow[]
}

const NON_TERMINAL_FILE_STATUSES = new Set(['discovered', 'queued', 'indexing'])

const STATUS_COLOR: Record<string, string> = {
  idle: 'var(--status-hit)',
  scanning: 'var(--status-pending)',
  error: 'var(--status-error)',
  discovered: 'var(--status-pending)',
  queued: 'var(--status-pending)',
  indexing: 'var(--status-pending)',
  indexed: 'var(--status-hit)',
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ color: STATUS_COLOR[status] ?? 'var(--text-muted)', backgroundColor: `color-mix(in srgb, ${STATUS_COLOR[status] ?? 'var(--text-muted)'} 15%, transparent)` }}
    >
      {status}
    </span>
  )
}

function isNonTerminal(folder: CsvFolderRow): boolean {
  if (folder.lastScanStatus === 'scanning') return true
  return folder.files.some((f) => NON_TERMINAL_FILE_STATUSES.has(f.status))
}

export function AdminCsvSourcesTable({ canManage }: { canManage: boolean }) {
  const [folders, setFolders] = useState<CsvFolderRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; label: string; typed: string } | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function load() {
    fetch('/api/admin/csv-sources').then((r) => r.json()).then((d) => setFolders(d.folders))
  }

  useEffect(() => {
    load()
  }, [])

  // Poll only while something is actively scanning/indexing — avoids
  // hammering the DB once every folder has settled into a terminal state.
  useEffect(() => {
    const anyActive = folders?.some(isNonTerminal) ?? false
    if (anyActive && !intervalRef.current) {
      intervalRef.current = setInterval(load, 3000)
    } else if (!anyActive && intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [folders])

  async function toggle(folder: CsvFolderRow) {
    setBusyId(folder.id)
    try {
      const res = await fetch(`/api/admin/csv-sources/${folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !folder.enabled }),
      })
      if (res.ok) load()
    } finally {
      setBusyId(null)
    }
  }

  async function rescan(folder: CsvFolderRow) {
    setBusyId(folder.id)
    try {
      const res = await fetch(`/api/admin/csv-sources/${folder.id}/rescan`, { method: 'POST' })
      if (res.ok) load()
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    setBusyId(deleteConfirm.id)
    try {
      const res = await fetch(`/api/admin/csv-sources/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        setDeleteConfirm(null)
        load()
      }
    } finally {
      setBusyId(null)
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (folders === null) {
    return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...</div>
  }

  if (folders.length === 0) {
    return <div className="rounded-md border border-dashed border-[var(--border-subtle)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">No source folders configured yet.</div>
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">Folder</th>
              <th className="px-3 py-2 font-medium">Files</th>
              <th className="px-3 py-2 font-medium">Rows</th>
              <th className="px-3 py-2 font-medium">Last scan</th>
              {canManage && <th className="px-3 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {folders.map((folder) => (
              <Fragment key={folder.id}>
                <tr className={cn('border-b border-[var(--border-subtle)] last:border-0', !folder.enabled && 'opacity-50')}>
                  <td className="px-3 py-2.5">
                    <button onClick={() => toggleExpanded(folder.id)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                      {expanded.has(folder.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-[var(--text-primary)]">{folder.label}</div>
                    <div className="max-w-xs truncate font-mono text-[10px] text-[var(--text-muted)]" title={folder.path}>{folder.path}{folder.recursive ? ' (recursive)' : ''}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">
                    {folder.indexedFileCount}/{folder.fileCount} indexed
                    {folder.errorFileCount > 0 && <span className="ml-1 text-[var(--status-error)]">({folder.errorFileCount} error)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">
                    {folder.totalRows.toLocaleString()}
                    {folder.totalErrorRows > 0 && <span className="ml-1 text-[var(--status-error)]">({folder.totalErrorRows} skipped)</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusChip status={folder.lastScanStatus} />
                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                      {folder.lastScanAt ? new Date(folder.lastScanAt).toLocaleString() : 'Never'}
                    </div>
                    {folder.lastScanError && <div className="mt-0.5 max-w-xs truncate text-[10px] text-[var(--status-error)]" title={folder.lastScanError}>{folder.lastScanError}</div>}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => toggle(folder)}
                          disabled={busyId === folder.id}
                          title={folder.enabled ? 'Disable' : 'Enable'}
                          className={cn('rounded-md p-1.5 transition', folder.enabled ? 'text-[var(--status-hit)] hover:bg-[var(--status-hit)]/15' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}
                        >
                          {folder.enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => rescan(folder)}
                          disabled={busyId === folder.id}
                          title="Rescan"
                          className="rounded-md p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ id: folder.id, label: folder.label, typed: '' })}
                          disabled={busyId === folder.id}
                          title="Remove"
                          className="rounded-md p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--status-error)]/15 hover:text-[var(--status-error)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
                {expanded.has(folder.id) && (
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] last:border-0">
                    <td colSpan={canManage ? 6 : 5} className="px-3 py-3">
                      {folder.files.length === 0 ? (
                        <div className="text-xs text-[var(--text-muted)]">No files discovered yet.</div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                              <th className="py-1 pr-3 font-medium">File</th>
                              <th className="py-1 pr-3 font-medium">Status</th>
                              <th className="py-1 pr-3 font-medium">Rows</th>
                              <th className="py-1 pr-3 font-medium">Columns</th>
                              <th className="py-1 pr-3 font-medium">Sensitive</th>
                            </tr>
                          </thead>
                          <tbody>
                            {folder.files.map((file) => (
                              <tr key={file.id} className="border-t border-[var(--border-subtle)]">
                                <td className="py-1.5 pr-3 font-mono text-[var(--text-secondary)]">{file.relativePath}</td>
                                <td className="py-1.5 pr-3">
                                  <StatusChip status={file.status} />
                                  {file.errorMessage && <div className="mt-0.5 max-w-xs truncate text-[var(--status-error)]" title={file.errorMessage}>{file.errorMessage}</div>}
                                </td>
                                <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                                  {file.rowCount.toLocaleString()}
                                  {file.errorRowCount > 0 && <span className="ml-1 text-[var(--status-error)]">({file.errorRowCount} skipped)</span>}
                                </td>
                                <td className="max-w-[16rem] truncate py-1.5 pr-3 text-[var(--text-muted)]" title={file.columns.join(', ')}>{file.columns.join(', ') || '—'}</td>
                                <td className="max-w-[12rem] truncate py-1.5 pr-3 text-[var(--status-blocked)]" title={file.sensitiveColumns.join(', ')}>{file.sensitiveColumns.join(', ') || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Remove &ldquo;{deleteConfirm.label}&rdquo;?</h2>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              This permanently deletes every indexed row from this folder. Type the folder&apos;s label to confirm.
            </p>
            <input
              autoFocus
              value={deleteConfirm.typed}
              onChange={(e) => setDeleteConfirm({ ...deleteConfirm, typed: e.target.value })}
              className="mt-3 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              placeholder={deleteConfirm.label}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="rounded-md px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={deleteConfirm.typed !== deleteConfirm.label || busyId === deleteConfirm.id}
                className="rounded-md bg-[var(--status-error)]/15 px-3 py-1.5 text-xs font-medium text-[var(--status-error)] transition hover:bg-[var(--status-error)]/25 disabled:opacity-40"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
