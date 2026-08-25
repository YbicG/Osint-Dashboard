import type { DossierData, DossierClaim } from '@/server/dossier'
import { CATEGORY_LABELS, CATEGORY_ORDER, predicateCategory, predicateLabel } from '@/lib/predicate-labels'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return escapeHtml(value)
  if (typeof value === 'number' || typeof value === 'boolean') return escapeHtml(String(value))
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== '')
    return entries
      .map(([k, v]) => `<span class="kv"><b>${escapeHtml(predicateLabel(k))}:</b> ${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v))}</span>`)
      .join(' ')
  }
  return '—'
}

export interface ReportOptions {
  generatedByName: string
  purposeCode: string | null
  excludedClaimIds: Set<string>
}

/**
 * Builds the full printable report document. Deliberately light-themed
 * (white background, dark text) even though the app's own UI is dark-first
 * — this is meant to be printed or handed to someone outside the tool
 * (opposing counsel via discovery, a supervisor, a case file), and that
 * context calls for a conventional document look, not the investigator
 * console's chrome.
 *
 * Every fact keeps its exhibit number and citation (source name + evidence
 * URL) — the report is only as defensible as the dossier it came from, so
 * provenance travels with it rather than being summarized away.
 */
export function buildReportHtml(dossier: DossierData, opts: ReportOptions): string {
  const included = dossier.claims.filter((c) => !opts.excludedClaimIds.has(c.id))
  const excludedCount = dossier.claims.length - included.length

  const grouped = new Map<string, DossierClaim[]>()
  for (const claim of included) {
    const cat = predicateCategory(claim.predicate)
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(claim)
  }
  const categories = CATEGORY_ORDER.filter((c) => grouped.has(c))

  let exhibitNumber = 0
  const sections = categories.map((cat) => {
    const claims = grouped.get(cat)!.sort((a, b) => b.confidence - a.confidence)
    const rows = claims
      .map((c) => {
        exhibitNumber += 1
        return `
        <tr>
          <td class="exhibit-num">${exhibitNumber}</td>
          <td>
            <div class="field-label">${escapeHtml(predicateLabel(c.predicate))}</div>
            <div class="field-value">${formatValue(c.value)}</div>
            ${c.rawSnippet ? `<div class="raw-snippet">"${escapeHtml(c.rawSnippet)}"</div>` : ''}
          </td>
          <td class="confidence">${Math.round(c.confidence * 100)}%</td>
          <td class="citation">
            ${escapeHtml(c.sourceName)}<br/>
            ${c.observedAt ? `Observed ${new Date(c.observedAt).toISOString().slice(0, 10)}<br/>` : ''}
            Collected ${new Date(c.collectedAt).toISOString().slice(0, 10)}
            ${c.evidenceUrl ? `<br/><a href="${escapeHtml(c.evidenceUrl)}">${escapeHtml(c.evidenceUrl)}</a>` : ''}
          </td>
        </tr>`
      })
      .join('')

    return `
      <section class="category">
        <h2>${escapeHtml(CATEGORY_LABELS[cat] ?? cat)}</h2>
        <table>
          <thead><tr><th>#</th><th>Field</th><th>Confidence</th><th>Source / Citation</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`
  }).join('')

  const generatedAt = new Date().toISOString()

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Dossier Report — ${escapeHtml(dossier.entity.displayLabel)}</title>
<style>
  @page { size: Letter; margin: 0.75in 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.45; }
  header.title-page { margin-bottom: 24px; border-bottom: 3px solid #1a1a1a; padding-bottom: 16px; }
  header.title-page h1 { font-size: 22pt; margin: 0 0 4px 0; }
  header.title-page .entity-type { text-transform: uppercase; letter-spacing: 1px; font-size: 9pt; color: #555; }
  .meta-table { margin-top: 12px; font-size: 9pt; color: #333; }
  .meta-table td { padding: 1px 12px 1px 0; }
  .confidential-banner { background: #f2f2f2; border: 1px solid #ccc; padding: 8px 12px; font-size: 8.5pt; margin: 16px 0; color: #444; }
  section.category { margin-top: 22px; page-break-inside: avoid; }
  section.category h2 { font-size: 13pt; border-bottom: 1px solid #999; padding-bottom: 3px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { text-align: left; border-bottom: 1px solid #999; padding: 4px 6px; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
  td { padding: 6px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.exhibit-num { width: 24px; font-weight: bold; color: #777; }
  td.confidence { width: 60px; }
  td.citation { width: 200px; font-size: 8pt; color: #444; word-break: break-all; }
  td.citation a { color: #345; }
  .field-label { font-weight: bold; }
  .field-value { margin-top: 2px; }
  .kv { display: inline-block; margin-right: 10px; }
  .raw-snippet { margin-top: 3px; font-style: italic; color: #555; font-size: 8.5pt; }
  footer { margin-top: 32px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 8pt; color: #777; }
</style>
</head>
<body>
  <header class="title-page">
    <div class="entity-type">${escapeHtml(dossier.entity.type)}</div>
    <h1>${escapeHtml(dossier.entity.displayLabel)}</h1>
    <table class="meta-table">
      <tr><td><b>Generated</b></td><td>${escapeHtml(generatedAt)}</td></tr>
      <tr><td><b>Generated by</b></td><td>${escapeHtml(opts.generatedByName)}</td></tr>
      ${opts.purposeCode ? `<tr><td><b>Purpose code</b></td><td>${escapeHtml(opts.purposeCode.replace(/_/g, ' '))}</td></tr>` : ''}
      <tr><td><b>Claims included</b></td><td>${included.length}${excludedCount > 0 ? ` (${excludedCount} redacted by request — see note below)` : ''}</td></tr>
    </table>
  </header>

  <div class="confidential-banner">
    <b>CONFIDENTIAL.</b> This report is a compilation of claims collected from the sources cited alongside each item.
    It is not a consumer report under the Fair Credit Reporting Act and must not be used, in whole or in part, as a
    factor in determining eligibility for credit, insurance, employment, or housing. Every field traces to a specific
    source and collection date; conflicting values from different sources are shown separately, not merged.
    ${excludedCount > 0 ? `${excludedCount} item(s) present in the underlying dossier were deliberately excluded from this report.` : ''}
  </div>

  ${sections || '<p>No claims to report.</p>'}

  <footer>
    Generated by OSINT Dashboard · ${escapeHtml(generatedAt)} · Entity ID ${escapeHtml(dossier.entity.id)}
  </footer>
</body>
</html>`
}
