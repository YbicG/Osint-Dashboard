import type { DossierClaim } from '@/server/dossier'
import { predicateLabel, predicateCategory } from '@/lib/predicate-labels'

function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Quote whenever the field contains anything that would otherwise break a
  // naive comma-split: the delimiter itself, a newline, or a literal quote
  // (which gets doubled per RFC 4180).
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const COLUMNS: [string, (c: DossierClaim) => unknown][] = [
  ['Category', (c) => predicateCategory(c.predicate)],
  ['Field', (c) => predicateLabel(c.predicate)],
  ['Value', (c) => c.value],
  ['Confidence', (c) => `${Math.round(c.confidence * 100)}%`],
  ['Source', (c) => c.sourceName],
  ['Source Category', (c) => c.sourceCategory],
  ['Observed', (c) => (c.observedAt ? new Date(c.observedAt).toISOString().slice(0, 10) : '')],
  ['Collected', (c) => new Date(c.collectedAt).toISOString().slice(0, 10)],
  ['Evidence URL', (c) => c.evidenceUrl ?? ''],
]

/** Every claim as one CSV row — the flattest, most portable export format, meant for dropping into a spreadsheet or another case-management tool rather than for reading as a document (see html.ts for that). */
export function claimsToCsv(claims: DossierClaim[]): string {
  const header = COLUMNS.map(([name]) => csvField(name)).join(',')
  const rows = claims.map((c) => COLUMNS.map(([, get]) => csvField(get(c))).join(','))
  return [header, ...rows].join('\r\n')
}
