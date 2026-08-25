import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { csvRecord, csvSourceFile } from '@osint/db/schema'
import { appendAuditEntry } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

/**
 * Unmasks a record's sensitive columns. A POST (not a GET `?reveal=true`
 * flag on the record route) so this stays an explicit, non-idempotent
 * request distinct from the always-safe "view a masked record" GET — the
 * audit trail should be able to tell "opened the record" apart from
 * "actually saw the unmasked SSN" without ambiguity. Returns only the
 * unmasked sensitive values, not the whole record again.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { recordId } = await params
  const [row] = await db.select({
    fileId: csvRecord.fileId,
    folderId: csvRecord.folderId,
    data: csvRecord.data,
    sensitiveColumns: csvSourceFile.sensitiveColumns,
  })
    .from(csvRecord)
    .innerJoin(csvSourceFile, eq(csvSourceFile.id, csvRecord.fileId))
    .where(eq(csvRecord.id, recordId))

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const revealed: Record<string, string | null> = {}
  for (const column of row.sensitiveColumns) {
    revealed[column] = row.data[column] ?? null
  }

  await appendAuditEntry(db, {
    userId: user.id,
    action: 'csv_record.reveal',
    targetType: 'csv_record',
    targetId: recordId,
    metadata: { fileId: row.fileId, folderId: row.folderId, revealedColumns: row.sensitiveColumns },
  })

  return NextResponse.json({ revealed })
}
