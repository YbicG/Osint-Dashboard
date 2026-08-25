import { NextRequest, NextResponse } from 'next/server'
import { appendAuditEntry } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { getDossierData } from '@/server/dossier'
import { db } from '@/server/db'
import { claimsToCsv } from '@/lib/report/csv'
import { buildReportHtml } from '@/lib/report/html'
import { renderHtmlToPdf } from '@/server/pdf'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entity'
}

/**
 * Report export — json/csv/pdf, all backed by the same getDossierData query
 * the dossier page itself uses (see apps/web/src/server/dossier.ts), so a
 * report can never drift from what the UI actually shows. `exclude` is the
 * v1 redaction mechanism: a comma-separated list of claim IDs the requester
 * chose to leave out (e.g. from the dossier UI, once a "select claims to
 * exclude" affordance exists there — this endpoint accepts the parameter
 * today so that UI work isn't blocked on a backend change later). Every
 * export is written to the audit log, per the plan's compliance layer.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const format = (req.nextUrl.searchParams.get('format') ?? 'json').toLowerCase()
  if (!['json', 'csv', 'pdf'].includes(format)) {
    return NextResponse.json({ error: "format must be one of: json, csv, pdf" }, { status: 400 })
  }

  const excludeParam = req.nextUrl.searchParams.get('exclude')
  const excludedClaimIds = new Set((excludeParam ?? '').split(',').map((s) => s.trim()).filter(Boolean))

  const dossier = await getDossierData(id)
  if (!dossier) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await appendAuditEntry(db, {
    userId: user.id,
    action: 'export.report',
    targetType: 'entity',
    targetId: id,
    metadata: { format, claimCount: dossier.claims.length, excludedCount: excludedClaimIds.size },
  })

  const filenameBase = `dossier-${slugify(dossier.entity.displayLabel)}-${new Date().toISOString().slice(0, 10)}`

  if (format === 'json') {
    const included = { ...dossier, claims: dossier.claims.filter((c) => !excludedClaimIds.has(c.id)) }
    return new NextResponse(JSON.stringify(included, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filenameBase}.json"`,
      },
    })
  }

  if (format === 'csv') {
    const included = dossier.claims.filter((c) => !excludedClaimIds.has(c.id))
    return new NextResponse(claimsToCsv(included), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
      },
    })
  }

  // pdf
  const html = buildReportHtml(dossier, {
    generatedByName: user.displayName,
    purposeCode: null, // not linked to a specific search's purpose code from this endpoint — see notes in README backlog
    excludedClaimIds,
  })
  const pdfBuffer = await renderHtmlToPdf(html)
  // NextResponse's BodyInit typing doesn't structurally accept Node's Buffer
  // directly (despite Buffer being a Uint8Array at runtime) — wrap it.
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filenameBase}.pdf"`,
    },
  })
}
