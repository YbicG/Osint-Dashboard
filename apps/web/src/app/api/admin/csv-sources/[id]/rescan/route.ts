import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { csvSourceFolder } from '@osint/db/schema'
import { appendAuditEntry } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'
import { getCsvScanQueue } from '@/server/queue'

/** Manually re-triggers a folder scan — the escape hatch for the mtime+size "changed" heuristic's rare miss, and the only way to pick up new/removed files since there's no automatic periodic re-scan. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 })

  const { id } = await params
  const [folder] = await db.select({ id: csvSourceFolder.id }).from(csvSourceFolder).where(eq(csvSourceFolder.id, id))
  if (!folder) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await getCsvScanQueue().add('scan-folder', { folderId: id })
  await appendAuditEntry(db, { userId: user.id, action: 'csv_source_folder.rescan', targetType: 'csv_source_folder', targetId: id })

  return NextResponse.json({ ok: true })
}
