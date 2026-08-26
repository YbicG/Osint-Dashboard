import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { maskRecord } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

const NameField = z.enum(['both', 'first_name', 'last_name'])
type NameField = z.infer<typeof NameField>

const QuerySchema = z.object({
  q: z.string().trim().min(3, 'Query must be at least 3 characters'),
  folderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Only meaningful for the non-digits-heavy branch below -- ignored for an
  // ssn/phone/zip-shaped query. Defaults to 'both' (first name OR last
  // name), which is a UNION of two independently-indexed queries rather
  // than a single `OR` -- see the doc comment on the GET handler for why
  // that distinction matters at this table's size.
  field: NameField.default('both'),
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
 *   - otherwise it's a name search against last_name and/or first_name
 *     (prefix), per `field`
 * Both tiers can't both fire (see isDigitsHeavy below) -- deliberately
 * scoped this way rather than trying to guess "SSN vs name" from a mixed
 * query; combined name+SSN search can be revisited if analysts need it.
 *
 * The name branch deliberately does NOT search city/state/address (dropped
 * -- those columns have no index at all, and analysts here only care about
 * names) and, when `field` is 'both', runs first_name and last_name as two
 * separately-planned queries combined with UNION rather than one query with
 * `last_name LIKE $1 OR first_name LIKE $2`. This isn't stylistic: a single
 * WHERE clause that ORs together an indexed and an unindexed predicate (or,
 * as happened before this file's last_name/first_name indexes were
 * text_pattern_ops, two predicates that only *looked* indexed) forces
 * Postgres to fall back to a full table scan to satisfy the whole OR, even
 * though every individual branch is index-friendly on its own -- see
 * docs/RUNBOOK.md's csv-search notes. UNION lets the planner pick an index
 * scan per branch independently, then dedupes (UNION, not UNION ALL) so a
 * row matching both first and last name doesn't appear twice.
 *
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
    field: req.nextUrl.searchParams.get('field') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { q, folderId, limit, field } = parsed.data
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
    // Each branch is its own bounded, independently-planned query (a single
    // index scan apiece against csv_record_last_name_idx /
    // csv_record_first_name_idx) -- see the doc comment above for why this
    // isn't just `last_name LIKE $1 OR first_name LIKE $2`. The inner
    // LIMITs bound how much work either branch does before the outer LIMIT
    // trims the unioned, deduped result.
    const lastNameQuery = sql`(SELECT ${selectColumns} ${fromClause} WHERE r.last_name LIKE ${lowered + '%'} ${folderFilter} LIMIT ${limit})`
    const firstNameQuery = sql`(SELECT ${selectColumns} ${fromClause} WHERE r.first_name LIKE ${lowered + '%'} ${folderFilter} LIMIT ${limit})`

    const unioned =
      field === 'last_name' ? lastNameQuery
      : field === 'first_name' ? firstNameQuery
      : sql`${lastNameQuery} UNION ${firstNameQuery}` // UNION, not UNION ALL -- dedupes a row matching both

    rows = await db.execute<SearchRow>(sql`${unioned} LIMIT ${limit}`)
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
