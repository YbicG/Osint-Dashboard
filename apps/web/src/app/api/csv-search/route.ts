import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { maskRecord } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

const QuerySchema = z.object({
  q: z.string().trim().min(3, 'Query must be at least 3 characters'),
  folderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const PREVIEW_FIELD_COUNT = 4

interface SearchRow {
  [key: string]: unknown
  id: string
  file_id: string
  folder_id: string
  row_number: number
  data: Record<string, string | null>
  relative_path: string
  folder_label: string
  columns: string[]
  sensitive_columns: string[]
}

/**
 * Structured search over indexed CSV rows against the typed lookup columns
 * added by packages/db/migrations/0008_csv_record_lookup_columns.sql (see
 * packages/db/src/schema/csv-search.ts's doc comment for why this replaced
 * an earlier generic full-text/trigram design). None of ssn/first_name/
 * etc. are Drizzle schema columns exposed on a query-builder `where`
 * helper here, so this runs as raw SQL, same as before.
 *
 * Query shape is intentionally simple, matched to what this data actually
 * needs (exact/prefix lookups), not general free-text search:
 *   - a digits-heavy query (>=3 digits) is tried against ssn (substring,
 *     via the trigram index -- catches "last 4 of an SSN"), phone
 *     (exact or prefix), and zip (exact)
 *   - otherwise it's tried against last_name/first_name (prefix), city/
 *     state (exact), and address (prefix)
 * Both tiers can't both fire (see isDigitsHeavy below) -- deliberately
 * scoped this way rather than trying to guess "SSN vs name" from a mixed
 * query; combined name+SSN search can be revisited if analysts need it.
 * Never returns raw `data` -- only a masked preview projection; the full
 * (still-masked) record is a separate, audited fetch.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = QuerySchema.safeParse({
    q: req.nextUrl.searchParams.get('q') ?? undefined,
    folderId: req.nextUrl.searchParams.get('folderId') ?? undefined,
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { q, folderId, limit } = parsed.data
  const folderFilter = folderId ? sql`AND r.folder_id = ${folderId}` : sql``

  const selectColumns = sql`
    r.id, r.file_id, r.folder_id, r.row_number, r.data,
    f.relative_path, fo.label AS folder_label, f.columns, f.sensitive_columns
  `
  const fromClause = sql`
    FROM csv_record r
    INNER JOIN csv_source_file f ON f.id = r.file_id AND f.status = 'indexed'
    INNER JOIN csv_source_folder fo ON fo.id = r.folder_id AND fo.enabled = true
  `

  const digits = q.replace(/\D/g, '')
  const isDigitsHeavy = digits.length >= 3 && digits.length >= q.trim().length - 1 // tolerate one separator char, e.g. a stray dash

  let rows: SearchRow[]

  if (isDigitsHeavy) {
    rows = await db.execute<SearchRow>(sql`
      SELECT ${selectColumns} ${fromClause}
      WHERE (r.ssn ILIKE ${'%' + digits + '%'} OR r.phone = ${digits} OR r.phone LIKE ${digits + '%'} OR r.zip = ${digits})
        ${folderFilter}
      LIMIT ${limit}
    `)
  } else {
    const lowered = q.toLowerCase()
    rows = await db.execute<SearchRow>(sql`
      SELECT ${selectColumns} ${fromClause}
      WHERE (
        r.last_name LIKE ${lowered + '%'} OR r.first_name LIKE ${lowered + '%'}
        OR r.city = ${lowered} OR r.state = ${lowered} OR r.address LIKE ${lowered + '%'}
      ) ${folderFilter}
      LIMIT ${limit}
    `)
  }

  const results = rows.map((row) => {
    const masked = maskRecord(row.data, row.sensitive_columns)
    const preview: Record<string, string | null> = {}
    for (const column of row.columns) {
      const value = masked[column]
      if (value) {
        preview[column] = value
        if (Object.keys(preview).length >= PREVIEW_FIELD_COUNT) break
      }
    }
    return {
      recordId: row.id,
      fileId: row.file_id,
      folderId: row.folder_id,
      folderLabel: row.folder_label,
      filename: row.relative_path,
      rowNumber: row.row_number,
      preview,
    }
  })

  return NextResponse.json({ results })
}
