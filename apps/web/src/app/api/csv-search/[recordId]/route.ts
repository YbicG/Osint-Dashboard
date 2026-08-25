import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { csvRecord, csvSourceFile, csvSourceFolder } from '@osint/db/schema'
import { maskRecord, appendAuditEntry } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

/**
 * Full record view, sensitive columns masked (unmask is a separate, more
 * deliberately audited action — see ./reveal/route.ts). Every open is
 * audit-logged: this is the point where a specific analyst is shown a
 * specific person's full row, which is exactly the kind of access this
 * app's audit chain exists to make accountable.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { recordId } = await params
  const [row] = await db.select({
    id: csvRecord.id,
    fileId: csvRecord.fileId,
    folderId: csvRecord.folderId,
    rowNumber: csvRecord.rowNumber,
    data: csvRecord.data,
    columns: csvSourceFile.columns,
    sensitiveColumns: csvSourceFile.sensitiveColumns,
    filename: csvSourceFile.relativePath,
    folderLabel: csvSourceFolder.label,
  })
    .from(csvRecord)
    .innerJoin(csvSourceFile, eq(csvSourceFile.id, csvRecord.fileId))
    .innerJoin(csvSourceFolder, eq(csvSourceFolder.id, csvRecord.folderId))
    .where(eq(csvRecord.id, recordId))

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await appendAuditEntry(db, {
    userId: user.id,
    action: 'csv_record.view',
    targetType: 'csv_record',
    targetId: recordId,
    metadata: { fileId: row.fileId, folderId: row.folderId },
  })

  return NextResponse.json({
    recordId: row.id,
    fileId: row.fileId,
    folderId: row.folderId,
    folderLabel: row.folderLabel,
    filename: row.filename,
    rowNumber: row.rowNumber,
    columns: row.columns,
    sensitiveColumns: row.sensitiveColumns,
    data: maskRecord(row.data, row.sensitiveColumns),
  })
}
