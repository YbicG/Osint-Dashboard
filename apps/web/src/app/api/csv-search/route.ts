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
 * Two-tier search over indexed CSV rows (see packages/db/migrations/0005_csv_search_indexes.sql):
 * full-text (tsvector/GIN, ranked) for word-shaped queries, falling back to
 * trigram substring matching (GIN, gin_trgm_ops) for all-digit queries
 * (partial SSNs/phone/zip fragments) or when full-text finds nothing.
 * `search_vector`/`search_text` aren't Drizzle schema columns (the former is
 * a hand-written generated column), so this runs as raw SQL rather than the
 * query builder. Never returns raw `data` — only a masked preview
 * projection; the full (still-masked) record is a separate, audited fetch.
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

  const isAllDigits = /^\d+$/.test(q)
  let rows: SearchRow[] = []

  if (!isAllDigits) {
    rows = await db.execute<SearchRow>(sql`
      SELECT ${selectColumns} ${fromClause}
      WHERE r.search_vector @@ websearch_to_tsquery('simple', ${q}) ${folderFilter}
      ORDER BY ts_rank(r.search_vector, websearch_to_tsquery('simple', ${q})) DESC
      LIMIT ${limit}
    `)
  }

  if (rows.length === 0) {
    const lowered = q.toLowerCase()
    rows = await db.execute<SearchRow>(sql`
      SELECT ${selectColumns} ${fromClause}
      WHERE r.search_text ILIKE ${'%' + lowered + '%'} ${folderFilter}
      ORDER BY similarity(r.search_text, ${lowered}) DESC
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
