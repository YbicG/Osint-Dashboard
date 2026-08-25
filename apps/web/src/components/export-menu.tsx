'use client'

import { useState } from 'react'
import { Download, ChevronDown, FileText, FileSpreadsheet, FileJson } from 'lucide-react'
import { cn } from '@/lib/cn'

const FORMATS = [
  { format: 'pdf', label: 'PDF Report', icon: FileText },
  { format: 'csv', label: 'CSV (spreadsheet)', icon: FileSpreadsheet },
  { format: 'json', label: 'JSON (raw claims)', icon: FileJson },
] as const

export function ExportMenu({ entityId, excludedIds }: { entityId: string; excludedIds?: Set<string> }) {
  const [open, setOpen] = useState(false)
  const excludeParam = excludedIds && excludedIds.size > 0 ? `&exclude=${[...excludedIds].join(',')}` : ''

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-hover)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
      >
        <Download className="h-4 w-4" /> Export <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-xl">
          {excludedIds && excludedIds.size > 0 && (
            <div className="mb-1 border-b border-[var(--border-subtle)] px-2 pb-1.5 pt-0.5 text-[10px] text-[var(--text-muted)]">
              {excludedIds.size} claim{excludedIds.size === 1 ? '' : 's'} redacted from this export
            </div>
          )}
          {FORMATS.map(({ format, label, icon: Icon }) => (
            <a
              key={format}
              href={`/api/entities/${entityId}/report?format=${format}${excludeParam}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
